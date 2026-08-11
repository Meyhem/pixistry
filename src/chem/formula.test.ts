import { describe, expect, it } from 'vitest';
import { atomCounts, hillFormula, moleculeToFormula, netCharge, parseFormula } from './formula';
import type { MoleculeGraph } from './types';

describe('atomCounts', () => {
  it('counts atoms by element', () => {
    const atoms = parseFormula('H2O');
    const counts = atomCounts(atoms);
    expect(counts.get('H')).toBe(2);
    expect(counts.get('O')).toBe(1);
  });
});

describe('hillFormula', () => {
  it('orders carbon-containing formulas as C, H, then alphabetical', () => {
    expect(hillFormula(parseFormula('CO2'))).toBe('CO2');
  });

  it('orders non-carbon formulas purely alphabetically', () => {
    expect(hillFormula(parseFormula('H2O'))).toBe('H2O');
    expect(hillFormula(parseFormula('NaCl'))).toBe('ClNa');
    expect(hillFormula(parseFormula('HCl'))).toBe('ClH');
    expect(hillFormula(parseFormula('NH3'))).toBe('H3N');
  });

  it('omits counts of 1', () => {
    expect(hillFormula(parseFormula('NaCl'))).not.toContain('1');
  });
});

describe('netCharge / moleculeToFormula', () => {
  it('sums formal charge across atoms', () => {
    const atoms = parseFormula('Ca2+');
    expect(netCharge(atoms)).toBe(2);
  });

  it('appends a charge suffix to the formula', () => {
    const graph: MoleculeGraph = { atoms: parseFormula('Na+'), bonds: [] };
    expect(moleculeToFormula(graph)).toBe('Na+');
    const graph2: MoleculeGraph = { atoms: parseFormula('Ca2+'), bonds: [] };
    expect(moleculeToFormula(graph2)).toBe('Ca2+');
    const graph3: MoleculeGraph = { atoms: parseFormula('Cl-'), bonds: [] };
    expect(moleculeToFormula(graph3)).toBe('Cl-');
  });

  it('produces no suffix for neutral molecules', () => {
    const graph: MoleculeGraph = { atoms: parseFormula('H2O'), bonds: [] };
    expect(moleculeToFormula(graph)).toBe('H2O');
  });
});

describe('parseFormula', () => {
  it('parses multi-element formulas with counts', () => {
    const atoms = parseFormula('Fe2O3');
    expect(atoms).toHaveLength(5);
    expect(atoms.filter((a) => a.element === 'Fe')).toHaveLength(2);
    expect(atoms.filter((a) => a.element === 'O')).toHaveLength(3);
  });

  it('parses single-atom ions with charge', () => {
    const atoms = parseFormula('Na+');
    expect(atoms).toHaveLength(1);
    expect(atoms[0]).toMatchObject({ element: 'Na', charge: 1 });
  });

  it('parses multi-digit charge magnitude', () => {
    const atoms = parseFormula('Fe3+');
    expect(netCharge(atoms)).toBe(3);
  });

  it('assigns sequential ids starting at 0', () => {
    const atoms = parseFormula('H2O');
    expect(atoms.map((a) => a.id)).toEqual([0, 1, 2]);
  });
});
