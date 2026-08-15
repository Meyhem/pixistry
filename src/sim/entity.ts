// The one entity vocabulary: every apparatus kind (funnel, tube, flask,
// filter, radiator, glass polygon) implements the same small interface --
// EntityDef -- and everything generic about apparatus (compositing,
// placing, moving, handle drags, rotation, settings, the wire snapshot)
// dispatches through ENTITY_DEFS instead of through per-kind code paths.
//
// This module is pure and importable from the UI (like tube-shapes.ts): the
// wire-facing halves (entityHandles over EntityWire) are exactly what the
// select tool needs for hit-testing and handle overlays, while the
// instance-facing halves are what worker.ts calls. Adding an apparatus kind
// means: give its instance type a `kind` discriminant, add its wire/payload
// shapes to protocol.ts's unions, and fill in one row here -- no new
// messages, no new selection code, no compositor changes.
import type { PhaseCode, SimGrid, SinkMaskValue } from './grid';
import { isWallSpecId } from './walls';
import { FLASK_FACINGS, MAX_FLASK_SIZE_SCALE, MIN_FLASK_SIZE_SCALE, flaskShapeFor } from './flask-shapes';
import { FUNNEL_FACINGS, funnelShapeFor } from './apparatus-shapes';
import {
  MAX_PORT_WIDTH,
  MIN_PORT_WIDTH,
  movePortEndpoint,
  movePortInstance,
  placePortInstance,
  portLineCells,
  portMaskValue,
  sinkLineCells,
  updatePortInstance,
  type SinkInstance,
  type VentInstance,
} from './sink';
import { glassChainCells } from './glass';
import { lumenBand, pointSegmentDistance, polylineToLumenPath } from './tube-shapes';
import { celsiusToKelvin, kelvinToCelsius } from './heat';
import {
  funnelGlassCells,
  moveFunnelInstance,
  placeFunnelInstance,
  rateFromIntervalTicks,
  resetFunnelInstance,
  setFunnelEnabledInstance,
  updateFunnelInstance,
  type FunnelInstance,
} from './funnel';
import {
  moveTubeInstance,
  moveTubeKnee,
  normalizeTubePoints,
  placeTubeInstance,
  tubeGlassCells,
  tubeLumenCells,
  updateTubeInstance,
  type TubeInstance,
} from './tube';
import { flaskFootprint, moveFlaskInstance, placeFlaskInstance, updateFlaskInstance, type FlaskInstance } from './flask';
import { filterLineCells, moveFilterEndpoint, moveFilterInstance, placeFilterInstance, updateFilterInstance, type FilterInstance } from './filter';
import { moveRadiatorEndpoint, moveRadiatorInstance, placeRadiatorInstance, radiatorStamp, updateRadiatorInstance, type RadiatorInstance } from './radiators';
import { GLASS_ROTATION_STEPS, glassCells, glassPoints, moveGlassCorner, moveGlassInstance, placeGlassInstance, rotateGlassInstance, type GlassInstance } from './glass';
import type {
  EntityAction,
  EntityKind,
  EntitySettingsWire,
  EntityWire,
  FilterWire,
  FlaskWire,
  FunnelWire,
  GlassWire,
  PlaceEntityWire,
  RadiatorWire,
  SinkWire,
  TubeWire,
  VentWire,
} from './protocol';
import type { Point } from './tube-shapes';

export type { EntityKind } from './protocol';

export type AnyEntity = FunnelInstance | TubeInstance | FlaskInstance | FilterInstance | RadiatorInstance | GlassInstance | SinkInstance | VentInstance;

/** What one entity puts on the grid -- the compositor (entity-composite.ts)
 * derives ALL apparatus grid state from these, so a kind's footprint is its
 * entire physical presence. Every field is optional; a kind fills in only the
 * roles it has (a filter is nothing but a membrane, a flask is just walls, a
 * tube is walls plus the channel bored through them). */
export interface Footprint {
  /** Real glass wall matter in specId. Claims the cell (grid.entityOwner). */
  readonly wall?: readonly Point[];
  /** A bored channel: clears any wall matter in the way and flags the cell
   * as tube cargo space (TubeMaskValue.Lumen). Does NOT claim the cell. */
  readonly lumen?: readonly Point[];
  /** Filter membrane cells. Claims the cell -- ownership is the whole of how
   * a membrane is marked on the grid: movement.ts looks the owning entity's
   * allow-list up by grid.entityOwner (see filter.ts's FilterAllow). */
  readonly membrane?: readonly Point[];
  /** Cells that radiate, and how far/toward what (see radiators.ts). */
  readonly radiator?: { readonly cells: readonly Point[]; readonly radius: number; readonly targetK: number };
  /** Collection-port cells (sinkMask), and which tally they feed. Does NOT
   * claim the cell: a port doesn't block or own anything, it just eats what
   * comes to rest on it, so ownership -- which is how glass provenance is
   * tracked -- would only get in the way (see the compositor's membrane
   * pass for what claiming a cell you don't own costs). */
  readonly port?: { readonly cells: readonly Point[]; readonly value: SinkMaskValue.Sink | SinkMaskValue.Vent };
}

/** A draggable point on a placed entity: a tube knee, a line end, a glass
 * polygon corner. `handleId` is the kind's own index space (knee index,
 * end 0/1, corner index) and is what 'dragEntityHandle' names. */
export interface Handle {
  readonly handleId: number;
  readonly x: number;
  readonly y: number;
}

/** What a click landed on: an entity, and either one of its handles (a
 * reshape) or its body (a move). One shape for every kind -- the ten-variant
 * per-kind union this replaced had to grow a case per capability per kind. */
