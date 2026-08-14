// Placed-flask apparatus: a piece of glassware (Erlenmeyer or beaker, see
// flask-shapes.ts) that the select-apparatus tool can pick up and re-edit
// after placement.
//
// This used to be a one-shot stamp -- 'placeFlask' wrote glass cells and
// masks straight into the grid and forgot everything else, exactly like
// painting a wall material. That made a placed flask uneditable: nothing on
// the main thread knew where one was, what size it had been stamped at, or
// which cells to clear to redraw it. So a flask is tracked state now, same
// as funnel.ts's FunnelInstance and tube.ts's TubeInstance -- but unlike
// those two it still has no per-tick step function of its own: the vessel
// only ever acts through the glass walls and the vessel/stirrer masks it
// stamps, which the movement/stirrer passes already handle.
import { clearCells, stampGlass } from './apparatus';
import { flaskShapeFor, type FlaskFacing, type FlaskKind } from './flask-shapes';
import type { SimGrid } from './grid';
import type { SpeciesTable } from './species';
import type { Point } from './tube-shapes';

export const FLASK_COLOR = '#a9d6e8'; // same glass tint as the funnel/tube/plain glass wall

export interface FlaskConfig {
  readonly x: number;
  readonly y: number;
  readonly facing: FlaskFacing;
  readonly sizeScale: number;
  readonly stirred: boolean;
  readonly kind: FlaskKind;
}

export interface FlaskInstance {
  readonly id: number;
  x: number;
  y: number;
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  kind: FlaskKind;
}

let nextFlaskId = 1;

/** Test-only: makes ids deterministic across test files (each of which gets
 * its own module instance, but a single file placing flasks in several tests
 * would otherwise keep counting up). */
export function resetFlaskIds(): void {
  nextFlaskId = 1;
}

interface Footprint {
  readonly wallCells: Point[];
  readonly reservoirCells: Point[];
}

function footprintOf(instance: FlaskInstance): Footprint {
  const shape = flaskShapeFor(instance.facing, instance.sizeScale, instance.kind);
  return {
    wallCells: shape.cells.map((cell) => ({ x: instance.x + cell.dx, y: instance.y + cell.dy })),
    reservoirCells: shape.reservoirCells.map((cell) => ({ x: instance.x + cell.dx, y: instance.y + cell.dy })),
  };
}

/** Draws the vessel: glass outline as real wall matter, plus vesselMask over
 * the interior (which movement.ts's tryDiagonal reads to stop matter hopping
 * diagonally through the glass instead of going in the mouth) and
 * stirrerMask over the same interior for the stirred variant. */
export function stampFlask(grid: SimGrid, species: SpeciesTable, instance: FlaskInstance): void {
  const { wallCells, reservoirCells } = footprintOf(instance);
  stampGlass(grid, species, wallCells);
  for (const { x, y } of reservoirCells) {
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    grid.vesselMask[idx] = 1;
    if (instance.stirred) grid.stirrerMask[idx] = 1;
  }
}

/** The inverse of stampFlask: clears the glass outline back to empty and
 * drops the interior's masks. Whatever the vessel was holding stays exactly
 * where it is -- only the glass and the overlays are erased, so a resize or
 * a move re-stamps around (or away from) the contents rather than deleting
 * them. */
export function unstampFlask(grid: SimGrid, instance: FlaskInstance): void {
  const { wallCells, reservoirCells } = footprintOf(instance);
  clearCells(grid, wallCells);
  for (const { x, y } of reservoirCells) {
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    grid.vesselMask[idx] = 0;
    grid.stirrerMask[idx] = 0;
  }
}

export function placeFlaskInstance(grid: SimGrid, species: SpeciesTable, config: FlaskConfig): FlaskInstance {
  const instance: FlaskInstance = {
    id: nextFlaskId++,
    x: config.x,
    y: config.y,
    facing: config.facing,
    sizeScale: config.sizeScale,
    stirred: config.stirred,
    kind: config.kind,
  };
  stampFlask(grid, species, instance);
  return instance;
}

/** Applies an edit (shape/size/stirred/facing, any subset) by erasing the
 * old footprint first and re-stamping the new one -- the same
 * unstamp-mutate-restamp shape tube.ts uses for a knee drag, and the reason
 * a resize doesn't leave the previous outline behind as orphaned glass. */
export function updateFlaskInstance(
  grid: SimGrid,
  species: SpeciesTable,
  instance: FlaskInstance,
  patch: Partial<Pick<FlaskInstance, 'facing' | 'sizeScale' | 'stirred' | 'kind'>>,
): void {
  unstampFlask(grid, instance);
  if (patch.facing !== undefined) instance.facing = patch.facing;
  if (patch.sizeScale !== undefined) instance.sizeScale = patch.sizeScale;
  if (patch.stirred !== undefined) instance.stirred = patch.stirred;
  if (patch.kind !== undefined) instance.kind = patch.kind;
  stampFlask(grid, species, instance);
}

export function moveFlaskInstance(grid: SimGrid, species: SpeciesTable, instance: FlaskInstance, x: number, y: number): void {
  if (instance.x === x && instance.y === y) return;
  unstampFlask(grid, instance);
  instance.x = x;
  instance.y = y;
  stampFlask(grid, species, instance);
}
