// The mixer tool (M4): randomizes every liquid/gas cell within a brush
// radius, independent of movement.ts's density-driven swap logic. This is
// stirring only -- the mixer's "real" chemistry purpose (forcing contact
// for interface-limited immiscible pairs) has no effect yet because
// reactions aren't wired into the grid tick loop (see ARCHITECTURE.md's
// "What's next"). Until that wiring exists, stirring just visibly speeds up
// two liquids/gases mixing by color.
//
// Originally did a per-cell probabilistic single swap with one random
// neighbor, which visibly failed to actually randomize a stirred region --
// most cells in the brush never moved on a given call. Rewritten to instead
// collect every stirrable cell in the region and permute their contents
// (Fisher-Yates over the values, not the positions), so one call genuinely
// randomizes every pixel within the radius. Combined with worker.ts's
// stirState, which calls this once per simulation tick for as long as the
// mixer brush is held down, "every pixel in the brush is randomized every
// tick" is now literal, not just per pointer-move event.
import { PhaseCode, SimGrid } from './grid';
import { forEachCellInRadius } from './geometry';
import { isWallSpecId } from './walls';

type Rng = () => number;

export function isStirrable(grid: SimGrid, idx: number): boolean {
  if (grid.isEmptyAt(idx)) return false;
  const specId = grid.specId[idx] as number;
  if (isWallSpecId(specId)) return false;
  const phase = grid.phase[idx] as PhaseCode;
  return phase === PhaseCode.Liquid || phase === PhaseCode.Gas;
}

/** Randomly permutes the (specId, phase, u) contents held at `indices` --
 * every cell keeps its grid position but ends up holding a random other
 * cell's contents (Fisher-Yates over the collected values). Shared by the
 * mixer's circular brush (stirRegion below) and the stirrer apparatus's
 * painted-overlay shape (see stirrer.ts), so both tools agitate cells the
 * same way. */
export function shuffleCells(grid: SimGrid, rng: Rng, indices: readonly number[]): void {
  if (indices.length < 2) return;
  const specId = indices.map((i) => grid.specId[i] as number);
  const phase = indices.map((i) => grid.phase[i] as number);
  const u = indices.map((i) => grid.u[i] as number);

  for (let i = indices.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const si = specId[i] as number;
    specId[i] = specId[j] as number;
    specId[j] = si;
    const ph = phase[i] as number;
    phase[i] = phase[j] as number;
    phase[j] = ph;
    const ui = u[i] as number;
    u[i] = u[j] as number;
    u[j] = ui;
  }

  indices.forEach((idx, k) => {
    grid.specId[idx] = specId[k] as number;
    grid.phase[idx] = phase[k] as number;
    grid.u[idx] = u[k] as number;
  });
}

/**
 * One stir pulse centered at (cx, cy): collects every stirrable cell within
 * `radius` and randomly permutes their contents, so every pixel in the
 * brush ends up holding a (random) stirrable cell's contents. Mutates grid
 * in place.
 */
export function stirRegion(grid: SimGrid, rng: Rng, cx: number, cy: number, radius: number): void {
  const indices: number[] = [];
  forEachCellInRadius(grid, cx, cy, radius, (x, y) => {
    const idx = grid.index(x, y);
    if (isStirrable(grid, idx)) indices.push(idx);
  });
  shuffleCells(grid, rng, indices);
}