export interface EntityHit {
  readonly entityId: number;
  readonly kind: EntityKind;
  /** null = the body, not a handle. */
  readonly handleId: number | null;
  /** Scenario bench furniture: selectable, but every edit is refused (see
   * worker.ts's isLocked), so the UI arms no drag for it. */
  readonly locked: boolean;
}

/** One control in an entity kind's settings pane. A kind declares its fields
 * once, here, and side-panel.ts renders whatever it's handed -- the same
 * schema drives both the pre-placement tool config and the selected-entity
 * editor, which is why `mode` is a parameter of `settingsSchema` rather than
 * two separate lists. `key` names a field on that kind's draft object (see
 * ui/entity-selection.ts), so reading and writing a value needs no per-kind
 * code either. */
export type EntityField =
  | { readonly field: 'slider'; readonly key: string; readonly label: string; readonly min: number; readonly max: number; readonly step: number; readonly format: 'plain' | 'celsius' | 'scale' }
  | { readonly field: 'number'; readonly key: string; readonly label: string; readonly min: number; readonly step: number }
  /** Two or more mutually exclusive buttons; `value` is written to `key`. */
  | { readonly field: 'segmented'; readonly key: string; readonly label: string; readonly options: readonly { readonly value: string | boolean; readonly label: string }[] }
  /** Opens the periodic-table picker; `key` holds a specId. */
  | { readonly field: 'species-pick'; readonly key: string; readonly label: string }
  /** A chip list of species; `key` holds a Set<number>, or null for the
   * tube's "accept everything" default. */
  | { readonly field: 'species-set'; readonly key: string; readonly label: string; readonly emptyHint: string }
  /** Read-only display of a value the entity reports (a funnel's remaining
   * budget), not something the draft edits. */
  | { readonly field: 'readout'; readonly key: string; readonly label: string }
  /** A one-shot verb (see EntityAction), not a setting. */
  | { readonly field: 'action'; readonly action: EntityAction; readonly label: string };

/** Whether the pane is configuring the *next* placement or editing a placed
 * entity. A few fields only make sense in one of the two (a funnel's
 * Running/Stopped switch and its remaining budget belong to an instance; a
 * flask's shape is picked from the Tool Chest before placement). */
export type EntityPanelMode = 'config' | 'edit';

/** An entity's extent in grid cells, from its wire snapshot. */
export interface EntityBounds {
  readonly minX: number;
  readonly maxX: number;
  readonly minY: number;
  readonly maxY: number;
}

interface EntityOfKind {
  funnel: FunnelInstance;
  tube: TubeInstance;
  flask: FlaskInstance;
  filter: FilterInstance;
  radiator: RadiatorInstance;
  glass: GlassInstance;
  sink: SinkInstance;
  vent: VentInstance;
}

interface WireOfKind {
  funnel: FunnelWire;
  tube: TubeWire;
  flask: FlaskWire;
  filter: FilterWire;
  radiator: RadiatorWire;
  glass: GlassWire;
  sink: SinkWire;
  vent: VentWire;
}

type PlaceOfKind = { [K in EntityKind]: Extract<PlaceEntityWire, { kind: K }> };
type SettingsOfKind = { [K in EntityKind]: Extract<EntitySettingsWire, { kind: K }> };

/** One apparatus kind's whole behavior, as data. Optional capabilities are
 * genuinely optional: no rotate = the wheel/R key do nothing, no settings =
 * nothing to edit in the panel, no action = no one-shot verbs. */
export interface EntityDef<K extends EntityKind> {
  footprintOf(entity: EntityOfKind[K]): Footprint;
  /** Over the *wire* shape, not the instance -- the UI hit-tests and draws
   * handles from frame snapshots, and the worker resolves a dragged handle
   * against the live instance in dragHandle below. */
  handlesOf(wire: WireOfKind[K]): Handle[];
  /** The cells this entity reads as, for the UI's hover highlight and its
   * selected-entity ghost. Not the footprint: a tube's is its channel (what
   * you see and aim at), not its wall ring, and this side of the wire has no
   * grid to resolve a footprint against anyway. */
  bodyCells(wire: WireOfKind[K]): Point[];
  /** How far (in cells) `p` is from this entity's body, or null if it's
   * outside grabbing range -- the "did the click land on it" half of the
   * UI's hit test. Distance breaks ties between overlapping candidates of
   * the same size; boundsOf's area breaks them between different sizes (see
   * entity-selection.ts). */
  bodyDistance(wire: WireOfKind[K], p: Point): number | null;
  boundsOf(wire: WireOfKind[K]): EntityBounds | null;
  /** The cells this entity holds matter in -- a vessel's open interior. What
   * a *translation* takes with it (see moveEntityBy): drag a beaker of water
   * across the bench and the water goes with it, rather than being left
   * behind and then clipped away by the glass arriving on top of it. Omitted
   * for kinds that hold nothing (a filter, a radiator) and for kinds with no
   * interior anywhere in the sim to derive one from (a hand-drawn glass
   * polygon is a chain of walls; nothing computes what it encloses, and its
   * open mouth means a flood fill can't either). */
  contentCells?(entity: EntityOfKind[K]): readonly Point[];
  /** Which absolute rotation step this entity currently sits at, for kinds
   * that rotate -- so the wheel can send `current + 1` rather than tracking
   * the cycle itself. Omitted exactly when `rotate` is. */
  rotationOf?(wire: WireOfKind[K]): number;
  dragHandle(grid: SimGrid, entity: EntityOfKind[K], handleId: number, x: number, y: number): void;
  move(grid: SimGrid, entity: EntityOfKind[K], dx: number, dy: number): void;
  /** Absolute rotation step -- a glass polygon's 0..7 wheel position, a
   * funnel's/flask's index into its facing cycle. */
  rotate?(entity: EntityOfKind[K], rotation: number): void;
  /** Returns null to refuse the placement (e.g. a tube collapsed to a single
   * cell, which would be a dead conveyor). */
  place(grid: SimGrid, params: PlaceOfKind[K]): EntityOfKind[K] | null;
  toWire(entity: EntityOfKind[K]): WireOfKind[K];
  applySettings?(entity: EntityOfKind[K], settings: SettingsOfKind[K]): void;
  action?(entity: EntityOfKind[K], action: EntityAction): void;
  /** This kind's settings pane, as data. Omitted for a kind with nothing to
   * configure (a glass polygon moves and rotates, and that's all). */
  settingsSchema?(mode: EntityPanelMode): readonly EntityField[];
  /** Schema values that come from the live instance rather than the edit
   * draft -- a funnel's dwindling budget and its Running/Stopped state.
   * Read fresh from the frame every render, so they tick along with the sim
   * instead of freezing at whatever they were when the entity was
   * selected. */
  readoutsOf?(wire: WireOfKind[K]): Record<string, unknown>;
  /** The pane's "HOW IT WORKS" copy for each mode. */
  panelHint?(mode: EntityPanelMode): string;
}

