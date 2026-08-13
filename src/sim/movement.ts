// Bottom-up falling-sand scan with alternating horizontal parity, per the
// design doc. Density (not a fixed solid > liquid > gas ranking) decides
// whether a cell may displace its neighbour, so a denser gas can still sink
// through a lighter one, etc. Swaps are probabilistic so mixing takes time.
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { massOf, temperatureOf } from './heat';
import type { SpeciesTable } from './species';
import { isWallSpecId } from './walls';

type Rng = () => number;

const DIAGONAL_P = 0.7;
const LIQUID_SPREAD_P = 0.4;
const GAS_SPREAD_P = 0.5;

/** Density for buoyancy purposes: species.densityOf's fixed table value for
 * solid/liquid, but the cell's actual temperature-scaled gas density (see
 * SpeciesTable.buoyantDensityOf) once it's actually boiled -- otherwise a
 * gas-phase cell reports the same density as the liquid it just came from
 * and can never rise through it. Only reads grid.u (via temperatureOf) when
 * the cell is actually in Gas phase, since that's the only case where
 * buoyantDensityOf's result differs from densityOf's. */
function displaceDensity(grid: SimGrid, species: SpeciesTable, idx: number, specId: number, phase: PhaseCode): number {
  if (phase !== PhaseCode.Gas) return species.densityOf(specId);
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  const tempK = temperatureOf(thermal, mass, grid.u[idx] as number).tempK;
  return species.buoyantDensityOf(specId, phase, tempK);
}

function canDisplace(
  grid: SimGrid,
  species: SpeciesTable,
  fromIdx: number,
  fromSpecId: number,
  fromPhase: PhaseCode,
  targetIdx: number,
  direction: 'down' | 'up',
): boolean {
  if (grid.isEmptyAt(targetIdx)) return true;
  const targetSpecId = grid.specId[targetIdx] as number;
  if (isWallSpecId(targetSpecId)) return false;
  // Density sorting is a liquid/gas thing -- two solid grains never swap
  // places by density, they just pile up static once resting, so a denser
  // solid can't tunnel through a lighter one underneath it.
  const targetPhase = grid.phase[targetIdx] as PhaseCode;
  if (fromPhase === PhaseCode.Solid && targetPhase === PhaseCode.Solid) return false;
  const fromDensity = displaceDensity(grid, species, fromIdx, fromSpecId, fromPhase);
  const targetDensity = displaceDensity(grid, species, targetIdx, targetSpecId, targetPhase);
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
  fromPhase: PhaseCode,
  rng: Rng,
  canSpreadHorizontally: boolean,
): void {
  const belowY = y + 1;
  if (grid.inBounds(x, belowY)) {
    const belowIdx = grid.index(x, belowY);
    if (canDisplace(grid, species, idx, specId, fromPhase, belowIdx, 'down')) {
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
      if (canDisplace(grid, species, idx, specId, fromPhase, nIdx, 'down') && rng() < DIAGONAL_P) {
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
    if (canDisplace(grid, species, idx, specId, PhaseCode.Gas, aboveIdx, 'up')) {
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
      if (canDisplace(grid, species, idx, specId, PhaseCode.Gas, nIdx, 'up') && rng() < DIAGONAL_P) {
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
      // Walls never move: neither a mover nor moveable-into (blocked above
      // in canDisplace). Skip immediately rather than treating them as an
      // infinitely-dense solid, since that would still cost a canDisplace
      // check every tick for no benefit.
      if (isWallSpecId(specId)) continue;
      const phase = grid.phase[idx] as PhaseCode;
      if (phase === PhaseCode.Solid) moveFalling(grid, species, moved, x, y, idx, specId, phase, rng, false);
      else if (phase === PhaseCode.Liquid) moveFalling(grid, species, moved, x, y, idx, specId, phase, rng, true);
      else if (phase === PhaseCode.Gas) moveRising(grid, species, moved, x, y, idx, specId, rng);
    }
  }
}
