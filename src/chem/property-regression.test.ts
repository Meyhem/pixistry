import { describe, expect, it } from 'vitest';
import { applyOverrides, OVERRIDES } from './overrides';
import { computeProperties } from './properties';
import type { Atom, ElementSymbol, MoleculeGraph, MoleculeProperties } from './types';
import { Phase } from './types';

function atom(element: ElementSymbol, id: number, charge = 0): Atom {
  return { id, element, charge };
}

function water(): MoleculeGraph {
  return {
    atoms: [atom('O', 0), atom('H', 1), atom('H', 2)],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 },
    ],
  };
}
function nacl(): MoleculeGraph {
  return { atoms: [atom('Na', 0, 1), atom('Cl', 1, -1)], bonds: [{ a: 0, b: 1, order: 0 }] };
}
function co2(): MoleculeGraph {
  return {
    atoms: [atom('C', 0), atom('O', 1), atom('O', 2)],
    bonds: [
      { a: 0, b: 1, order: 2 },
      { a: 0, b: 2, order: 2 },
    ],
  };
}
function ammonia(): MoleculeGraph {
  return {
    atoms: [atom('N', 0), atom('H', 1), atom('H', 2), atom('H', 3)],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 },
      { a: 0, b: 3, order: 1 },
    ],
  };
}
function hcl(): MoleculeGraph {
  return { atoms: [atom('H', 0), atom('Cl', 1)], bonds: [{ a: 0, b: 1, order: 1 }] };
}

describe('property regression: measured-value overrides', () => {
  it('water matches exact measured values', () => {
    const props = computeProperties(water());
    expect(props.boilingPointC).toBe(100);
    expect(props.meltingPointC).toBe(0);
    expect(props.density).toBe(1.0);
    expect(props.source).toBe('override');
  });

  it('NaCl matches measured values within tolerance', () => {
    const props = computeProperties(nacl());
    expect(props.meltingPointC).toBeCloseTo(801, 0);
    expect(props.density).toBeCloseTo(2.16, 1);
    expect(props.deltaHf).toBeCloseTo(-411.2, 0);
  });

  it('CO2 formation enthalpy matches the measured value within 5%', () => {
    const props = computeProperties(co2());
    expect(props.deltaHf).toBeCloseTo(-393.5, 0);
    expect(Math.abs((props.deltaHf - -393.5) / -393.5)).toBeLessThan(0.05);
  });

  it('NH3 (as the Hill formula H3N) carries the overridden dipole moment', () => {
    const props = computeProperties(ammonia());
    expect(props.dipoleMoment).toBeCloseTo(1.42, 1);
  });

  it('HCl (as the Hill formula ClH) is strongly polar per the override', () => {
    const props = computeProperties(hcl());
    expect(props.dipoleMoment).toBeCloseTo(1.05, 1);
  });
});

describe('property regression: override precedence', () => {
  it('a field-partial override only replaces the fields it supplies', () => {
    const fakeFormula = '__TestOnlyFormula__';
    const estimated: MoleculeProperties = {
      formula: fakeFormula,
      molarMass: 42,
      deltaHf: 42,
      standardEntropy: 42,
      dipoleMoment: 42,
      boilingPointC: 42,
      meltingPointC: 42,
      density: 42,
      phaseAtSTP: Phase.Gas,
      isRadical: false,
      netCharge: 0,
      color: '#000000',
      source: 'estimated',
    };
    const originalEntry = OVERRIDES[fakeFormula];
    (OVERRIDES as Record<string, Partial<MoleculeProperties>>)[fakeFormula] = { deltaHf: -1 };
    try {
      const merged = applyOverrides(fakeFormula, estimated);
      expect(merged.deltaHf).toBe(-1); // overridden
      expect(merged.molarMass).toBe(42); // untouched, still estimated
      expect(merged.source).toBe('override');
    } finally {
      if (originalEntry === undefined) {
        delete (OVERRIDES as Record<string, unknown>)[fakeFormula];
      } else {
        (OVERRIDES as Record<string, Partial<MoleculeProperties>>)[fakeFormula] = originalEntry;
      }
    }
  });
});

describe('property regression: sanity bounds on non-overridden emergent species', () => {
  // AlCl3 is not in OVERRIDES -- this exercises the estimation formulas
  // directly, guarding against nonsense output on a genuinely novel species.
  function alCl3(): MoleculeGraph {
    return {
      atoms: [atom('Al', 0, 3), atom('Cl', 1, -1), atom('Cl', 2, -1), atom('Cl', 3, -1)],
      bonds: [
        { a: 0, b: 1, order: 0 },
        { a: 0, b: 2, order: 0 },
        { a: 0, b: 3, order: 0 },
      ],
    };
  }

  it('AlCl3 is not present in the curated overrides table', () => {
    const props = computeProperties(alCl3());
    expect(props.source).toBe('estimated');
  });

  it('produces physically plausible bounds for molar mass, density, and phase ordering', () => {
    const props = computeProperties(alCl3());
    expect(props.molarMass).toBeGreaterThan(0);
    expect(props.density).toBeGreaterThan(0.5);
    expect(props.density).toBeLessThan(20);
    expect(props.meltingPointC).toBeLessThanOrEqual(props.boilingPointC);
  });

  it('holds the same bounds across a spread of emergent covalent species', () => {
    const species: MoleculeGraph[] = [
      { atoms: [atom('C', 0), atom('H', 1), atom('H', 2), atom('H', 3), atom('H', 4)], bonds: [
        { a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }, { a: 0, b: 3, order: 1 }, { a: 0, b: 4, order: 1 },
      ] }, // CH4
      { atoms: [atom('S', 0), atom('H', 1)], bonds: [{ a: 0, b: 1, order: 1 }] }, // SH radical
      { atoms: [atom('N', 0), atom('O', 1)], bonds: [{ a: 0, b: 1, order: 2 }] }, // NO
    ];
    for (const graph of species) {
      const props = computeProperties(graph);
      expect(props.molarMass).toBeGreaterThan(0);
      expect(Number.isFinite(props.deltaHf)).toBe(true);
      expect(Number.isFinite(props.standardEntropy)).toBe(true);
      expect(props.standardEntropy).toBeGreaterThan(0);
      expect(props.meltingPointC).toBeLessThanOrEqual(props.boilingPointC);
      expect(props.color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
