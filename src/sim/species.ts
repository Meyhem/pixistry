// Builds the paint palette and the specId -> {phase, density, thermal}
// lookup used by the tick loop, directly off the static species table
// (species-data.ts). specIds are just SPECIES array indices now, so there's
// no interning/pool involved -- this is a thin, eager wrapper.
import { PhaseCode } from './grid';
import { PhaseAtSTP, SPECIES } from './species-data';
import { getWall, isWallSpecId, wallThermalProfile, WALL_PHASE } from './walls';

export interface PaletteEntry {
  label: string;
  specId: number;
  phase: PhaseCode;
  density: number;
  color: string;
  meltingPointC: number;
  boilingPointC: number;
}

/** Per-species thermal data needed by heat.ts, phase-independent parts
 * (melt/boil points, K) plus phase-dependent parts (heat capacity,
 * conductivity) that heat.ts picks between based on the cell's current
 * phase. */
export interface ThermalProfile {
  meltK: number;
  boilK: number;
  specificHeatSolid: number;
  specificHeatLiquid: number;
  specificHeatGas: number;
  heatOfFusion: number;
  heatOfVaporization: number;
  thermalConductivitySolid: number;
  thermalConductivityLiquid: number;
  thermalConductivityGas: number;
  density: number;
}

const CELSIUS_TO_KELVIN = 273.15;
// STP molar volume (0C, 1atm) in mL/mol, and the reference temperature it's
// defined at -- see buoyantDensityOf's doc comment for why these aren't new
// hand-tuned constants.
const IDEAL_GAS_MOLAR_VOLUME_ML_PER_MOL = 22400;
const STP_TEMPERATURE_K = 273.15;

function toPhaseCode(phase: PhaseAtSTP): PhaseCode {
  switch (phase) {
    case 'solid':
      return PhaseCode.Solid;
    case 'liquid':
      return PhaseCode.Liquid;
    case 'gas':
      return PhaseCode.Gas;
    case 'aqueous':
      return PhaseCode.Liquid;
  }
}

export class SpeciesTable {
  phaseOf(specId: number): PhaseCode {
    if (isWallSpecId(specId)) return WALL_PHASE;
    const data = SPECIES[specId];
    if (!data) throw new Error(`no species data for specId ${specId}`);
    return toPhaseCode(data.phaseAtSTP);
  }

  densityOf(specId: number): number {
    if (isWallSpecId(specId)) return getWall(specId).density;
    const data = SPECIES[specId];
    if (!data) throw new Error(`no species data for specId ${specId}`);
    return data.density;
  }

  /** Density used for movement/buoyancy sorting (movement.ts's canDisplace),
   * as opposed to densityOf's single fixed table value, which stays
   * phase-independent on purpose: it feeds heat.ts's massOf, and a cell's
   * thermal "mass" (parcel size) must stay constant across a phase change
   * or a boiling cell's own energy accounting would shift out from under
   * it. Buoyancy has no such constraint, so it can be phase-accurate:
   *
   * - Solid/liquid: same as densityOf (thermal expansion of condensed
   *   phases isn't modeled -- there's no per-phase density data to draw
   *   from, and it's a much smaller effect than the phase-to-phase jump).
   * - Gas: density = molarMass / molarVolume, i.e. the ideal gas law, with
   *   molarVolume itself scaled by Charles's law for temperature (hotter
   *   gas is less dense). This isn't a new hand-tuned number: every
   *   already-gaseous species in species-data.ts (H2, N2, O2, Cl2, CO2,
   *   HCl, NH3, O3) has its `density` field matching molarMass/22400 to
   *   within ~1.5%, so this makes an existing implicit convention explicit
   *   and temperature-aware instead of adding new physics assumptions.
   *
   * Without this, a species boiled in-place (H2O -> gas-phase H2O) kept
   * densityOf's fixed liquid-reference density, identical to the liquid it
   * just came from, so canDisplace's `fromDensity < targetDensity` check
   * could never let it rise through its own liquid -- steam looked
   * pixel-identical to water and just sat there instead of escaping.
   */
  buoyantDensityOf(specId: number, phase: PhaseCode, tempK: number): number {
    if (phase !== PhaseCode.Gas) return this.densityOf(specId);
    if (isWallSpecId(specId)) return getWall(specId).density; // walls never reach Gas phase in practice
    const data = SPECIES[specId];
    if (!data) throw new Error(`no species data for specId ${specId}`);
    const safeTempK = Math.max(1, tempK); // guards against divide-by-zero/negative absurdities
    return (data.molarMass / IDEAL_GAS_MOLAR_VOLUME_ML_PER_MOL) * (STP_TEMPERATURE_K / safeTempK);
  }

  thermalOf(specId: number): ThermalProfile {
    if (isWallSpecId(specId)) return wallThermalProfile(getWall(specId));
    const data = SPECIES[specId];
    if (!data) throw new Error(`no species data for specId ${specId}`);
    return {
      meltK: data.meltingPointC + CELSIUS_TO_KELVIN,
      boilK: data.boilingPointC + CELSIUS_TO_KELVIN,
      specificHeatSolid: data.specificHeatSolid,
      specificHeatLiquid: data.specificHeatLiquid,
      specificHeatGas: data.specificHeatGas,
      heatOfFusion: data.heatOfFusion,
      heatOfVaporization: data.heatOfVaporization,
      thermalConductivitySolid: data.thermalConductivitySolid,
      thermalConductivityLiquid: data.thermalConductivityLiquid,
      thermalConductivityGas: data.thermalConductivityGas,
      density: data.density,
    };
  }
}

export function buildPalette(): PaletteEntry[] {
  const entries: PaletteEntry[] = [];
  SPECIES.forEach((data, specId) => {
    if (!data.paintable) return;
    entries.push({
      label: data.name,
      specId,
      phase: toPhaseCode(data.phaseAtSTP),
      density: data.density,
      color: data.color,
      meltingPointC: data.meltingPointC,
      boilingPointC: data.boilingPointC,
    });
  });
  return entries;
}
