// The mixer tool (M4): randomizes every non-empty, non-wall cell within a
// brush radius (solids included -- this sim's solids are already granular
// and fall like sand, so shuffling them is physically consistent),
// independent of movement.ts's density-driven swap logic. This is
// stirring only -- the mixer's "real" chemistry purpose (forcing contact
// for interface-limited immiscible pairs) has no effect yet because
// reactions aren't wired into the grid tick loop (see ARCHITECTURE.md's
// "What's next"). Until that wiring exists, stirring just visibly speeds up
// mixing by color.
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
import { PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { forEachCellInRadius } from './geometry';
import { isWallSpecId } from './walls';

type Rng = () => number;

export function isStirrable(grid: SimGrid, idx: number): boolean {
  if (grid.isEmptyAt(idx)) return false;
  const specId = grid.specId[idx] as number;
  return !isWallSpecId(specId);
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

const POP_PROBABILITY = 0.12;
const MAX_POP_HEIGHT = 3;

/** Gives stirring a visible "agitation" kick on top of shuffleCells' in-place
 * content swap: a fraction of solid/liquid cells (gas already rises on its
 * own via movement.ts) jump straight up into whatever empty headroom sits
 * above them, capped at MAX_POP_HEIGHT and stopping at the first
 * obstruction (wall, other matter, or a tube's lumen) rather than tunneling
 * through it. Ordinary gravity in movement.ts then pulls them back down over
 * the next few ticks, so the visible effect is a chaotic bubble/splash
 * rather than a clean instantaneous permutation. */
export function agitateCells(grid: SimGrid, rng: Rng, indices: readonly number[]): void {
  for (const idx of indices) {
    if (rng() >= POP_PROBABILITY) continue;
    const phase = grid.phase[idx] as PhaseCode;
    if (phase !== PhaseCode.Solid && phase !== PhaseCode.Liquid) continue;
    const x = idx % grid.width;
    const y = Math.floor(idx / grid.width);
    let targetY = y;
    for (let step = 1; step <= MAX_POP_HEIGHT; step++) {
      const ny = y - step;
      if (!grid.inBounds(x, ny)) break;
      const nIdx = grid.index(x, ny);
      if (!grid.isEmptyAt(nIdx) || (grid.tubeMask[nIdx] as TubeMaskValue) === TubeMaskValue.Lumen) break;
      targetY = ny;
    }
    if (targetY === y) continue;
    grid.swap(idx, grid.index(x, targetY));
  }
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
  agitateCells(grid, rng, indices);
}