/** How close a click has to be to a one-cell-wide line (a filter, a radiator,
 * a glass wall) or a tube's channel to count as landing on it. A couple of
 * cells of slack, since a 1px line is otherwise unclickable at any sane
 * zoom. */
const LINE_HIT_RADIUS = 2;

// Field ranges the panel's sliders/number inputs use. They live with the
// kinds rather than in side-panel.ts now that the pane is schema-driven --
// "how hot can a funnel dispense" is a property of the funnel, not of the
// widget that happens to show it.
const MIN_TEMP_C = -250;
const MAX_TEMP_C = 1500;
const TEMP_STEP_C = 5;
const MIN_FUNNEL_RATE = 1;
const MAX_FUNNEL_RATE = 600;
const MIN_RADIATION_RADIUS = 1;
const MAX_RADIATION_RADIUS = 15;

function facingIndex(rotation: number, steps: number): number {
  return ((Math.round(rotation) % steps) + steps) % steps;
}

function lineHandles(line: { x0: number; y0: number; x1: number; y1: number }): Handle[] {
  return [
    { handleId: 0, x: line.x0, y: line.y0 },
    { handleId: 1, x: line.x1, y: line.y1 },
  ];
}

function pointHandles(points: readonly Point[]): Handle[] {
  return points.map((p, i) => ({ handleId: i, x: p.x, y: p.y }));
}

function boundsOfCells(cells: readonly Point[]): EntityBounds | null {
  if (cells.length === 0) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.x > maxX) maxX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, maxX, minY, maxY };
}

/** Distance from `p` to a chain of points, or null past LINE_HIT_RADIUS --
 * the body test every polyline kind shares (a two-point line is just the
 * short case). */
function chainDistance(points: readonly Point[], p: Point): number | null {
  let best = Infinity;
  for (let i = 0; i + 1 < points.length; i++) {
    const d = pointSegmentDistance(p, points[i] as Point, points[i + 1] as Point);
    if (d < best) best = d;
  }
  return best <= LINE_HIT_RADIUS ? best : null;
}

function lineChain(line: { x0: number; y0: number; x1: number; y1: number }): Point[] {
  return [
    { x: line.x0, y: line.y0 },
    { x: line.x1, y: line.y1 },
  ];
}

/** Bounding-box body test for the stamp kinds (funnel, flask): anywhere
 * inside the outline's box counts, at distance 0. Precise glass-cell
 * hit-testing would make a vessel's own open interior unclickable, which is
 * exactly where you reach for it. */
function boxDistance(bounds: EntityBounds | null, p: Point): number | null {
  if (!bounds) return null;
  return p.x >= bounds.minX && p.x <= bounds.maxX && p.y >= bounds.minY && p.y <= bounds.maxY ? 0 : null;
}

function offsetCells(cells: readonly { dx: number; dy: number }[], x: number, y: number): Point[] {
  return cells.map((c) => ({ x: x + c.dx, y: y + c.dy }));
}

/** One registry row for both collection-port kinds. A Sink and a Vent are the
 * same entity in every respect the registry cares about -- same geometry,
 * same handles, same settings, same footprint role -- and differ only in the
 * SinkMaskValue they stamp, so writing the row twice would be two chances for
 * the two to drift apart on some detail neither kind has a reason to differ
 * on. `kind` is threaded through as a type parameter, so each call still
 * yields a row fully checked against that kind's own wire and payload
 * shapes. */
