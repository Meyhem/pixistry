import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical';
import type { MoleculeGraph } from './types';

function water(order: 'O-first' | 'H-first' = 'O-first'): MoleculeGraph {
  if (order === 'O-first') {
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

function hydroxylRadical(): MoleculeGraph {
  return {
    atoms: [
      { id: 0, element: 'O', charge: 0 },
      { id: 1, element: 'H', charge: 0 },
    ],
    bonds: [{ a: 0, b: 1, order: 1 }],
  };
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

function sodiumAtom(charge: number): MoleculeGraph {
  return { atoms: [{ id: 0, element: 'Na', charge }], bonds: [] };
}

// A central S bonded to 4 terminal O -- exercises symmetric terminal atoms
// (like sulfate) in different atom-array orders.
function sulfateLike(reverseAtomOrder: boolean): MoleculeGraph {
  const atoms = [
    { id: 0, element: 'S' as const, charge: 0 },
    { id: 1, element: 'O' as const, charge: 0 },
    { id: 2, element: 'O' as const, charge: 0 },
    { id: 3, element: 'O' as const, charge: 0 },
    { id: 4, element: 'O' as const, charge: 0 },
  ];
  const bonds = [
    { a: 0, b: 1, order: 2 as const },
    { a: 0, b: 2, order: 2 as const },
    { a: 0, b: 3, order: 1 as const },
    { a: 0, b: 4, order: 1 as const },
  ];
  return {
    atoms: reverseAtomOrder ? [...atoms].reverse() : atoms,
    bonds,
  };
}

describe('canonicalize', () => {
  it('gives isomorphic graphs (different atom orderings) the same key', () => {
    const a = canonicalize(water('O-first'));
    const b = canonicalize(water('H-first'));
    expect(a.key).toBe(b.key);
  });

  it('gives structurally different graphs different keys', () => {
    const a = canonicalize(water());
    const b = canonicalize(hydrogenPeroxide());
    expect(a.key).not.toBe(b.key);
  });

  it('distinguishes bond order (O2 double bond vs two single-bonded oxygens is a different graph)', () => {
    const doubleBonded = canonicalize(oxygenGas());
    const singleBonded = canonicalize({
      atoms: oxygenGas().atoms,
      bonds: [{ a: 0, b: 1, order: 1 }],
    });
    expect(doubleBonded.key).not.toBe(singleBonded.key);
  });

  it('distinguishes charge variants of the same atom', () => {
    const neutral = canonicalize(sodiumAtom(0));
    const cation = canonicalize(sodiumAtom(1));
    expect(neutral.key).not.toBe(cation.key);
  });

  it('distinguishes a radical (lower degree) from the saturated molecule', () => {
    const oh = canonicalize(hydroxylRadical());
    const w = canonicalize(water());
    expect(oh.key).not.toBe(w.key);
  });

  it('is order-independent for graphs with symmetric terminal atoms', () => {
    const a = canonicalize(sulfateLike(false));
    const b = canonicalize(sulfateLike(true));
    expect(a.key).toBe(b.key);
  });

  it('returns a relabeled graph with ids 0..n-1 and the same atom/bond counts', () => {
    const result = canonicalize(water('H-first'));
    expect(result.graph.atoms.map((a) => a.id)).toEqual([0, 1, 2]);
    expect(result.graph.atoms).toHaveLength(3);
    expect(result.graph.bonds).toHaveLength(2);
    const elements = result.graph.atoms.map((a) => a.element).sort();
    expect(elements).toEqual(['H', 'H', 'O']);
  });

  it('handles the empty graph', () => {
    const result = canonicalize({ atoms: [], bonds: [] });
    expect(result.key).toBe('');
    expect(result.graph.atoms).toHaveLength(0);
  });

  it('handles a single unbonded atom', () => {
    const result = canonicalize(sodiumAtom(1));
    expect(result.graph.atoms).toHaveLength(1);
    expect(result.graph.bonds).toHaveLength(0);
  });
});
