// Heater/cooler apparatus, merged into a single "Radiator" tool -- pure
// radiation, no collision. A placed radiator is NOT matter: it doesn't
// occupy grid.specId at all, so nothing falls onto it, displaces it, or is
// blocked by it -- a particle simply passes through (or rests on top of, or
// sits inside) the same cell, and that's what changes its temperature.
//
// There's no separate heater/cooler kind anymore: a radiator just carries a
// target temperature (grid.radiatorTargetK) and drives every cell within
// its reach (grid.radiatorRadius) toward that target every tick -- heating
// cells below it, cooling cells above it (see heat.ts's
// applyPointHeatSource) -- so whether a given placement acts as a heater or
// a cooler falls out of the target the player picked, not a separate tool.
// Both fields are captured once, at placement time, from whatever the side
// panel's radiation-radius/target-temperature sliders read at that moment
// (see worker.ts's 'paintRadiatorLine' handler), so moving those sliders
// afterward never changes a radiator already placed on the grid -- to change
// one you pick it up with the Select tool, which edits that instance's own
// copy of the settings.
//
// A drawn radiator is a tracked instance (below) as well as those two per-cell
// fields, for the same reason filter.ts's lines are: the grid arrays say what
// every cell radiates, but nothing in them says which drag put it there, so a
// placed radiator used to be unmovable and unedited-able -- the only way to
// change one was to erase it and redraw. The per-cell fields stay the source
// of truth for the physics (heat.ts reads only those), the instance list is
// what the Select tool moves around, and the compositor (entity-composite.ts)
// derives the former from the latter -- nothing here writes the grid.
import { nextEntityId } from './entity-id';
import { sinkLineCells } from './sink';
import type { Point } from './tube-shapes';

export const RADIATOR_WATTS = 400;
export const RADIATOR_LABEL = 'Radiator';
export const RADIATOR_COLOR = 'linear-gradient(135deg, #ff9d5c 0%, #5cc8ff 100%)';

/** grid.radiatorRadius is a Uint8Array, so a per-cell reach can't exceed
 * this -- the side panel's own slider stops well short (see
 * MAX_RADIATION_RADIUS), this is just the clamp that keeps a hand-sent
 * message from wrapping around to a tiny radius. */
const MAX_RADIATION_REACH = 255;

export interface RadiatorInstance {
  readonly kind: 'radiator';
  /** Set on apparatus a scenario placed as fixed bench furniture: the worker
   * refuses to move, reshape, reconfigure or delete it, so a campaign bench
   * can't be dismantled mid-puzzle. Undefined for anything the player
   * placed. */
  readonly locked?: boolean;
  /** Placement order across every apparatus kind -- see entity-id.ts. */
  readonly entityId: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Each of this line's cells radiates this far (grid.radiatorRadius). */
  radius: number;
  targetK: number;
  /** How far the emitter itself is thickened around the drawn line, in the
   * same "0 = the bare 1px line" sense as sinkLineCells' width. The Radiator
   * *tool* always draws 0 (the radiation reach already controls how far a
   * placement carries, so a second "how thick is the emitter" width was just
   * a second way to spend heat) -- it exists because a scenario's `radiator`
   * setup command paints a disc of emitting cells rather than a line, and
   * campaign heaters have to be real tracked instances or the first
   * recomposite would wipe them off the bench (see scenario.ts). */
  width: number;
}

/** The emitting cells themselves -- the drawn line, thickened by the
 * instance's own `width` (0 for everything the Radiator tool draws). */
export function radiatorLineCells(instance: RadiatorInstance): Point[] {
  return sinkLineCells(instance.x0, instance.y0, instance.x1, instance.y1, instance.width);
}

/** What the compositor writes into grid.radiatorRadius/radiatorTargetK for
 * this instance. The reach is clamped here rather than at the field, since
 * radiatorRadius is a Uint8Array and an unclamped hand-sent message would
 * otherwise wrap a huge reach around to a tiny one. */
export function radiatorStamp(instance: RadiatorInstance): { cells: Point[]; radius: number; targetK: number } {
  return {
    cells: radiatorLineCells(instance),
    radius: Math.max(0, Math.min(MAX_RADIATION_REACH, Math.round(instance.radius))),
    targetK: instance.targetK,
  };
}

export interface RadiatorPlacement {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly radius: number;
  readonly targetK: number;
  /** Defaults to a bare one-cell-wide line -- see RadiatorInstance.width. */
  readonly width?: number;
}

export function placeRadiatorInstance(placement: RadiatorPlacement): RadiatorInstance {
  return {
    kind: 'radiator',
    entityId: nextEntityId(),
    x0: placement.x0,
    y0: placement.y0,
    x1: placement.x1,
    y1: placement.y1,
    radius: placement.radius,
    targetK: placement.targetK,
    width: placement.width ?? 0,
  };
}

/** Slides a whole line by (dx, dy), keeping its length and angle. */
export function moveRadiatorInstance(instance: RadiatorInstance, dx: number, dy: number): void {
  instance.x0 += dx;
  instance.y0 += dy;
  instance.x1 += dx;
  instance.y1 += dy;
}

/** Drags one end of the line to (x, y), leaving the other end where it is --
 * the reshaping a two-point line has instead of a tube's knees. */
export function moveRadiatorEndpoint(instance: RadiatorInstance, endIndex: 0 | 1, x: number, y: number): void {
  if (endIndex === 0) {
    instance.x0 = x;
    instance.y0 = y;
  } else {
    instance.x1 = x;
    instance.y1 = y;
  }
}

/** Live-edits a placed radiator's reach/target (the select tool's edit
 * panel). */
export function updateRadiatorInstance(instance: RadiatorInstance, radius: number, targetK: number): void {
  instance.radius = radius;
  instance.targetK = targetK;
}