function portDef<K extends 'sink' | 'vent'>(kind: K, label: string): EntityDef<K> {
  return {
    footprintOf: (port) => ({ port: { cells: portLineCells(port), value: portMaskValue(kind) } }),
    handlesOf: (wire) => lineHandles(wire),
    bodyCells: (wire) => sinkLineCells(wire.x0, wire.y0, wire.x1, wire.y1, wire.width),
    // The line's own thickness widens the grab area: a hit test that only
    // knew about the centre line would leave the outer cells of a wide port
    // -- the part you can actually see -- unclickable.
    bodyDistance: (wire, p) => {
      const dist = pointSegmentDistance(p, { x: wire.x0, y: wire.y0 }, { x: wire.x1, y: wire.y1 });
      return dist <= LINE_HIT_RADIUS + wire.width ? dist : null;
    },
    boundsOf: (wire) => boundsOfCells(sinkLineCells(wire.x0, wire.y0, wire.x1, wire.y1, wire.width)),
    dragHandle: (_grid, port, handleId, x, y) => movePortEndpoint(port, handleId === 0 ? 0 : 1, x, y),
    move: (_grid, port, dx, dy) => movePortInstance(port, dx, dy),
    // The two casts are the price of writing one row for two kinds: `kind`
    // is a type parameter here, so TS can't see that the sink branch really
    // does produce a SinkInstance/SinkWire and the vent branch a
    // Vent one. Both objects are built from `kind` itself, so there's no way
    // for them to disagree with it at runtime.
    place: (_grid, params) => placePortInstance(kind, params) as unknown as EntityOfKind[K],
    toWire: (port) =>
      ({
        kind,
        entityId: port.entityId,
        ...(port.locked ? { locked: true } : {}),
        x0: port.x0,
        y0: port.y0,
        x1: port.x1,
        y1: port.y1,
        width: port.width,
      }) as WireOfKind[K],
    settingsSchema: () => [{ field: 'slider', key: 'width', label: 'Width', min: MIN_PORT_WIDTH, max: MAX_PORT_WIDTH, step: 1, format: 'plain' }],
    panelHint: (mode) =>
      mode === 'config'
        ? `Drag from one end to the other to draw a ${label} line, as thick as the brush width. Anything resting on it at the end of a tick is counted and removed -- it doesn't block movement or push matter around, so pixels fall onto it exactly as they would onto open ground.`
        : `Drag the line to slide it, or drag either end to re-aim it; Width thickens it in place. The tallies above count every ${label} on the bench together, not just this one. The eraser won't touch it -- use Delete (or the button above) to take it off the bench.`,
    applySettings: (port, settings) => updatePortInstance(port, settings.width),
  };
}

