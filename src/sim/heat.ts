// Energy/conduction/phase-change step (M3). U is stored per cell in joules;
// temperature is derived from it piecewise, with flat plateaus of width
// mass*heatOfFusion / mass*heatOfVaporization around the melt/boil points --
// this is what gives latent heat, superheating-free boiling plateaus, and
// phase change for free, with no per-species special-case code (see the
// design doc's Q9).
//
// A cell has no defined physical size, so "mass" is a nominal
// density * CELL_VOLUME_CM3 parcel and thermal conductivity is used as a
// relative rate constant between cells, not a literal W/(m*K) transport
// calculation over a real distance.
import { EMPTY, PhaseCode, SimGrid } from './grid';
import type { SpeciesTable, ThermalProfile } from './species';

export const CELL_VOLUME_CM3 = 1;
export const AMBIENT_TEMPERATURE_K = 298.15;

const CONDUCTION_RATE = 0.02;

interface EnergyLandmarks {
  uMeltStart: number;
  uMeltEnd: number;
  uBoilStart: number;
  uBoilEnd: number;
}

function landmarks(thermal: ThermalProfile, massG: number): EnergyLandmarks {
  const uMeltStart = massG * thermal.specificHeatSolid * thermal.meltK;
  const uMeltEnd = uMeltStart + massG * thermal.heatOfFusion;
  const uBoilStart = uMeltEnd + massG * thermal.specificHeatLiquid * (thermal.boilK - thermal.meltK);
  const uBoilEnd = uBoilStart + massG * thermal.heatOfVaporization;
  return { uMeltStart, uMeltEnd, uBoilStart, uBoilEnd };
}

export function massOf(species: SpeciesTable, specId: number): number {
  return species.densityOf(specId) * CELL_VOLUME_CM3;
}

/** Derives {temperature, phase} from stored internal energy. */
export function temperatureOf(thermal: ThermalProfile, massG: number, u: number): { tempK: number; phase: PhaseCode } {
  if (massG <= 0) return { tempK: thermal.meltK, phase: PhaseCode.Solid };
  const L = landmarks(thermal, massG);

  if (u < L.uMeltStart) return { tempK: u / (massG * thermal.specificHeatSolid), phase: PhaseCode.Solid };
  if (u < L.uMeltEnd) return { tempK: thermal.meltK, phase: PhaseCode.Liquid };
  if (u < L.uBoilStart) {
    return { tempK: thermal.meltK + (u - L.uMeltEnd) / (massG * thermal.specificHeatLiquid), phase: PhaseCode.Liquid };
  }
  if (u < L.uBoilEnd) return { tempK: thermal.boilK, phase: PhaseCode.Gas };
  return { tempK: thermal.boilK + (u - L.uBoilEnd) / (massG * thermal.specificHeatGas), phase: PhaseCode.Gas };
}

/** Inverse of temperatureOf -- used to seed a freshly painted cell at ambient
 * temperature with the internal energy (and therefore phase) that implies. */
export function energyForTemperature(thermal: ThermalProfile, massG: number, targetK: number): { u: number; phase: PhaseCode } {
  const L = landmarks(thermal, massG);
  if (targetK < thermal.meltK) return { u: massG * thermal.specificHeatSolid * targetK, phase: PhaseCode.Solid };
  if (targetK < thermal.boilK) {
    return { u: L.uMeltEnd + massG * thermal.specificHeatLiquid * (targetK - thermal.meltK), phase: PhaseCode.Liquid };
  }
  return { u: L.uBoilEnd + massG * thermal.specificHeatGas * (targetK - thermal.boilK), phase: PhaseCode.Gas };
}

function heatCapacityFor(thermal: ThermalProfile, phase: PhaseCode): number {
  switch (phase) {
    case PhaseCode.Solid:
      return thermal.specificHeatSolid;
    case PhaseCode.Gas:
      return thermal.specificHeatGas;
    default:
      return thermal.specificHeatLiquid;
  }
}

