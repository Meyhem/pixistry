// Builds the M2 paint palette: the 15 pure elements in their standard
// state, plus a couple of pre-interned compounds (water) so the movement
// demo has a liquid to show, without wiring up the reaction step yet.
import { ELEMENT_SYMBOLS, getElement, InternedPool } from '../chem';
import type { ElementSymbol, MoleculeGraph } from '../chem';
import { PhaseCode } from './grid';
import { Phase } from '../chem';

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
export class SpeciesTable {
  private phase: PhaseCode[] = [];
  private density: number[] = [];

  constructor(private readonly pool: InternedPool) {}

  private ensure(specId: number): void {
    while (this.phase.length <= specId) {
      const spec = this.pool.get(this.phase.length);
      this.phase.push(toPhaseCode(spec.properties.phaseAtSTP));
      this.density.push(spec.properties.density);
    }
  }

  phaseOf(specId: number): PhaseCode {
    this.ensure(specId);
    return this.phase[specId] as PhaseCode;
  }

  densityOf(specId: number): number {
    this.ensure(specId);
    return this.density[specId] as number;
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
