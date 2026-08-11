// Wires the static reaction table (reactions.ts) into the grid tick loop.
// Every adjacent non-empty, non-wall cell pair is checked against
// findReaction once per tick (each unordered pair visited exactly once, via
// the same "check right + down neighbor from the top-left cell" scan
// heat.ts uses) and fires probabilistically once past its ignition
// threshold. This is what makes dissolution (NaCl + H2O -> aqueous ions)
// actually happen on the grid -- it's just another rule in the table.
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { clampEnergyToMaxTemp, massOf, temperatureOf } from './heat';
import { findReaction } from './reactions';
import type { SpeciesTable } from './species';
import { SPECIES } from './species-data';
import { isWallSpecId } from './walls';

type Rng = () => number;

const NEIGHBOR_OFFSETS: ReadonlyArray<[number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Finds an empty, untouched, non-wall neighbor of either (x,y) or (nx,ny)
 * -- room for a reaction's 3rd product, when there is one. */
function findEmptyNeighbor(grid: SimGrid, touched: Uint8Array, x: number, y: number, nx: number, ny: number): number {
  for (const [cx, cy] of [[x, y] as [number, number], [nx, ny] as [number, number]]) {
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const px = cx + dx;
      const py = cy + dy;
      if (!grid.inBounds(px, py)) continue;
      const idx = grid.index(px, py);
      if (touched[idx] || grid.specId[idx] !== EMPTY) continue;
      return idx;
    }
  }
  return -1;
}

/** Splits totalEnergy/totalN across product cells proportional to each
 * product's own nominal parcel mass (density * cell volume, same convention
 * as heat.ts), then derives each slot's real phase from its own thermal
 * profile -- a product only keeps a share of n if it actually condenses out
 * as a gas. */
function placeProducts(
  grid: SimGrid,
  species: SpeciesTable,
  slots: number[],
  productSpecIds: readonly number[],
  totalEnergy: number,
  totalN: number,
): void {
  const masses = productSpecIds.map((specId) => massOf(species, specId));
  const totalMass = masses.reduce((s, m) => s + m, 0) || 1;

  for (let k = 0; k < slots.length; k++) {
    const idx = slots[k] as number;
    const specId = productSpecIds[k] as number;
    const weight = (masses[k] as number) / totalMass;
    const thermal = species.thermalOf(specId);
    // A cell that keeps getting freshly re-ignited tick after tick (new
    // reactant drifting back into the same spot) has no per-tick rate limit
    // the way conduction does -- clamp to the same absolute ceiling so
    // repeated firing can't climb into physically absurd territory.
    const uK = clampEnergyToMaxTemp(thermal, masses[k] as number, Math.max(0, totalEnergy * weight));
    const { phase } = temperatureOf(thermal, masses[k] as number, uK);
    const nK = phase === PhaseCode.Gas ? Math.round(totalN * weight) : 0;
    grid.setAt(idx, specId, phase, uK, nK);
  }
}

function tryReact(
  grid: SimGrid,
  species: SpeciesTable,
  rng: Rng,
  x: number,
  y: number,
  nx: number,
  ny: number,
  touched: Uint8Array,
): boolean {
  const i = grid.index(x, y);
  const j = grid.index(nx, ny);
  const specA = grid.specId[i] as number;
  const specB = grid.specId[j] as number;

  const rule = findReaction(specA, specB);
  if (!rule) return false;

  const massA = massOf(species, specA);
  const massB = massOf(species, specB);
  const { tempK: tempA } = temperatureOf(species.thermalOf(specA), massA, grid.u[i] as number);
  const { tempK: tempB } = temperatureOf(species.thermalOf(specB), massB, grid.u[j] as number);
  const T = (tempA + tempB) / 2;
  if (rule.minTempK !== undefined && T < rule.minTempK) return false;

  const products = rule.products;
  const reactantSlots = [i, j];
  let slots = reactantSlots.slice(0, products.length);
  if (products.length > reactantSlots.length) {
    const extra = findEmptyNeighbor(grid, touched, x, y, nx, ny);
    if (extra === -1) return false;
    slots = [...reactantSlots, extra];
  }
  if (slots.length < products.length) return false;

  if (rng() >= rule.probability) return false;

  // Reaction enthalpy is scaled off reactant A's own nominal parcel (see
  // heat.ts: a cell represents massA grams, i.e. massA/molarMassA "moles"
  // of A), matching the same per-cell-as-parcel convention the rest of
  // src/sim uses rather than a literal per-molecule energy release.
  const molarMassA = (SPECIES[specA] as { molarMass: number }).molarMass;
  const releasedJ = -rule.deltaH * 1000 * (massA / molarMassA);
  const totalEnergy = (grid.u[i] as number) + (grid.u[j] as number) + releasedJ;
  const totalN = (grid.n[i] as number) + (grid.n[j] as number);

  const leftover = reactantSlots.filter((s) => !slots.includes(s));
  placeProducts(grid, species, slots, products, totalEnergy, totalN);
  for (const idx of leftover) grid.clearAt(idx);

  for (const idx of slots) touched[idx] = 1;
  for (const idx of leftover) touched[idx] = 1;
  return true;
}

/** One reaction tick. Mutates grid in place. Run after movement/heat/
 * pressure, per the design doc's movement -> heat -> react tick order. */
export function stepReactions(grid: SimGrid, species: SpeciesTable, rng: Rng): void {
  const { width, height } = grid;
  const touched = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid.index(x, y);
      if (touched[idx] || grid.isEmptyAt(idx)) continue;
      const specId = grid.specId[idx] as number;
      if (isWallSpecId(specId)) continue;

      const candidates: ReadonlyArray<[number, number]> = [
        [x + 1, y],
        [x, y + 1],
      ];
      for (const [nx, ny] of candidates) {
        if (!grid.inBounds(nx, ny)) continue;
        const nIdx = grid.index(nx, ny);
        if (touched[nIdx] || grid.isEmptyAt(nIdx)) continue;
        const nSpecId = grid.specId[nIdx] as number;
        if (isWallSpecId(nSpecId)) continue;

        if (tryReact(grid, species, rng, x, y, nx, ny, touched)) break;
      }
    }
  }
}