function conductivityFor(thermal: ThermalProfile, phase: PhaseCode): number {
  switch (phase) {
    case PhaseCode.Solid:
      return thermal.thermalConductivitySolid;
    case PhaseCode.Gas:
      return thermal.thermalConductivityGas;
    default:
      return thermal.thermalConductivityLiquid;
  }
}

function exchangeEnergy(grid: SimGrid, species: SpeciesTable, deltaU: Float32Array, i: number, j: number): void {
  if (grid.specId[i] === EMPTY || grid.specId[j] === EMPTY) return;

  const specI = grid.specId[i] as number;
  const specJ = grid.specId[j] as number;
  const massI = massOf(species, specI);
  const massJ = massOf(species, specJ);
  const thermalI = species.thermalOf(specI);
  const thermalJ = species.thermalOf(specJ);
  const { tempK: tempI, phase: phaseI } = temperatureOf(thermalI, massI, grid.u[i] as number);
  const { tempK: tempJ, phase: phaseJ } = temperatureOf(thermalJ, massJ, grid.u[j] as number);

  const diff = tempI - tempJ;
  if (diff === 0) return;

  const kI = conductivityFor(thermalI, phaseI);
  const kJ = conductivityFor(thermalJ, phaseJ);
  const kBlend = (2 * kI * kJ) / (kI + kJ);

  const capacityI = massI * heatCapacityFor(thermalI, phaseI);
  const capacityJ = massJ * heatCapacityFor(thermalJ, phaseJ);
  const maxFlux = Math.abs(diff) * Math.min(capacityI, capacityJ) * 0.5;

  let flux = kBlend * diff * CONDUCTION_RATE;
  flux = Math.max(-maxFlux, Math.min(maxFlux, flux));

  deltaU[i] = (deltaU[i] as number) - flux;
  deltaU[j] = (deltaU[j] as number) + flux;
}

/**
 * Burner/coolant tool support (M4): injects (or removes, for negative
 * watts) a fixed power into every non-empty cell within `radius` of
 * (cx, cy), converted to joules via the tick's real duration. This is a
 * deliberate design choice (see the M4 task notes): the tool models watts,
 * not a target temperature, so energy accounting stays correct and boiling
 * a painted liquid still takes real simulated time rather than snapping to
 * a setpoint.
 */
export function applyPointHeatSource(
  grid: SimGrid,
  cx: number,
  cy: number,
  radius: number,
  watts: number,
  dtSeconds: number,
): void {
  const joulesPerCell = watts * dtSeconds;
  if (joulesPerCell === 0) return;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!grid.inBounds(x, y)) continue;
      const idx = grid.index(x, y);
      if (grid.specId[idx] === EMPTY) continue;
      const newU = (grid.u[idx] as number) + joulesPerCell;
      grid.u[idx] = Math.max(0, newU);
    }
  }
}

/** One conduction + phase-change tick. Mutates grid.u and grid.phase in
 * place. Deltas are accumulated over the whole grid from a single snapshot
 * of temperatures, then applied, so the result doesn't depend on scan
 * order (unlike movement's swap-in-place approach). */
export function stepConduction(grid: SimGrid, species: SpeciesTable): void {
  const { width, height } = grid;
  const deltaU = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid.index(x, y);
      if (grid.specId[idx] === EMPTY) continue;

      if (x + 1 < width) exchangeEnergy(grid, species, deltaU, idx, grid.index(x + 1, y));
      if (y + 1 < height) exchangeEnergy(grid, species, deltaU, idx, grid.index(x, y + 1));
    }
  }

  for (let idx = 0; idx < grid.u.length; idx++) {
    if (grid.specId[idx] === EMPTY) continue;
    const newU = (grid.u[idx] as number) + (deltaU[idx] as number);
    grid.u[idx] = newU;

    const specId = grid.specId[idx] as number;
    const { phase } = temperatureOf(species.thermalOf(specId), massOf(species, specId), newU);
    grid.phase[idx] = phase;
  }
}
