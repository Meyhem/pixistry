// The Sink apparatus: a player-drawn straight line (grid.sinkMask overlay,
// same "fixed background field, not matter" convention as filterMask/
// stirrerMask/tubeMask -- see grid.ts) that consumes any non-wall matter
// resting on it and tallies it into one global per-species counter. This is
// the counting/objective primitive campaign scenarios will build on (see
// .grill/campaign-mode.md) -- this first pass ships it to sandbox standalone,
// since "how much have I made" is a fun toy on its own with no campaign code
// at all.
import type { SimGrid } from './grid';
import { SPECIES } from './species-data';
import { isWallSpecId } from './walls';

export const SINK_LABEL = 'Sink';
export const SINK_COLOR = '#e0489e';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Every grid cell on the straight line from (x0,y0) to (x1,y1), thickened
 * by `width` (same convention as geometry.ts's forEachCellInRadius radius --
 * 0 means the bare 1px line, 1 adds a ring of cells around each line cell,
 * etc.), deduplicated. Plain Bresenham for the core line: unlike
 * tube-shapes.ts's polylineToLumenPath, which only ever walks already-
 * octant-snapped segments, a sink is a single free-form drag at any angle,
 * so this is the one place in src/sim that needs a real Bresenham. */
export function sinkLineCells(x0: number, y0: number, x1: number, y1: number, width: number): Point[] {
  const core: Point[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    core.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  if (width <= 0) return core;

  const r2 = width * width;
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const c of core) {
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) {
        if (ox * ox + oy * oy > r2) continue;
        const px = c.x + ox;
        const py = c.y + oy;
        const k = `${px},${py}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x: px, y: py });
      }
    }
  }
  return out;
}

/** One global counter shared by every sink line on the grid (per the
 * brainstorm's "not per sink, one global counter" spec) -- indexed by
 * specId, sized to the static species table so every real species has a
 * slot. Wall specIds are never tallied (see stepSinks), so they need no
 * slot here. */
export class SinkCounter {
  readonly totals = new Uint32Array(SPECIES.length);
  grandTotal = 0;

  reset(): void {
    this.totals.fill(0);
    this.grandTotal = 0;
  }
}

/** One tick's worth of sink consumption: every non-empty, non-wall cell
 * sitting on a sink-masked cell is tallied by specId into `counter` and
 * cleared from the grid. Called last in worker.ts's runOneTick, after
 * stepReactions -- a reactant pair that lands on a sink cell gets its normal
 * chance to react there first, so a sink counts whatever's really present
 * at the end of the tick (a collection port) rather than intercepting
 * feedstock the moment it arrives (a drain) -- see
 * .grill/campaign-mode.md's tick-order decision. */
export function stepSinks(grid: SimGrid, counter: SinkCounter): void {
  for (let idx = 0; idx < grid.sinkMask.length; idx++) {
    if (grid.sinkMask[idx] === 0) continue;
    if (grid.isEmptyAt(idx)) continue;
    const specId = grid.specId[idx] as number;
    if (isWallSpecId(specId)) continue;
    counter.totals[specId] = (counter.totals[specId] as number) + 1;
    counter.grandTotal += 1;
    grid.clearAt(idx);
  }
}
