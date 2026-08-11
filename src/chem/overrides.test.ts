import { describe, expect, it } from 'vitest';
import { applyOverrides, OVERRIDES } from './overrides';
import type { MoleculeProperties } from './types';
import { Phase } from './types';

function estimatedFixture(overrides: Partial<MoleculeProperties> = {}): MoleculeProperties {
  return {
    formula: 'XYZ',
    molarMass: 10,
    deltaHf: 999,
    standardEntropy: 999,
    dipoleMoment: 999,
    boilingPointC: 999,
    meltingPointC: 999,
    density: 999,
    phaseAtSTP: Phase.Gas,
    isRadical: false,
    netCharge: 0,
    color: '#000000',
    source: 'estimated',
    specificHeatSolid: 1,
    specificHeatLiquid: 1,
    specificHeatGas: 1,
    heatOfFusion: 1,
    heatOfVaporization: 1,
    thermalConductivitySolid: 1,
    thermalConductivityLiquid: 1,
    thermalConductivityGas: 1,
    ...overrides,
  };
}

describe('OVERRIDES', () => {
  it('gives every element a standard-state-zero entry', () => {
    // diatomic elements
    for (const key of ['H2', 'N2', 'O2', 'Cl2']) {
      expect(OVERRIDES[key]).toMatchObject({ deltaHf: 0 });
    }
    // lattice/monatomic elements
    for (const key of ['C', 'Na', 'Mg', 'Al', 'S', 'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Ag']) {
      expect(OVERRIDES[key]).toMatchObject({ deltaHf: 0 });
    }
  });

  it('does not override the monatomic form of diatomic elements', () => {
    expect(OVERRIDES['H']).toBeUndefined();
    expect(OVERRIDES['O']).toBeUndefined();
    expect(OVERRIDES['N']).toBeUndefined();
    expect(OVERRIDES['Cl']).toBeUndefined();
  });
});

describe('applyOverrides', () => {
  it('marks source as estimated when no override exists', () => {
    const result = applyOverrides('DoesNotExist', estimatedFixture());
    expect(result.source).toBe('estimated');
    expect(result.deltaHf).toBe(999); // unchanged
  });

  it('marks source as override and merges field-by-field when one exists', () => {
    const result = applyOverrides('H2O', estimatedFixture({ formula: 'H2O' }));
    expect(result.source).toBe('override');
    expect(result.boilingPointC).toBe(100); // from override
    expect(result.molarMass).toBe(10); // untouched estimated field preserved
  });

  it('lets a partial override supply only some fields', () => {
    // O3's override doesn't set density -- estimated value should survive
    const result = applyOverrides('O3', estimatedFixture({ formula: 'O3', density: 42 }));
    expect(result.deltaHf).toBe(142.7);
    expect(result.density).toBe(42);
  });
});
