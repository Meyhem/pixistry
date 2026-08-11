// Builds the M2 paint palette: the 15 pure elements in their standard
// state, plus a couple of pre-interned compounds (water) so the movement
// demo has a liquid to show, without wiring up the reaction step yet.
import { ELEMENT_SYMBOLS, getElement, InternedPool } from '../chem';
import type { ElementSymbol, MoleculeGraph } from '../chem';
import { PhaseCode } from './grid';
import { Phase } from '../chem';
import { getWall, isWallSpecId, wallThermalProfile, WALL_PHASE } from './walls';

export interface PaletteEntry {
  label: string;
  specId: number;
  phase: PhaseCode;
  density: number;
  color: string;
}

function pureElementGraph(symbol: ElementSymbol): MoleculeGraph {
  const el = getElement(symbol);
  if (el.pureElementForm === 'diatomic') {
    return {
      atoms: [
        { id: 0, element: symbol, charge: 0 },
        { id: 1, element: symbol, charge: 0 },
      ],
      bonds: [{ a: 0, b: 1, order: 1 }],
    };
  }
  return { atoms: [{ id: 0, element: symbol, charge: 0 }], bonds: [] };
}

const WATER_GRAPH: MoleculeGraph = {
  atoms: [
    { id: 0, element: 'O', charge: 0 },
    { id: 1, element: 'H', charge: 0 },
    { id: 2, element: 'H', charge: 0 },
  ],
  bonds: [
    { a: 0, b: 1, order: 1 },
    { a: 0, b: 2, order: 1 },
  ],
};

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

function toPhaseCode(phase: Phase): PhaseCode {
  switch (phase) {
    case Phase.Solid:
      return PhaseCode.Solid;
    case Phase.Liquid:
      return PhaseCode.Liquid;
    case Phase.Gas:
      return PhaseCode.Gas;
    case Phase.Aqueous:
      return PhaseCode.Liquid;
  }
}

/**
 * Lazily-grown specId -> {phase, density} cache. specIds are assigned
 * sequentially by InternedPool, so a plain growable array indexed by specId
 * is enough to avoid re-deriving phase/density from properties on every
 * cell, every tick, in the movement hot loop.
 */
const CELSIUS_TO_KELVIN = 273.15;

export class SpeciesTable {
  private phase: PhaseCode[] = [];
  private density: number[] = [];
  private thermal: ThermalProfile[] = [];

  constructor(private readonly pool: InternedPool) {}

  private ensure(specId: number): void {
    while (this.phase.length <= specId) {
      const spec = this.pool.get(this.phase.length);
      const p = spec.properties;
      this.phase.push(toPhaseCode(p.phaseAtSTP));
      this.density.push(p.density);
      this.thermal.push({
        meltK: p.meltingPointC + CELSIUS_TO_KELVIN,
        boilK: p.boilingPointC + CELSIUS_TO_KELVIN,
        specificHeatSolid: p.specificHeatSolid,
        specificHeatLiquid: p.specificHeatLiquid,
        specificHeatGas: p.specificHeatGas,
        heatOfFusion: p.heatOfFusion,
        heatOfVaporization: p.heatOfVaporization,
        thermalConductivitySolid: p.thermalConductivitySolid,
        thermalConductivityLiquid: p.thermalConductivityLiquid,
        thermalConductivityGas: p.thermalConductivityGas,
        density: p.density,
      });
    }
  }

  phaseOf(specId: number): PhaseCode {
    if (isWallSpecId(specId)) return WALL_PHASE;
    this.ensure(specId);
    return this.phase[specId] as PhaseCode;
  }

  densityOf(specId: number): number {
    if (isWallSpecId(specId)) return getWall(specId).density;
    this.ensure(specId);
    return this.density[specId] as number;
  }

  thermalOf(specId: number): ThermalProfile {
    if (isWallSpecId(specId)) return wallThermalProfile(getWall(specId));
    this.ensure(specId);
    return this.thermal[specId] as ThermalProfile;
  }
}

export function buildPalette(pool: InternedPool): PaletteEntry[] {
  const graphs: MoleculeGraph[] = [...ELEMENT_SYMBOLS.map(pureElementGraph), WATER_GRAPH];

  return graphs.map((graph) => {
    const spec = pool.intern(graph);
    return {
      label: spec.properties.formula,
      specId: spec.specId,
      phase: toPhaseCode(spec.properties.phaseAtSTP),
      density: spec.properties.density,
      color: spec.properties.color,
    };
  });
}
