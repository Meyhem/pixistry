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
// of truth for the physics (heat.ts reads only those), and the instance list
// is what the Select tool moves around.
import type { SimGrid } from './grid';
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
  readonly id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Each of this line's cells radiates this far (grid.radiatorRadius). */
  radius: number;
  targetK: number;
}

let nextRadiatorId = 1;

/** Test-only: makes ids deterministic across test files (same reason as
 * flask.ts's resetFlaskIds). */
export function resetRadiatorIds(): void {
  nextRadiatorId = 1;
}

/** A radiator is drawn as one bare one-cell-wide line (the same drag the
 * sink/filter tools use), not a brush splat: the radiation radius already
 * controls how far a placement reaches, so a second "how thick is the emitter
 * itself" width was just a second way to spend heat. */
export function radiatorLineCells(instance: RadiatorInstance): Point[] {
  return sinkLineCells(instance.x0, instance.y0, instance.x1, instance.y1, 0);
}

function stampRadiator(grid: SimGrid, instance: RadiatorInstance): void {
  const radius = Math.max(0, Math.min(MAX_RADIATION_REACH, Math.round(instance.radius)));
  for (const { x, y } of radiatorLineCells(instance)) {
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    grid.radiatorRadius[idx] = radius;
    grid.radiatorTargetK[idx] = instance.targetK;
  }
}

/** Zeroes an instance's own cells ahead of re-stamping it elsewhere, then
 * puts back any cell another tracked radiator also covers -- the same
 * crossing rule glass.ts and filter.ts use. A radiator a *scenario* painted
 * (scenario.ts's applyRadiator, which writes the per-cell fields directly and
 * tracks no instance) isn't restored this way: moving a player-drawn line off
 * a scenario's pre-placed heater takes that overlap with it. */
function unstampRadiator(grid: SimGrid, instance: RadiatorInstance, others: readonly RadiatorInstance[]): void {
  for (const { x, y } of radiatorLineCells(instance)) {
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    grid.radiatorRadius[idx] = 0;
    grid.radiatorTargetK[idx] = 0;
  }
  for (const other of others) {
    if (other.id !== instance.id) stampRadiator(grid, other);
  }
}

export interface RadiatorPlacement {
  readonly x0: number;
  readonly y0: number;
  readonly x1: number;
  readonly y1: number;
  readonly radius: number;
  readonly targetK: number;
}

export function placeRadiatorInstance(grid: SimGrid, placement: RadiatorPlacement): RadiatorInstance {
  const instance: RadiatorInstance = {
    id: nextRadiatorId++,
    x0: placement.x0,
    y0: placement.y0,
    x1: placement.x1,
    y1: placement.y1,
    radius: placement.radius,
    targetK: placement.targetK,
  };
  stampRadiator(grid, instance);
  return instance;
}

/** Slides a whole line by (dx, dy), keeping its length and angle. */
export function moveRadiatorInstance(
  grid: SimGrid,
  instances: readonly RadiatorInstance[],
  instance: RadiatorInstance,
  dx: number,
  dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  unstampRadiator(grid, instance, instances);
  instance.x0 += dx;
  instance.y0 += dy;
  instance.x1 += dx;
  instance.y1 += dy;
  stampRadiator(grid, instance);
}

/** Drags one end of the line to (x, y), leaving the other end where it is --
 * the reshaping a two-point line has instead of a tube's knees. */
export function moveRadiatorEndpoint(
  grid: SimGrid,
  instances: readonly RadiatorInstance[],
  instance: RadiatorInstance,
  endIndex: 0 | 1,
  x: number,
  y: number,
): void {
  const cx = endIndex === 0 ? instance.x0 : instance.x1;
  const cy = endIndex === 0 ? instance.y0 : instance.y1;
  if (cx === x && cy === y) return;
  unstampRadiator(grid, instance, instances);
  if (endIndex === 0) {
    instance.x0 = x;
    instance.y0 = y;
  } else {
    instance.x1 = x;
    instance.y1 = y;
  }
  stampRadiator(grid, instance);
}

/** Live-edits a placed radiator's reach/target (the select tool's edit
 * panel) -- re-stamps in place, since both fields live per-cell. */
export function updateRadiatorInstance(grid: SimGrid, instance: RadiatorInstance, radius: number, targetK: number): void {
  instance.radius = radius;
  instance.targetK = targetK;
  stampRadiator(grid, instance);
}

/** Drops any line the eraser has taken off the grid entirely -- same "a drawn
 * line dies only once its last cell is gone" rule as filter.ts's
 * pruneErasedFilters. */
export function pruneErasedRadiators(grid: SimGrid, instances: readonly RadiatorInstance[]): RadiatorInstance[] {
  return instances.filter((instance) =>
    radiatorLineCells(instance).some(({ x, y }) => grid.inBounds(x, y) && (grid.radiatorRadius[grid.index(x, y)] as number) > 0),
  );
}
