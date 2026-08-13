// The grabber tool: picks up every non-wall cell within `radius` of an
// anchor and holds them, offset-tracked relative to the anchor, for the
// duration of the drag gesture -- see grabPickUp/grabDrop below.
//
// An earlier version re-scanned "what's within radius of the *current*
// anchor" on every pointermove and translated that by the per-event delta.
// That works for slow-moving solids/liquids but not gas: gas cells drift
// under movement.ts's own buoyancy/diffusion between pointermove events, so
// by the time the next grab step ran, the gas had already left the old
// circle and the new circle's rescan simply missed it -- it looked like the
// gas "escaped" the grab mid-drag. Pulling the held cells out of the grid
// on pickup (grid.clearAt) fixes this at the root: while held, the cells
// aren't part of the simulated grid at all, so movement/heat/react can't
// move them out from under the grab. They're overlaid back into the
// rendered frame while held (see worker.ts) purely for display.
import { PhaseCode, SimGrid } from './grid';
import { forEachCellInRadius } from './geometry';
import { isWallSpecId } from './walls';

export interface HeldCell {
  readonly ox: number;
  readonly oy: number;
  readonly specId: number;
  readonly phase: PhaseCode;
  readonly u: number;
}

export interface GrabState {
  anchorX: number;
  anchorY: number;
  readonly cells: readonly HeldCell[];
}

/** Removes every non-wall cell within `radius` of (cx, cy) from the grid and
 * returns them as a GrabState, offsets stored relative to the anchor. */
export function grabPickUp(grid: SimGrid, cx: number, cy: number, radius: number): GrabState {
  const cells: HeldCell[] = [];
  forEachCellInRadius(grid, cx, cy, radius, (x, y, ox, oy) => {
    const idx = grid.index(x, y);
    if (grid.isEmptyAt(idx)) return;
    const specId = grid.specId[idx] as number;
    if (isWallSpecId(specId)) return;
    cells.push({ ox, oy, specId, phase: grid.phase[idx] as PhaseCode, u: grid.u[idx] as number });
    grid.clearAt(idx);
  });
  return { anchorX: cx, anchorY: cy, cells };
}

/** Writes held cells back into the grid at anchor + offset. A cell whose
 * destination is out of bounds or occupied by a wall is dropped rather than
 * placed -- same "walls are indestructible" rule as pickup. */
export function grabDrop(grid: SimGrid, state: GrabState): void {
  for (const cell of state.cells) {
    const x = state.anchorX + cell.ox;
    const y = state.anchorY + cell.oy;
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    if (isWallSpecId(grid.specId[idx] as number)) continue;
    grid.setAt(idx, cell.specId, cell.phase, cell.u);
  }
}
