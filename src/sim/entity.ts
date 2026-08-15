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
import type { SimGrid } from './grid';
import { FLASK_FACINGS, flaskShapeFor } from './flask-shapes';
import { FUNNEL_FACINGS, funnelShapeFor } from './apparatus-shapes';
import { sinkLineCells } from './sink';
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
  TubeWire,
} from './protocol';
import type { Point } from './tube-shapes';

export type { EntityKind } from './protocol';

export type AnyEntity = FunnelInstance | TubeInstance | FlaskInstance | FilterInstance | RadiatorInstance | GlassInstance;

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
}

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
}

interface WireOfKind {
  funnel: FunnelWire;
  tube: TubeWire;
  flask: FlaskWire;
  filter: FilterWire;
  radiator: RadiatorWire;
  glass: GlassWire;
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
}

/** How close a click has to be to a one-cell-wide line (a filter, a radiator,
 * a glass wall) or a tube's channel to count as landing on it. A couple of
 * cells of slack, since a 1px line is otherwise unclickable at any sane
 * zoom. */
const LINE_HIT_RADIUS = 2;

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
      points: tube.points.map((p) => ({ x: p.x, y: p.y })),
      filter: tube.filter ? [...tube.filter] : null,
    }),
    applySettings: (tube, settings) => updateTubeInstance(tube, { filter: settings.filter ? new Set(settings.filter) : null }),
  },
  flask: {
    footprintOf: (flask) => ({ wall: flaskFootprint(flask).wallCells }),
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
      }),
    toWire: (flask) => ({
      kind: 'flask',
      entityId: flask.entityId,
      x: flask.x,
      y: flask.y,
      facing: flask.facing,
      sizeScale: flask.sizeScale,
      stirred: flask.stirred,
      flaskKind: flask.flaskKind,
    }),
    applySettings: (flask, settings) =>
      updateFlaskInstance(flask, {
        facing: settings.facing,
        sizeScale: settings.sizeScale,
        stirred: settings.stirred,
        flaskKind: settings.flaskKind,
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
      x0: filter.x0,
      y0: filter.y0,
      x1: filter.x1,
      y1: filter.y1,
      species: [...filter.species],
    }),
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
      x0: radiator.x0,
      y0: radiator.y0,
      x1: radiator.x1,
      y1: radiator.y1,
      radiationRadius: radiator.radius,
      targetTempC: kelvinToCelsius(radiator.targetK),
    }),
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
      points: glassPoints(glass),
      rotation: glass.rotation,
    }),
  },
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
        bestHandle = { hit: { entityId: wire.entityId, kind: wire.kind, handleId: handle.handleId }, dist };
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
      bestBody = { hit: { entityId: wire.entityId, kind: wire.kind, handleId: null }, area, dist };
    }
  }
  return bestBody ? bestBody.hit : null;
}

export function moveEntityBy(grid: SimGrid, entity: AnyEntity, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  defOf(entity.kind).move(grid, entity as never, dx, dy);
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
