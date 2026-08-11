import { describe, expect, it } from 'vitest';
import { attemptDissolution, bornLandeLatticeEnergy, dissolutionDeltaG, hydrationEnthalpy } from './dissolution';
import { ELEMENTS } from './elements';
import type { MoleculeGraph } from './types';

function ionicPair(cation: 'Na' | 'Ag' | 'K' | 'Ca' | 'Mg', anion: 'Cl'): MoleculeGraph {
  const cationCharge = ELEMENTS[cation].commonIonCharges[0] ?? 1;
  const anionCharge = ELEMENTS[anion].commonIonCharges[0] ?? -1;
  if (cationCharge === 2) {
    // 1:2 stoichiometry (e.g. CaCl2, MgCl2)
    return {
      atoms: [
        { id: 0, element: cation, charge: cationCharge },
        { id: 1, element: anion, charge: anionCharge },
        { id: 2, element: anion, charge: anionCharge },
      ],
      bonds: [
        { a: 0, b: 1, order: 0 },
        { a: 0, b: 2, order: 0 },
      ],
    };
  }
  return {
    atoms: [
      { id: 0, element: cation, charge: cationCharge },
      { id: 1, element: anion, charge: anionCharge },
    ],
    bonds: [{ a: 0, b: 1, order: 0 }],
  };
}

describe('bornLandeLatticeEnergy', () => {
  it('is positive', () => {
    const u = bornLandeLatticeEnergy(ELEMENTS.Na, 1, ELEMENTS.Cl, -1, 2);
    expect(u).toBeGreaterThan(0);
  });

  it('is symmetric in argument order', () => {
    const a = bornLandeLatticeEnergy(ELEMENTS.Na, 1, ELEMENTS.Cl, -1, 2);
    const b = bornLandeLatticeEnergy(ELEMENTS.Cl, -1, ELEMENTS.Na, 1, 2);
    expect(a).toBeCloseTo(b, 6);
  });

  it('is higher for AgCl than NaCl due to the covalent-character bonus', () => {
    const nacl = bornLandeLatticeEnergy(ELEMENTS.Na, 1, ELEMENTS.Cl, -1, 2);
    const agcl = bornLandeLatticeEnergy(ELEMENTS.Ag, 1, ELEMENTS.Cl, -1, 2);
    expect(agcl).toBeGreaterThan(nacl);
  });

  it('scales with ion count per formula unit (CaCl2 > NaCl)', () => {
    const nacl = bornLandeLatticeEnergy(ELEMENTS.Na, 1, ELEMENTS.Cl, -1, 2);
    const cacl2 = bornLandeLatticeEnergy(ELEMENTS.Ca, 2, ELEMENTS.Cl, -1, 3);
    expect(cacl2).toBeGreaterThan(nacl);
  });
});

describe('hydrationEnthalpy', () => {
  it('is negative (favorable) for a charged ion', () => {
    expect(hydrationEnthalpy(ELEMENTS.Na, 1)).toBeLessThan(0);
    expect(hydrationEnthalpy(ELEMENTS.Cl, -1)).toBeLessThan(0);
  });

  it('is zero for an uncharged atom', () => {
    expect(hydrationEnthalpy(ELEMENTS.Na, 0)).toBe(0);
  });

  it('scales with the square of the charge', () => {
    const single = hydrationEnthalpy(ELEMENTS.Ca, 1);
    const double = hydrationEnthalpy(ELEMENTS.Ca, 2);
    expect(Math.abs(double)).toBeCloseTo(Math.abs(single) * 4, 6);
  });
});

describe('dissolutionDeltaG', () => {
  it('becomes more favorable (more negative) at higher temperature when deltaS is positive', () => {
    const low = dissolutionDeltaG(100, -80, 50, 298);
    const high = dissolutionDeltaG(100, -80, 50, 500);
    expect(high).toBeLessThan(low);
  });
});

describe('attemptDissolution: the NaCl-vs-AgCl calibration checkpoint', () => {
  it('NaCl dissolves favorably (deltaG < 0)', () => {
    const result = attemptDissolution(ionicPair('Na', 'Cl'), 298);
    expect(result.favorable).toBe(true);
    expect(result.deltaG).toBeLessThan(0);
    expect(result.products).toHaveLength(2);
  });

  it('AgCl does not dissolve (deltaG >= 0), staying solid', () => {
    const result = attemptDissolution(ionicPair('Ag', 'Cl'), 298);
    expect(result.favorable).toBe(false);
    expect(result.deltaG).toBeGreaterThanOrEqual(0);
    expect(result.products).toHaveLength(0);
  });

  it('produces separated, individually-charged aqueous ion graphs for a favorable case', () => {
    const result = attemptDissolution(ionicPair('Na', 'Cl'), 298);
    const charges = result.products.map((p) => p.atoms[0]?.charge).sort();
    expect(charges).toEqual([-1, 1]);
    for (const p of result.products) {
      expect(p.bonds).toHaveLength(0);
      expect(p.atoms).toHaveLength(1);
    }
  });

  it('handles 1:2 stoichiometry salts (CaCl2, MgCl2) and finds them favorable', () => {
    expect(attemptDissolution(ionicPair('Ca', 'Cl'), 298).favorable).toBe(true);
    expect(attemptDissolution(ionicPair('Mg', 'Cl'), 298).favorable).toBe(true);
  });

  it('finds KCl favorable, consistent with other alkali halides', () => {
    expect(attemptDissolution(ionicPair('K', 'Cl'), 298).favorable).toBe(true);
  });

  it('returns not-favorable with no ionic bonds present (covalent-only graph)', () => {
    const water: MoleculeGraph = {
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
    const result = attemptDissolution(water, 298);
    expect(result.favorable).toBe(false);
    expect(result.products).toHaveLength(0);
  });
});