export const ENTITY_DEFS: { [K in EntityKind]: EntityDef<K> } = {
  funnel: {
    footprintOf: (funnel) => ({ wall: funnelGlassCells(funnel) }),
    handlesOf: () => [],
    bodyCells: (wire) => offsetCells(funnelShapeFor(wire.facing).cells, wire.anchorX, wire.anchorY),
    bodyDistance: (wire, p) => boxDistance(boundsOfCells(offsetCells(funnelShapeFor(wire.facing).cells, wire.anchorX, wire.anchorY)), p),
    boundsOf: (wire) => boundsOfCells(offsetCells(funnelShapeFor(wire.facing).cells, wire.anchorX, wire.anchorY)),
    rotationOf: (wire) => FUNNEL_FACINGS.indexOf(wire.facing),
    dragHandle: () => {},
    move: (_grid, funnel, dx, dy) => moveFunnelInstance(funnel, funnel.anchorX + dx, funnel.anchorY + dy),
    rotate: (funnel, rotation) => {
      funnel.facing = FUNNEL_FACINGS[facingIndex(rotation, FUNNEL_FACINGS.length)] as FunnelInstance['facing'];
    },
    place: (_grid, params) =>
      placeFunnelInstance({
        x: params.x,
        y: params.y,
        facing: params.facing,
        specId: params.specId,
        tempC: params.tempC,
        ratePerMinute: params.ratePerMinute,
        total: params.total,
      }),
    toWire: (funnel) => ({
      kind: 'funnel',
      entityId: funnel.entityId,
      ...(funnel.locked ? { locked: true } : {}),
      anchorX: funnel.anchorX,
      anchorY: funnel.anchorY,
      facing: funnel.facing,
      specId: funnel.specId,
      tempC: kelvinToCelsius(funnel.tempK),
      ratePerMinute: rateFromIntervalTicks(funnel.intervalTicks),
      total: funnel.total,
      remaining: funnel.remaining,
      enabled: funnel.enabled,
    }),
    settingsSchema: (mode) => [
      { field: 'species-pick', key: 'specId', label: 'Species' },
      { field: 'slider', key: 'tempC', label: 'Spawn temperature', min: MIN_TEMP_C, max: MAX_TEMP_C, step: TEMP_STEP_C, format: 'celsius' },
      { field: 'slider', key: 'ratePerMinute', label: 'Rate (px/min)', min: MIN_FUNNEL_RATE, max: MAX_FUNNEL_RATE, step: 1, format: 'plain' },
      {
        field: 'segmented',
        key: 'totalMode',
        label: 'Total amount',
        options: [
          { value: 'finite', label: 'Finite' },
          { value: 'infinite', label: 'Infinite' },
        ],
      },
      // Only when a finite total is selected -- the panel hides a field
      // whose value can't apply (see side-panel.ts's showWhen handling of
      // totalMode).
      { field: 'number', key: 'totalAmount', label: 'Amount', min: 1, step: 1 },
      ...(mode === 'edit'
        ? ([
            {
              field: 'segmented',
              key: 'enabled',
              label: 'State',
              options: [
                { value: true, label: 'Running' },
                { value: false, label: 'Stopped' },
              ],
            },
            { field: 'readout', key: 'remaining', label: 'Remaining' },
            { field: 'action', action: 'reset', label: 'Reset' },
          ] as const)
        : []),
    ],
    readoutsOf: (wire) => ({ remaining: wire.remaining, enabled: wire.enabled }),
    panelHint: (mode) =>
      mode === 'config'
        ? 'Rotate with the scroll wheel while hovering the grid, then click to place. A placed funnel starts Stopped -- switch it to Running here once placed. Drips one pixel at a fixed interval; pauses automatically if its outlet is blocked, and resumes once it clears.'
        : 'Drag the funnel to move it, or rotate it with the scroll wheel over the grid, same as before placement. Editing its settings only affects future drips -- Reset refills it back to its full total (or infinite) and un-pauses it, without changing Running/Stopped.',
    applySettings: (funnel, settings) =>
      updateFunnelInstance(funnel, {
        specId: settings.specId,
        tempC: settings.tempC,
        ratePerMinute: settings.ratePerMinute,
        total: settings.total,
        facing: settings.facing,
      }),
    action: (funnel, action) => {
      if (action === 'reset') resetFunnelInstance(funnel);
      else setFunnelEnabledInstance(funnel, action === 'enable');
    },
  },
  tube: {
    footprintOf: (tube) => ({ wall: tubeGlassCells(tube), lumen: tubeLumenCells(tube) }),
    handlesOf: (wire) => pointHandles(wire.points),
    bodyCells: (wire) => lumenBand(polylineToLumenPath(wire.points)),
    bodyDistance: (wire, p) => chainDistance(wire.points, p),
    boundsOf: (wire) => boundsOfCells(lumenBand(polylineToLumenPath(wire.points))),
    dragHandle: (grid, tube, handleId, x, y) => moveTubeKnee(grid, tube, handleId, { x, y }),
    move: (grid, tube, dx, dy) => moveTubeInstance(grid, tube, dx, dy),
    place: (grid, params) => {
      // A tube whose knees all landed on one cell has no direction of travel
      // and can never convey anything -- don't put a dead one on the bench
      // (see tube.ts's normalizeTubePoints).
      const points = normalizeTubePoints(params.points);
      if (points.length < 2) return null;
      return placeTubeInstance(grid, { points, filter: params.filter ? new Set(params.filter) : null });
    },
    toWire: (tube) => ({
      kind: 'tube',
      entityId: tube.entityId,
      ...(tube.locked ? { locked: true } : {}),
      points: tube.points.map((p) => ({ x: p.x, y: p.y })),
      filter: tube.filter ? [...tube.filter] : null,
    }),
    settingsSchema: () => [
      { field: 'species-set', key: 'filter', label: 'Species filter', emptyHint: 'No species added -- every species passes through.' },
    ],
    panelHint: (mode) =>
      mode === 'config'
        ? 'Click to place each knee, right-click to finish at the last knee placed (or cancel if only the mouth is placed). The channel is three cells wide and swallows whatever arrives at its mouth -- put the mouth where material already falls or flows; it reaches for nothing. Cargo rides to the far end and is ejected there; a blocked exit backs the whole tube up.'
        : 'Drag a knee to reshape the tube, or drag it anywhere else to slide the whole thing. The allow-list only affects what the mouth takes in future, not cargo already inside.',
    applySettings: (tube, settings) => updateTubeInstance(tube, { filter: settings.filter ? new Set(settings.filter) : null }),
  },
  flask: {
    footprintOf: (flask) => ({ wall: flaskFootprint(flask).wallCells }),
    contentCells: (flask) => flaskFootprint(flask).reservoirCells,
    handlesOf: () => [],
    bodyCells: (wire) => offsetCells(flaskShapeFor(wire.facing, wire.sizeScale, wire.flaskKind).cells, wire.x, wire.y),
    bodyDistance: (wire, p) => boxDistance(boundsOfCells(offsetCells(flaskShapeFor(wire.facing, wire.sizeScale, wire.flaskKind).cells, wire.x, wire.y)), p),
    boundsOf: (wire) => boundsOfCells(offsetCells(flaskShapeFor(wire.facing, wire.sizeScale, wire.flaskKind).cells, wire.x, wire.y)),
    rotationOf: (wire) => FLASK_FACINGS.indexOf(wire.facing),
    dragHandle: () => {},
    move: (_grid, flask, dx, dy) => moveFlaskInstance(flask, flask.x + dx, flask.y + dy),
    rotate: (flask, rotation) => {
      flask.facing = FLASK_FACINGS[facingIndex(rotation, FLASK_FACINGS.length)] as FlaskInstance['facing'];
    },
    place: (_grid, params) =>
      placeFlaskInstance({
        x: params.x,
        y: params.y,
        facing: params.facing,
        sizeScale: params.sizeScale,
        stirred: params.stirred,
        flaskKind: params.flaskKind,
        open: params.open,
      }),
    toWire: (flask) => ({
      kind: 'flask',
      entityId: flask.entityId,
      ...(flask.locked ? { locked: true } : {}),
      x: flask.x,
      y: flask.y,
      facing: flask.facing,
      sizeScale: flask.sizeScale,
      stirred: flask.stirred,
      flaskKind: flask.flaskKind,
      open: flask.open,
    }),
    settingsSchema: (mode) => [
      // Pre-placement the shape is whatever you picked in the Tool Chest;
      // once placed it becomes an ordinary setting like any other.
      ...(mode === 'edit'
        ? ([
            {
              field: 'segmented',
              key: 'flaskKind',
              label: 'Shape',
              options: [
                { value: 'erlenmeyer', label: 'Erlenmeyer' },
                { value: 'beaker', label: 'Beaker' },
                { value: 'sepfunnel', label: 'Sep. funnel' },
              ],
            },
          ] as const)
        : []),
      { field: 'slider', key: 'sizeScale', label: 'Size', min: MIN_FLASK_SIZE_SCALE, max: MAX_FLASK_SIZE_SCALE, step: 0.1, format: 'scale' },
      {
        field: 'segmented',
        key: 'stirred',
        label: 'Stirring',
        options: [
          { value: false, label: 'Plain' },
          { value: true, label: 'Stirred' },
        ],
      },
      // Only rendered while the shape is the sep funnel -- the other
      // glassware has no aperture for it to act on (side-panel.ts hides it
      // the same way it hides a funnel's Amount in infinite mode).
      ...(mode === 'edit'
        ? ([
            {
              field: 'segmented',
              key: 'open',
              label: 'Stopcock',
              options: [
                { value: false, label: 'Closed' },
                { value: true, label: 'Open' },
              ],
            },
          ] as const)
        : []),
    ],
    panelHint: (mode) =>
      mode === 'config'
        ? 'Rotate with the scroll wheel while hovering the grid (45-degree steps), then click to place. A placed flask is a fixed glass vessel -- pour reagents in through its mouth with the paint tool, a funnel, or a conveyor. Stirred stamps a stirrer over the whole interior, agitating whatever settles inside. A sep funnel places with its bottom stopcock closed -- open it from this panel after placing.'
        : 'Drag the vessel to move it, or rotate it with the scroll wheel over the grid (45-degree steps), same as before placement. Changing shape, size or facing re-draws the glass in place -- whatever it was holding stays where it is, so a big change can leave contents outside the new outline. The sep funnel\'s Stopcock seals or opens the 3px drain at the bottom of its stem.',
    applySettings: (flask, settings) =>
      updateFlaskInstance(flask, {
        facing: settings.facing,
        sizeScale: settings.sizeScale,
        stirred: settings.stirred,
        flaskKind: settings.flaskKind,
        open: settings.open,
      }),
  },
  filter: {
    footprintOf: (filter) => ({ membrane: filterLineCells(filter) }),
    handlesOf: (wire) => lineHandles(wire),
    bodyCells: (wire) => sinkLineCells(wire.x0, wire.y0, wire.x1, wire.y1, 0),
    bodyDistance: (wire, p) => chainDistance(lineChain(wire), p),
    boundsOf: (wire) => boundsOfCells(lineChain(wire)),
    dragHandle: (_grid, filter, handleId, x, y) => moveFilterEndpoint(filter, handleId === 0 ? 0 : 1, x, y),
    move: (_grid, filter, dx, dy) => moveFilterInstance(filter, dx, dy),
    place: (_grid, params) => placeFilterInstance(params.x0, params.y0, params.x1, params.y1, params.species),
    toWire: (filter) => ({
      kind: 'filter',
      entityId: filter.entityId,
      ...(filter.locked ? { locked: true } : {}),
      x0: filter.x0,
      y0: filter.y0,
      x1: filter.x1,
      y1: filter.y1,
      species: [...filter.species],
    }),
    settingsSchema: () => [
      { field: 'species-set', key: 'species', label: 'Allowed species', emptyHint: 'No species added -- every species is blocked.' },
    ],
    panelHint: (mode) =>
      mode === 'config'
        ? 'Drag from one end to the other to draw a single one-cell-wide line. Species in the allowed list pass through it in either direction; everything else is blocked, same as glass. Each line keeps the list it was drawn with -- pick it up with the Select tool to change it later.'
        : "This line's own allow-list -- other filter lines keep theirs. Drag the line to slide it, or drag either end to re-aim it. The eraser won't touch it -- use Delete (or the button above) to take it off the bench.",
    applySettings: (filter, settings) => updateFilterInstance(filter, settings.species),
  },
  radiator: {
    footprintOf: (radiator) => ({ radiator: radiatorStamp(radiator) }),
    handlesOf: (wire) => lineHandles(wire),
    bodyCells: (wire) => sinkLineCells(wire.x0, wire.y0, wire.x1, wire.y1, 0),
    bodyDistance: (wire, p) => chainDistance(lineChain(wire), p),
    boundsOf: (wire) => boundsOfCells(lineChain(wire)),
    dragHandle: (_grid, radiator, handleId, x, y) => moveRadiatorEndpoint(radiator, handleId === 0 ? 0 : 1, x, y),
    move: (_grid, radiator, dx, dy) => moveRadiatorInstance(radiator, dx, dy),
    place: (_grid, params) =>
      placeRadiatorInstance({
        x0: params.x0,
        y0: params.y0,
        x1: params.x1,
        y1: params.y1,
        radius: params.radiationRadius,
        targetK: celsiusToKelvin(params.targetTempC),
      }),
    toWire: (radiator) => ({
      kind: 'radiator',
      entityId: radiator.entityId,
      ...(radiator.locked ? { locked: true } : {}),
      x0: radiator.x0,
      y0: radiator.y0,
      x1: radiator.x1,
      y1: radiator.y1,
      radiationRadius: radiator.radius,
      targetTempC: kelvinToCelsius(radiator.targetK),
    }),
    settingsSchema: () => [
      { field: 'slider', key: 'radiationRadius', label: 'Radiation radius', min: MIN_RADIATION_RADIUS, max: MAX_RADIATION_RADIUS, step: 1, format: 'plain' },
      { field: 'slider', key: 'targetTempC', label: 'Target temperature', min: MIN_TEMP_C, max: MAX_TEMP_C, step: TEMP_STEP_C, format: 'celsius' },
    ],
    panelHint: (mode) =>
      mode === 'config'
        ? "Drag from one end to the other to draw a single one-cell-wide line. Every cell of it radiates toward the target temperature each tick, within the radiation radius -- heating cells below it, cooling cells above it. Pure radiation, no collision. These settings are captured when you draw, so changing them afterward won't affect radiators already placed -- pick one up with the Select tool to change it."
        : "This radiator's own settings, applied the moment you move a slider. Drag the line to slide it, or drag either end to re-aim it. The eraser won't touch it -- use Delete (or the button above) to take it off the bench.",
    applySettings: (radiator, settings) => updateRadiatorInstance(radiator, settings.radiationRadius, celsiusToKelvin(settings.targetTempC)),
  },
  glass: {
    footprintOf: (glass) => ({ wall: glassCells(glass) }),
    handlesOf: (wire) => pointHandles(wire.points),
    bodyCells: (wire) => glassChainCells(wire.points),
    bodyDistance: (wire, p) => chainDistance(wire.points, p),
    boundsOf: (wire) => boundsOfCells(wire.points),
    rotationOf: (wire) => facingIndex(wire.rotation, GLASS_ROTATION_STEPS),
    dragHandle: (_grid, glass, handleId, x, y) => moveGlassCorner(glass, handleId, x, y),
    move: (_grid, glass, dx, dy) => moveGlassInstance(glass, dx, dy),
    rotate: (glass, rotation) => rotateGlassInstance(glass, rotation),
    place: (_grid, params) => (params.points.length > 0 ? placeGlassInstance(params.points) : null),
    toWire: (glass) => ({
      kind: 'glass',
      entityId: glass.entityId,
      ...(glass.locked ? { locked: true } : {}),
      points: glassPoints(glass),
      rotation: glass.rotation,
    }),
    // No settingsSchema: a polygon has nothing to configure. It moves,
    // rotates and reshapes by its corners, all of which are gestures rather
    // than fields.
    panelHint: (mode) =>
      mode === 'config'
        ? 'Click to place each corner, right-click to finish at the last corner placed (the segment still following the cursor is dropped), Escape to discard. Segments snap to the 8 compass directions and are drawn one cell wide, so vessel walls always join cleanly at a corner. Click back on the first corner to close the shape into a sealed vessel, or stop short to leave a mouth.'
        : "Drag any wall to slide the whole shape, drag a corner to reshape it, or rotate it with the scroll wheel over the grid (45-degree steps about its own middle). Whatever it was holding stays where it is, so a big turn can leave contents outside the new outline. The eraser won't touch it -- use Delete (or the button above) to take it off the bench.",
  },
  sink: portDef('sink', 'sink'),
  vent: portDef('vent', 'vent'),
};

