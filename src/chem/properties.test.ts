import { describe, expect, it } from 'vitest';
import { computeProperties } from './properties';
import type { MoleculeGraph } from './types';
import { Phase } from './types';

function water(): MoleculeGraph {
  return {
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
}

function hydroxylRadical(): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: 'O', charge: 0 },
      { id: 1, element: 'H', charge: 0 },
    ],
    bonds: [{ a: 0, b: 1, order: 1 }],
  };
}

function sodiumIon(): MoleculeGraph {
  return { atoms: [{ id: 0, element: 'Na', charge: 1 }], bonds: [] };
}

function oxygenGas(): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: 'O', charge: 0 },
      { id: 1, element: 'O', charge: 0 },
    ],
    bonds: [{ a: 0, b: 1, order: 2 }],
  };
}

function bareIonicPair(elA: 'Na', elB: 'Cl'): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: elA, charge: 1 },
      { id: 1, element: elB, charge: -1 },
    ],
    bonds: [{ a: 0, b: 1, order: 0 }],
  };
}

describe('computeProperties: override precedence', () => {
  it('uses the exact override value for water', () => {
    const props = computeProperties(water());
    expect(props.boilingPointC).toBe(100);
    expect(props.meltingPointC).toBe(0);
    expect(props.density).toBe(1.0);
    expect(props.source).toBe('override');
  });

  it('falls back to estimation for non-overridden species', () => {
    const props = computeProperties(hydroxylRadical());
    expect(props.source).toBe('estimated');
  });

  it('gives standard-state elements a formation enthalpy of exactly 0', () => {
    expect(computeProperties(oxygenGas()).deltaHf).toBe(0);
  });

  it('does not zero out a monatomic radical\'s formation enthalpy', () => {
    const props = computeProperties(hydroxylRadical());
    // OH radical is not a standard state -- estimated deltaHf should be nonzero
    expect(props.deltaHf).not.toBe(0);
  });
});

describe('computeProperties: derived fields', () => {
  it('flags OH as a radical and water as not', () => {
    expect(computeProperties(hydroxylRadical()).isRadical).toBe(true);
    expect(computeProperties(water()).isRadical).toBe(false);
  });

  it('assigns Aqueous phase to a bare monatomic ion', () => {
    const props = computeProperties(sodiumIon());
    expect(props.phaseAtSTP).toBe(Phase.Aqueous);
  });

  it('reports net charge matching the atom charges', () => {
    expect(computeProperties(sodiumIon()).netCharge).toBe(1);
    expect(computeProperties(water()).netCharge).toBe(0);
  });

  it('produces sane, bounded output for an ionic-bonded pair', () => {
    const props = computeProperties(bareIonicPair('Na', 'Cl'));
    expect(props.netCharge).toBe(0);
    expect(props.phaseAtSTP).toBe(Phase.Solid);
    expect(props.molarMass).toBeGreaterThan(0);
  });

  it('produces a valid hex color', () => {
    const props = computeProperties(hydroxylRadical());
    expect(props.color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('melting point never exceeds boiling point', () => {
    for (const graph of [water(), hydroxylRadical(), oxygenGas(), bareIonicPair('Na', 'Cl')]) {
      const props = computeProperties(graph);
      expect(props.meltingPointC).toBeLessThanOrEqual(props.boilingPointC);
    }
  });
});
