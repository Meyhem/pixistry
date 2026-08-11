import { describe, expect, it } from 'vitest';
import { InternedPool } from './intern';
import type { MoleculeGraph } from './types';

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

function waterReordered(): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: 'H', charge: 0 },
      { id: 1, element: 'O', charge: 0 },
      { id: 2, element: 'H', charge: 0 },
    ],
    bonds: [
      { a: 1, b: 0, order: 1 },
      { a: 1, b: 2, order: 1 },
    ],
  };
}

function sodiumIon(): MoleculeGraph {
  return { atoms: [{ id: 0, element: 'Na', charge: 1 }], bonds: [] };
}

describe('InternedPool', () => {
  it('assigns sequential specIds starting at 0', () => {
    const pool = new InternedPool();
    const a = pool.intern(water());
    const b = pool.intern(sodiumIon());
    expect(a.specId).toBe(0);
    expect(b.specId).toBe(1);
  });

  it('deduplicates isomorphic graphs regardless of atom ordering', () => {
    const pool = new InternedPool();
    const a = pool.intern(water());
    const b = pool.intern(waterReordered());
    expect(a.specId).toBe(b.specId);
    expect(pool.size).toBe(1);
  });

  it('does not deduplicate structurally different graphs', () => {
    const pool = new InternedPool();
    pool.intern(water());
    pool.intern(sodiumIon());
    expect(pool.size).toBe(2);
  });

  it('get() retrieves a spec by id', () => {
    const pool = new InternedPool();
    const spec = pool.intern(water());
    expect(pool.get(spec.specId)).toBe(spec);
  });

  it('get() throws for an unknown id', () => {
    const pool = new InternedPool();
    expect(() => pool.get(99)).toThrow();
  });

  it('getByKey() retrieves a spec by canonical key', () => {
    const pool = new InternedPool();
    const spec = pool.intern(water());
    expect(pool.getByKey(spec.canonicalKey)).toBe(spec);
    expect(pool.getByKey('nonexistent')).toBeUndefined();
  });

  it('attaches computed properties to the interned spec', () => {
    const pool = new InternedPool();
    const spec = pool.intern(water());
    expect(spec.properties.formula).toBe('H2O');
    expect(spec.properties.molarMass).toBeGreaterThan(17);
    expect(spec.properties.molarMass).toBeLessThan(19);
  });
});