/** The typed dispatchers below are the only place the per-kind types are
 * erased: ENTITY_DEFS is a mapped type (each row fully checked against its
 * own kind's instance/wire/payload shapes), but indexing it with a runtime
 * kind yields a union TS can't call directly, so each dispatcher narrows via
 * one cast. Anything mis-shaped still fails to compile at the row itself. */
function defOf(kind: EntityKind): EntityDef<EntityKind> {
  return ENTITY_DEFS[kind] as unknown as EntityDef<EntityKind>;
}

export function footprintOfEntity(entity: AnyEntity): Footprint {
  return defOf(entity.kind).footprintOf(entity as never);
}

export function entityToWire(entity: AnyEntity): EntityWire {
  return defOf(entity.kind).toWire(entity as never);
}

export function entityWires(entities: readonly AnyEntity[]): EntityWire[] {
  return entities.map(entityToWire);
}

/** Handles for one wire snapshot -- what the UI hit-tests and draws. */
export function entityHandles(wire: EntityWire): Handle[] {
  return defOf(wire.kind).handlesOf(wire as never);
}

/** The cells an entity reads as on screen -- the hover highlight and the
 * selected-entity ghost. */
export function entityBodyCells(wire: EntityWire): Point[] {
  return defOf(wire.kind).bodyCells(wire as never);
}

