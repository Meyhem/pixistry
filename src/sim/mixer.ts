// The mixer tool (M4): forces extra random local swaps between adjacent
// liquid/gas cells within a radius, independent of movement.ts's
// density-driven swap logic. This is stirring only -- the mixer's "real"
// chemistry purpose (forcing contact for interface-limited immiscible
// pairs) has no effect yet because reactions aren't wired into the grid
// tick loop (see ARCHITECTURE.md's "What's next"). Until that wiring
// exists, stirring just visibly speeds up two liquids/gases mixing by
// color.
import { PhaseCode, SimGrid } from './grid';
import { isWallSpecId } from './walls';

type Rng = () => number;

const NEIGHBOR_OFFSETS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function isStirrable(grid: SimGrid, idx: number): boolean {
  if (grid.isEmptyAt(idx)) return false;
  const specId = grid.specId[idx] as number;
  if (isWallSpecId(specId)) return false;
  const phase = grid.phase[idx] as PhaseCode;
  return phase === PhaseCode.Liquid || phase === PhaseCode.Gas;
}

/**
 * One stir pulse centered at (cx, cy): for each stirrable cell within
 * `radius`, with probability `swapProbability`, swap it with a random
 * stirrable orthogonal neighbor. Mutates grid in place.
 */
export function stirRegion(
  grid: SimGrid,
  rng: Rng,
  cx: number,
  cy: number,
  radius: number,
  swapProbability = 0.5,
): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!grid.inBounds(x, y)) continue;
      const idx = grid.index(x, y);
      if (!isStirrable(grid, idx)) continue;
      if (rng() >= swapProbability) continue;

      const offset = NEIGHBOR_OFFSETS[Math.floor(rng() * NEIGHBOR_OFFSETS.length)] as [number, number];
      const nx = x + offset[0];
      const ny = y + offset[1];
      if (!grid.inBounds(nx, ny)) continue;
      const nIdx = grid.index(nx, ny);
      if (!isStirrable(grid, nIdx)) continue;

      grid.swap(idx, nIdx);
    }
  }
}
