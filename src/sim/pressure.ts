// Gas pressure (M5). Per the design doc's Q11: cells can't compress, so a
// gas cell carries a mole count `n` (grid.n, u8) and pressure is derived via
// the ideal gas law P = nRT/V rather than being a fixed per-species
// constant. A cell has no defined physical size (see heat.ts), so `n` is a
// nominal 0-255 "fullness" unit, not literal moles -- MOLES_PER_UNIT is
// calibrated so a freshly painted, full gas cell (n=255) reads ~1 atm at
// ambient temperature, matching how a freshly painted liquid/solid cell is
// implicitly "full" of its species.
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { AMBIENT_TEMPERATURE_K, CELL_VOLUME_CM3, massOf, temperatureOf } from './heat';
import type { SpeciesTable } from './species';
import { getWall, isWallSpecId } from './walls';

export const GAS_CONSTANT_R = 8.314; // J/(mol*K)
export const CELL_VOLUME_M3 = CELL_VOLUME_CM3 * 1e-6;
export const AMBIENT_PRESSURE_KPA = 101.325;
export const FULL_N = 255;

export const MOLES_PER_UNIT =
  (AMBIENT_PRESSURE_KPA * 1000 * CELL_VOLUME_M3) / (FULL_N * GAS_CONSTANT_R * AMBIENT_TEMPERATURE_K);

export function molesOf(n: number): number {
  return n * MOLES_PER_UNIT;
}

/** Ideal gas law, P = nRT/V, returned in kPa. n=0 (vacuum) is 0 kPa. */
export function pressureKPa(n: number, tempK: number): number {
  if (n <= 0) return 0;
  return (molesOf(n) * GAS_CONSTANT_R * tempK) / CELL_VOLUME_M3 / 1000;
}

const DIFFUSION_RATE = 0.5;
const EXPANSION_RATE = 0.25;

/** Equalizes n between two adjacent gas cells of the *same* species --
 * partial-pressure diffusion. Different species sharing a boundary don't mix
 * their `n` here; that's movement.ts's job (whole-cell swaps). */
function exchangeMoles(grid: SimGrid, deltaN: Int16Array, i: number, j: number): void {
  if (grid.phase[i] !== PhaseCode.Gas || grid.phase[j] !== PhaseCode.Gas) return;
  if (grid.specId[i] !== grid.specId[j]) return;
  const diff = (grid.n[i] as number) - (grid.n[j] as number);
  if (diff === 0) return;
  const flux = Math.round(diff * DIFFUSION_RATE * 0.5);
  if (flux === 0) return;
  deltaN[i] = (deltaN[i] as number) - flux;
  deltaN[j] = (deltaN[j] as number) + flux;
}

/**
 * One pressure tick. Two passes:
 * 1. Order-independent partial-pressure equalization between same-species
 *    gas neighbors (mirrors heat.ts's snapshot-delta approach).
 * 2. A live-mutating expansion pass: a gas cell adjacent to empty space
 *    leaks a fraction of its `n` (and a matching share of its energy, to
 *    keep temperature roughly continuous) into a new gas cell there, so
 *    pressurized gas actually dilutes into a vacuum instead of only
 *    relocating via movement.ts's whole-cell swaps.
 */
export function stepPressure(grid: SimGrid): void {
  const { width, height } = grid;
  const deltaN = new Int16Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid.index(x, y);
      if (grid.phase[idx] !== PhaseCode.Gas) continue;
      if (x + 1 < width) exchangeMoles(grid, deltaN, idx, grid.index(x + 1, y));
      if (y + 1 < height) exchangeMoles(grid, deltaN, idx, grid.index(x, y + 1));
    }
  }

  for (let idx = 0; idx < grid.n.length; idx++) {
    if (grid.phase[idx] !== PhaseCode.Gas) continue;
    const newN = (grid.n[idx] as number) + (deltaN[idx] as number);
    grid.n[idx] = Math.max(0, Math.min(FULL_N, newN));
  }

  const touched = new Uint8Array(width * height);
  const offsets: ReadonlyArray<[number, number]> = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid.index(x, y);
      if (touched[idx] || grid.phase[idx] !== PhaseCode.Gas) continue;
      const n = grid.n[idx] as number;
      if (n <= 1) continue;

      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (!grid.inBounds(nx, ny)) continue;
        const nIdx = grid.index(nx, ny);
        if (touched[nIdx] || grid.specId[nIdx] !== EMPTY) continue;

        const flux = Math.max(1, Math.round(n * EXPANSION_RATE));
        const moved = Math.min(flux, n - 1);
        if (moved <= 0) continue;

        const specId = grid.specId[idx] as number;
        const uShare = ((grid.u[idx] as number) * moved) / n;
        grid.u[idx] = (grid.u[idx] as number) - uShare;
        grid.n[idx] = n - moved;
        grid.setAt(nIdx, specId, PhaseCode.Gas, uShare, moved);
        touched[idx] = 1;
        touched[nIdx] = 1;
        break;
      }
    }
  }
}

const BURST_OFFSETS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Vessel bursting (M6, design doc Q11/"past wall strength the vessel
 * bursts"). wallStrength (walls.ts) is a multiple of ambient pressure, not
 * an absolute kPa constant -- glass/steel/insulator differ only by that one
 * relative number. A wall cell adjacent to a gas cell whose pressure
 * exceeds its threshold is destroyed outright (cleared to empty) rather
 * than weakened incrementally; the next tick's expansion pass in
 * stepPressure is what actually lets gas rush through the gap.
 */
export function stepWallBurst(grid: SimGrid, species: SpeciesTable): void {
  const { width, height } = grid;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid.index(x, y);
      const specId = grid.specId[idx] as number;
      if (!isWallSpecId(specId)) continue;

      const threshold = getWall(specId).wallStrength * AMBIENT_PRESSURE_KPA;

      for (const [dx, dy] of BURST_OFFSETS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!grid.inBounds(nx, ny)) continue;
        const nIdx = grid.index(nx, ny);
        if (grid.phase[nIdx] !== PhaseCode.Gas) continue;

        const gasSpecId = grid.specId[nIdx] as number;
        const mass = massOf(species, gasSpecId);
        const { tempK } = temperatureOf(species.thermalOf(gasSpecId), mass, grid.u[nIdx] as number);
        const pressure = pressureKPa(grid.n[nIdx] as number, tempK);

        if (pressure > threshold) {
          grid.clearAt(idx);
          break;
        }
      }
    }
  }
}