export function entityBounds(wire: EntityWire): EntityBounds | null {
  return defOf(wire.kind).boundsOf(wire as never);
}

/** The rotation step an entity currently sits at, or null for the kinds that
 * don't turn (a line has no facing) -- so a wheel notch is
 * `rotateEntity(current + step)` with no per-kind cycle bookkeeping. */
export function entityRotation(wire: EntityWire): number | null {
  const def = defOf(wire.kind);
  return def.rotationOf ? def.rotationOf(wire as never) : null;
}

/** What a click at (x, y) lands on: the nearest handle within grabbing
 * distance, else the smallest body containing the point, else null.
 *
 * Handles beat bodies because a handle is the more specific thing to have
 * aimed at and is only a couple of cells wide, so a click on one is never an
 * accident. Among bodies, *smallest area wins*: that's what keeps a funnel
 * or a tube knee standing inside a big flask clickable, and it replaced a
 * hand-ordered funnel -> knee -> segment -> filter -> radiator -> glass ->
 * flask chain that had to be re-reasoned every time a kind was added.
 * Distance breaks ties between equally-sized candidates. */
export function hitTestEntities(entities: readonly EntityWire[], x: number, y: number, handleRadius: number): EntityHit | null {
  const p = { x, y };
  let bestHandle: { hit: EntityHit; dist: number } | null = null;
  for (const wire of entities) {
    for (const handle of entityHandles(wire)) {
      const dist = Math.hypot(handle.x - x, handle.y - y);
      if (dist > handleRadius) continue;
      if (!bestHandle || dist < bestHandle.dist) {
        bestHandle = { hit: { entityId: wire.entityId, kind: wire.kind, handleId: handle.handleId, locked: wire.locked === true }, dist };
      }
    }
  }
  if (bestHandle) return bestHandle.hit;

  let bestBody: { hit: EntityHit; area: number; dist: number } | null = null;
  for (const wire of entities) {
    const def = defOf(wire.kind);
    const dist = def.bodyDistance(wire as never, p);
    if (dist === null) continue;
    const bounds = def.boundsOf(wire as never);
    const area = bounds ? (bounds.maxX - bounds.minX + 1) * (bounds.maxY - bounds.minY + 1) : Infinity;
    if (!bestBody || area < bestBody.area || (area === bestBody.area && dist < bestBody.dist)) {
      bestBody = { hit: { entityId: wire.entityId, kind: wire.kind, handleId: null, locked: wire.locked === true }, area, dist };
    }
  }
  return bestBody ? bestBody.hit : null;
}

