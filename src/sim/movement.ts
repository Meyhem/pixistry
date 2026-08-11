// Bottom-up falling-sand scan with alternating horizontal parity, per the
// design doc. Density (not a fixed solid > liquid > gas ranking) decides
// whether a cell may displace its neighbour, so a denser gas can still sink
// through a lighter one, etc. Swaps are probabilistic so mixing takes time.
import { EMPTY, PhaseCode, SimGrid } from './grid';
import type { SpeciesTable } from './species';

type Rng = () => number;

const DIAGONAL_P = 0.7;
const LIQUID_SPREAD_P = 0.4;
const GAS_SPREAD_P = 0.5;

function canDisplace(
  grid: SimGrid,
  species: SpeciesTable,
  fromSpecId: number,
  targetIdx: number,
  direction: 'down' | 'up',
): boolean {
  if (grid.isEmptyAt(targetIdx)) return true;
  const targetSpecId = grid.specId[targetIdx] as number;
  const fromDensity = species.densityOf(fromSpecId);
  const targetDensity = species.densityOf(targetSpecId);
  return direction === 'down' ? fromDensity > targetDensity : fromDensity < targetDensity;
}

function pickDiagonalOrder(rng: Rng): [number, number] {
  return rng() < 0.5 ? [-1, 1] : [1, -1];
}

function moveFalling(
  grid: SimGrid,
  species: SpeciesTable,
  moved: Uint8Array,
  x: number,
  y: number,
  idx: number,
  specId: number,
  rng: Rng,
  canSpreadHorizontally: boolean,
): void {
  const belowY = y + 1;
  if (grid.inBounds(x, belowY)) {
    const belowIdx = grid.index(x, belowY);
    if (canDisplace(grid, species, specId, belowIdx, 'down')) {
      grid.swap(idx, belowIdx);
      moved[idx] = 1;
      moved[belowIdx] = 1;
      return;
    }

    for (const dx of pickDiagonalOrder(rng)) {
      const nx = x + dx;
      if (!grid.inBounds(nx, belowY)) continue;
      const nIdx = grid.index(nx, belowY);
      if (moved[nIdx]) continue;
      if (canDisplace(grid, species, specId, nIdx, 'down') && rng() < DIAGONAL_P) {
        grid.swap(idx, nIdx);
        moved[idx] = 1;
        moved[nIdx] = 1;
        return;
      }
    }
  }

  if (!canSpreadHorizontally) return;
  for (const dx of pickDiagonalOrder(rng)) {
    const nx = x + dx;
    if (!grid.inBounds(nx, y)) continue;
    const nIdx = grid.index(nx, y);
    if (moved[nIdx]) continue;
    if (grid.isEmptyAt(nIdx) && rng() < LIQUID_SPREAD_P) {
      grid.swap(idx, nIdx);
      moved[idx] = 1;
      moved[nIdx] = 1;
      return;
    }
  }
}

function moveRising(
  grid: SimGrid,
  species: SpeciesTable,
  moved: Uint8Array,
  x: number,
  y: number,
  idx: number,
  specId: number,
  rng: Rng,
): void {
  const aboveY = y - 1;
  if (grid.inBounds(x, aboveY)) {
    const aboveIdx = grid.index(x, aboveY);
    if (canDisplace(grid, species, specId, aboveIdx, 'up')) {
      grid.swap(idx, aboveIdx);
      moved[idx] = 1;
      moved[aboveIdx] = 1;
      return;
    }

    for (const dx of pickDiagonalOrder(rng)) {
      const nx = x + dx;
      if (!grid.inBounds(nx, aboveY)) continue;
      const nIdx = grid.index(nx, aboveY);
      if (moved[nIdx]) continue;
      if (canDisplace(grid, species, specId, nIdx, 'up') && rng() < DIAGONAL_P) {
        grid.swap(idx, nIdx);
        moved[idx] = 1;
        moved[nIdx] = 1;
        return;
      }
    }
  }

  for (const dx of pickDiagonalOrder(rng)) {
    const nx = x + dx;
    if (!grid.inBounds(nx, y)) continue;
    const nIdx = grid.index(nx, y);
    if (moved[nIdx]) continue;
    if (grid.isEmptyAt(nIdx) && rng() < GAS_SPREAD_P) {
      grid.swap(idx, nIdx);
      moved[idx] = 1;
      moved[nIdx] = 1;
      return;
    }
  }
}

/** One movement tick. Mutates grid in place. */
export function stepMovement(grid: SimGrid, species: SpeciesTable, rng: Rng, tick: number): void {
  const { width, height } = grid;
  const leftToRight = tick % 2 === 0;
  const moved = new Uint8Array(width * height);

  for (let y = height - 1; y >= 0; y--) {
    for (let xi = 0; xi < width; xi++) {
      const x = leftToRight ? xi : width - 1 - xi;
      const idx = grid.index(x, y);
      if (moved[idx] || grid.specId[idx] === EMPTY) continue;

      const specId = grid.specId[idx] as number;
      const phase = species.phaseOf(specId);
      if (phase === PhaseCode.Solid) moveFalling(grid, species, moved, x, y, idx, specId, rng, false);
      else if (phase === PhaseCode.Liquid) moveFalling(grid, species, moved, x, y, idx, specId, rng, true);
      else if (phase === PhaseCode.Gas) moveRising(grid, species, moved, x, y, idx, specId, rng);
    }
  }
}
