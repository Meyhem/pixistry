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