/** One cell's worth of carried matter, lifted off the grid for the duration of
 * a move (see moveEntityBy). */
interface CarriedCell {
  readonly x: number;
  readonly y: number;
  readonly specId: number;
  readonly phase: PhaseCode;
  readonly u: number;
}

/** Lifts whatever a vessel is holding off the grid, so the caller can put it
 * back down somewhere else. Walls are left alone: a tube plumbed through the
 * vessel, or another entity's glass crossing its interior, belongs to that
 * entity and is re-derived by the compositor, not carried around by this one. */
function liftContents(grid: SimGrid, entity: AnyEntity): CarriedCell[] {
  const cells = defOf(entity.kind).contentCells?.(entity as never);
  if (!cells) return [];
  const carried: CarriedCell[] = [];
  for (const { x, y } of cells) {
    if (!grid.inBounds(x, y)) continue;
    const i = grid.index(x, y);
    if (grid.isEmptyAt(i) || isWallSpecId(grid.specId[i] as number)) continue;
    carried.push({ x, y, specId: grid.specId[i] as number, phase: grid.phase[i] as PhaseCode, u: grid.u[i] as number });
    grid.clearAt(i);
  }
  return carried;
}

/** Puts lifted contents back down, translated by the same offset the vessel
 * moved. Skips anything that would land off-grid (the bench edge clips a
 * vessel's contents the same way it clips everything else) and any wall that
 * isn't this entity's own -- the mover's stale glass is about to be cleaned up
 * by the recomposite, so writing over it is safe, but another entity's wall or
 * the player's own painted glass must survive being dragged past. */
function dropContents(grid: SimGrid, entity: AnyEntity, carried: readonly CarriedCell[], dx: number, dy: number): void {
  for (const cell of carried) {
    const x = cell.x + dx;
    const y = cell.y + dy;
    if (!grid.inBounds(x, y)) continue;
    const i = grid.index(x, y);
    if (isWallSpecId(grid.specId[i] as number) && grid.entityOwner[i] !== entity.entityId) continue;
    grid.setAt(i, cell.specId, cell.phase, cell.u);
  }
}

/** Slides an entity, and whatever it is holding, by (dx, dy).
 *
 * The contents move with it rather than staying put: a beaker dragged upward
 * used to leave its water behind and then have the glass composited straight
 * on top of it, so the water was silently deleted a row at a time. Reshapes
 * and rotations still leave contents where they are (see updateFlaskInstance)
 * -- there's no honest translation for those, and a big shape change moving
 * contents somewhere arbitrary would be worse than leaving them. */
export function moveEntityBy(grid: SimGrid, entity: AnyEntity, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const carried = liftContents(grid, entity);
  defOf(entity.kind).move(grid, entity as never, dx, dy);
  dropContents(grid, entity, carried, dx, dy);
}

export function dragEntityHandleTo(grid: SimGrid, entity: AnyEntity, handleId: number, x: number, y: number): void {
  defOf(entity.kind).dragHandle(grid, entity as never, handleId, x, y);
}

export function rotateEntityTo(entity: AnyEntity, rotation: number): void {
  defOf(entity.kind).rotate?.(entity as never, rotation);
}

/** Builds and returns a new instance from a 'placeEntity' payload, or null
 * when the kind refuses it (see EntityDef.place). The caller pushes the
 * result onto its list and composites. */
export function placeEntityFromWire(grid: SimGrid, params: PlaceEntityWire): AnyEntity | null {
  return defOf(params.kind).place(grid, params as never);
}

/** Ignores a payload whose kind doesn't match the instance -- with never-
 * reused entityIds that can only be a stale or hand-forged message, and
 * dropping it beats misconfiguring whatever the id resolves to. */
export function applyEntitySettings(entity: AnyEntity, settings: EntitySettingsWire): void {
  if (entity.kind !== settings.kind) return;
  defOf(entity.kind).applySettings?.(entity as never, settings as never);
}

export function applyEntityAction(entity: AnyEntity, action: EntityAction): void {
  defOf(entity.kind).action?.(entity as never, action);
}

/** One kind's settings pane, as data -- empty for a kind with nothing to
 * configure (see the glass row). */
export function entitySettingsSchema(kind: EntityKind, mode: EntityPanelMode): readonly EntityField[] {
  return defOf(kind).settingsSchema?.(mode) ?? [];
}

export function entityPanelHint(kind: EntityKind, mode: EntityPanelMode): string | null {
  return defOf(kind).panelHint?.(mode) ?? null;
}

/** The schema values a placed entity reports live (see EntityDef.readoutsOf)
 * -- layered over the edit draft for display, never written back to it. */
export function entityReadouts(wire: EntityWire): Record<string, unknown> {
  return defOf(wire.kind).readoutsOf?.(wire as never) ?? {};
}
