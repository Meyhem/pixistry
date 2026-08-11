import { describe, expect, it } from 'vitest';
import { InternedPool } from './intern';
import { attemptReaction, decomposeUnimolecular, reactPair } from './reaction';
import type { MoleculeGraph } from './types';

function makePool() {
  return new InternedPool();
}

function hAtom(): MoleculeGraph {
  return { atoms: [{ id: 0, element: 'H', charge: 0 }], bonds: [] };
}

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

function nacl(): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: 'Na', charge: 1 },
      { id: 1, element: 'Cl', charge: -1 },
    ],
    bonds: [{ a: 0, b: 1, order: 0 }],
  };
}

function agcl(): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: 'Ag', charge: 1 },
      { id: 1, element: 'Cl', charge: -1 },
    ],
    bonds: [{ a: 0, b: 1, order: 0 }],
  };
}

function hydrogenPeroxide(): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: 'H', charge: 0 },
      { id: 1, element: 'O', charge: 0 },
      { id: 2, element: 'O', charge: 0 },
      { id: 3, element: 'H', charge: 0 },
    ],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 1, b: 2, order: 1 },
      { a: 2, b: 3, order: 1 },
    ],
  };
}

describe('reactPair', () => {
  it('routes an ionic-solid + water pair to dissolution', () => {
    const pool = makePool();
    const naclSpec = pool.intern(nacl());
    const waterSpec = pool.intern(water());
    const outcome = reactPair(naclSpec, waterSpec, 298, 101, pool);
    expect(outcome.candidate).not.toBeNull();
    expect(outcome.candidate?.products).toHaveLength(2);
  });

  it('routes water + ionic-solid (reversed order) the same way', () => {
    const pool = makePool();
    const naclSpec = pool.intern(nacl());
    const waterSpec = pool.intern(water());
    const outcome = reactPair(waterSpec, naclSpec, 298, 101, pool);
    expect(outcome.candidate).not.toBeNull();
  });

  it('does not dissolve AgCl', () => {
    const pool = makePool();
    const agclSpec = pool.intern(agcl());
    const waterSpec = pool.intern(water());
    const outcome = reactPair(agclSpec, waterSpec, 298, 101, pool);
    expect(outcome.candidate).toBeNull();
  });

  it('routes a non-ionic, non-water pair through partition-search', () => {
    const pool = makePool();
    const h1 = pool.intern(hAtom());
    const h2 = pool.intern({ atoms: [{ id: 0, element: 'H', charge: 0 }], bonds: [] });
    const outcome = reactPair(h1, h2, 298, 101, pool);
    expect(outcome.candidate).not.toBeNull();
    expect(outcome.candidate?.deltaH).toBeLessThan(0);
  });

  it('gives near-zero firing probability at room temperature for a high-Ea decomposition', () => {
    const pool = makePool();
    const h2o2 = pool.intern(hydrogenPeroxide());
    const outcome = decomposeUnimolecular(h2o2, 298, pool);
    expect(outcome.candidate).not.toBeNull();
    expect(outcome.probability).toBeLessThan(0.5);
  });
});

describe('attemptReaction', () => {
  it('fires and interns products when rng returns below the probability', () => {
    const pool = makePool();
    const naclSpec = pool.intern(nacl());
    const waterSpec = pool.intern(water());
    const result = attemptReaction(naclSpec, waterSpec, 298, 101, pool, () => 0);
    expect(result.fired).toBe(true);
    expect(result.productSpecIds).toBeDefined();
    expect(result.productSpecIds).toHaveLength(2);
    for (const id of result.productSpecIds ?? []) {
      expect(pool.get(id)).toBeDefined();
    }
  });

  it('does not fire when rng returns above the probability', () => {
    const pool = makePool();
    const naclSpec = pool.intern(nacl());
    const waterSpec = pool.intern(water());
    const result = attemptReaction(naclSpec, waterSpec, 298, 101, pool, () => 0.9999999);
    expect(result.fired).toBe(false);
    expect(result.productSpecIds).toBeUndefined();
  });

  it('never fires when there is no valid candidate', () => {
    const pool = makePool();
    const agclSpec = pool.intern(agcl());
    const waterSpec = pool.intern(water());
    const result = attemptReaction(agclSpec, waterSpec, 298, 101, pool, () => 0);
    expect(result.fired).toBe(false);
  });
});

describe('decomposeUnimolecular', () => {
  it('previews without mutating the pool when rng is omitted', () => {
    const pool = makePool();
    const h2o2 = pool.intern(hydrogenPeroxide());
    const sizeBefore = pool.size;
    const outcome = decomposeUnimolecular(h2o2, 1500, pool);
    expect(pool.size).toBe(sizeBefore);
    expect(outcome.fired).toBeUndefined();
  });

  it('fires and interns products when rng is provided and returns below probability', () => {
    const pool = makePool();
    const h2o2 = pool.intern(hydrogenPeroxide());
    const result = decomposeUnimolecular(h2o2, 1500, pool, () => 0);
    expect(result.fired).toBe(true);
    expect(result.productSpecIds).toBeDefined();
  });
});
