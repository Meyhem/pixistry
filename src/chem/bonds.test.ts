import { describe, expect, it } from 'vitest';
import {
  bondCategory,
  bondDipoleMagnitude,
  bondDissociationEnergy,
  canFormBondOrder,
  estimateLonePairs,
  vseprBondVectors,
} from './bonds';

describe('bondCategory', () => {
  it('is ionic when exactly one side is a metal', () => {
    expect(bondCategory('Na', 'Cl')).toBe('ionic');
    expect(bondCategory('Cl', 'Na')).toBe('ionic');
  });
  it('is covalent when neither side is a metal', () => {
    expect(bondCategory('H', 'O')).toBe('covalent');
  });
  it('is illegal when both sides are metals', () => {
    expect(bondCategory('Na', 'Fe')).toBe('illegal');
  });
});

describe('canFormBondOrder', () => {
  it('allows only order 0 for ionic pairs', () => {
    expect(canFormBondOrder('Na', 'Cl', 0)).toBe(true);
    expect(canFormBondOrder('Na', 'Cl', 1)).toBe(false);
  });
  it('disallows any order for metal-metal pairs', () => {
    for (const order of [0, 1, 2, 3] as const) {
      expect(canFormBondOrder('Na', 'Fe', order)).toBe(false);
    }
  });
  it('allows single covalent bonds broadly', () => {
    expect(canFormBondOrder('H', 'O', 1)).toBe(true);
    expect(canFormBondOrder('H', 'Cl', 1)).toBe(true);
  });
  it('restricts double bonds to C/N/O/S', () => {
    expect(canFormBondOrder('C', 'O', 2)).toBe(true);
    expect(canFormBondOrder('H', 'O', 2)).toBe(false);
    expect(canFormBondOrder('Cl', 'O', 2)).toBe(false);
  });
  it('restricts triple bonds to the narrow legal set', () => {
    expect(canFormBondOrder('N', 'N', 3)).toBe(true);
    expect(canFormBondOrder('C', 'O', 3)).toBe(true);
    expect(canFormBondOrder('O', 'O', 3)).toBe(false);
    expect(canFormBondOrder('S', 'S', 3)).toBe(false);
  });
});

describe('bondDissociationEnergy', () => {
  it('is symmetric in argument order', () => {
    expect(bondDissociationEnergy('H', 'O', 1)).toBe(bondDissociationEnergy('O', 'H', 1));
    expect(bondDissociationEnergy('Na', 'Cl', 0)).toBe(bondDissociationEnergy('Cl', 'Na', 0));
  });
  it('is positive for all tabulated and ionic-path cases', () => {
    expect(bondDissociationEnergy('H', 'H', 1)).toBeGreaterThan(0);
    expect(bondDissociationEnergy('Na', 'Cl', 0)).toBeGreaterThan(0);
    expect(bondDissociationEnergy('K', 'S', 0)).toBeGreaterThan(0);
  });
  it('increases with bond order for multi-bond-capable pairs', () => {
    const single = bondDissociationEnergy('C', 'C', 1);
    const double = bondDissociationEnergy('C', 'C', 2);
    const triple = bondDissociationEnergy('C', 'C', 3);
    expect(double).toBeGreaterThan(single);
    expect(triple).toBeGreaterThan(double);
  });
  it('reflects real N2 anomalous triple-bond strength relative to N-N single', () => {
    const single = bondDissociationEnergy('N', 'N', 1);
    const triple = bondDissociationEnergy('N', 'N', 3);
    expect(triple).toBeGreaterThan(5 * single); // ~945 vs ~163
  });
  it('falls back to a Pauling-style estimate for untabulated covalent pairs', () => {
    // Fe-N has no explicit table entry but Fe is not a metal-metal case here (N nonmetal)
    const value = bondDissociationEnergy('Fe', 'N', 1);
    expect(value).toBeGreaterThan(0);
    expect(Number.isFinite(value)).toBe(true);
  });
});

describe('vseprBondVectors', () => {
  it('returns the requested number of unit vectors', () => {
    const vectors = vseprBondVectors(2, 2); // water-like: 2 bonds, 2 lone pairs -> steric 4
    expect(vectors).toHaveLength(2);
    for (const v of vectors) {
      const len = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2);
      expect(len).toBeCloseTo(1, 5);
    }
  });
  it('returns an empty array for zero bond domains', () => {
    expect(vseprBondVectors(0, 3)).toEqual([]);
  });
  it('gives antiparallel vectors for a linear (steric 2) case', () => {
    const vectors = vseprBondVectors(2, 0);
    expect(vectors).toHaveLength(2);
    const [v1, v2] = vectors as [import('./bonds').Vec3, import('./bonds').Vec3];
    expect(v1.x + v2.x).toBeCloseTo(0, 5);
    expect(v1.y + v2.y).toBeCloseTo(0, 5);
  });
});

describe('estimateLonePairs', () => {
  it('gives known lone-pair counts for O, N, S, Cl', () => {
    expect(estimateLonePairs('O')).toBe(2);
    expect(estimateLonePairs('N')).toBe(1);
    expect(estimateLonePairs('Cl')).toBe(3);
  });
  it('defaults to 0 for elements without a table entry', () => {
    expect(estimateLonePairs('H')).toBe(0);
    expect(estimateLonePairs('Na')).toBe(0);
  });
});

describe('bondDipoleMagnitude', () => {
  it('is zero for a homonuclear bond', () => {
    expect(bondDipoleMagnitude('H', 'H')).toBe(0);
  });
  it('is symmetric and positive for a polar bond', () => {
    expect(bondDipoleMagnitude('H', 'Cl')).toBe(bondDipoleMagnitude('Cl', 'H'));
    expect(bondDipoleMagnitude('H', 'Cl')).toBeGreaterThan(0);
  });
});
