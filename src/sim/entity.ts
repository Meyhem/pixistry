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
import { FLASK_FACINGS } from './flask-shapes';
import { FUNNEL_FACINGS } from './apparatus-shapes';
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
import { glassCells, glassPoints, moveGlassCorner, moveGlassInstance, placeGlassInstance, rotateGlassInstance, type GlassInstance } from './glass';
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

export const ENTITY_DEFS: { [K in EntityKind]: EntityDef<K> } = {
  funnel: {
    footprintOf: (funnel) => ({ wall: funnelGlassCells(funnel) }),
    handlesOf: () => [],
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
