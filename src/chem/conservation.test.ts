import { describe, expect, it } from 'vitest';
import { canonicalize } from './canonical';
import { getElement } from './elements';
import { InternedPool } from './intern';
import { findBestPartition } from './partition-search';
import { reactPair } from './reaction';
import type { Atom, ElementSymbol, MoleculeGraph } from './types';

/**
 * Cross-cutting invariant tests: atom/charge/mass conservation, determinism,
 * order-independence, species-space boundedness, and the partition-count
 * guard, run over both the golden-suite-style species and a broader
 * deterministic sweep across all 15 v1 elements.
 */

function atom(element: ElementSymbol, id: number, charge = 0): Atom {
  return { id, element, charge };
}
function mono(element: ElementSymbol, charge = 0): MoleculeGraph {
  return { atoms: [atom(element, 0, charge)], bonds: [] };
}
function diatomic(elA: ElementSymbol, elB: ElementSymbol, order: 1 | 2 | 3): MoleculeGraph {
  return { atoms: [atom(elA, 0), atom(elB, 1)], bonds: [{ a: 0, b: 1, order }] };
}
function triatomicBent(elCenter: ElementSymbol, elOuter: ElementSymbol): MoleculeGraph {
  return {
    atoms: [atom(elCenter, 0), atom(elOuter, 1), atom(elOuter, 2)],
    bonds: [
      { a: 0, b: 1, order: 1 },
      { a: 0, b: 2, order: 1 },
    ],
  };
}

function atomCountsOf(atoms: Atom[]): Map<ElementSymbol, number> {
  const counts = new Map<ElementSymbol, number>();
  for (const a of atoms) counts.set(a.element, (counts.get(a.element) ?? 0) + 1);
  return counts;
}

function totalCharge(atoms: Atom[]): number {
  return atoms.reduce((s, a) => s + a.charge, 0);
}

function totalMass(atoms: Atom[]): number {
  return atoms.reduce((s, a) => s + getElement(a.element).molarMass, 0);
}

const SINGLE_ELEMENTS: ElementSymbol[] = [
  'H', 'C', 'N', 'O', 'Na', 'Mg', 'Al', 'S', 'Cl', 'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Ag',
];

const REPRESENTATIVE_MOLECULES: MoleculeGraph[] = [
  diatomic('H', 'H', 1),
  diatomic('O', 'O', 2),
  diatomic('N', 'N', 3),
  diatomic('Cl', 'Cl', 1),
  triatomicBent('O', 'H'), // water
  triatomicBent('C', 'O'), // (bonding pattern reused loosely for fuzz breadth)
];

function buildFuzzPairs(): Array<{ a: MoleculeGraph; b: MoleculeGraph | null; T: number }> {
  const pairs: Array<{ a: MoleculeGraph; b: MoleculeGraph | null; T: number }> = [];
  const temps = [298, 800, 1500];
  for (const elA of SINGLE_ELEMENTS) {
    for (const elB of SINGLE_ELEMENTS) {
      const T = temps[(elA.length + elB.length) % temps.length] ?? 298;
      pairs.push({ a: mono(elA), b: mono(elB), T });
    }
  }
  for (const m of REPRESENTATIVE_MOLECULES) {
    for (const el of SINGLE_ELEMENTS) {
      pairs.push({ a: m, b: mono(el), T: 800 });
    }
    pairs.push({ a: m, b: null, T: 1500 }); // unimolecular decomposition sweep
  }
  return pairs;
}

const FUZZ_PAIRS = buildFuzzPairs();

describe('conservation: atoms, charge, mass', () => {
  it('every fuzzed reaction conserves per-element atom counts', () => {
    for (const { a, b, T } of FUZZ_PAIRS) {
      const result = findBestPartition(a, b, T);
      if (!result) continue;
      const reactantAtoms = [...a.atoms, ...(b?.atoms ?? [])];
      const reactantCounts = atomCountsOf(reactantAtoms);
      const productCounts = atomCountsOf(result.products.flatMap((p) => p.atoms));
      for (const [el, n] of reactantCounts) {
        expect(productCounts.get(el)).toBe(n);
      }
      expect(result.products.flatMap((p) => p.atoms)).toHaveLength(reactantAtoms.length);
    }
  });

  it('every fuzzed reaction conserves total formal charge', () => {
    for (const { a, b, T } of FUZZ_PAIRS) {
      const result = findBestPartition(a, b, T);
      if (!result) continue;
      const reactantAtoms = [...a.atoms, ...(b?.atoms ?? [])];
      const productAtoms = result.products.flatMap((p) => p.atoms);
      expect(totalCharge(productAtoms)).toBe(totalCharge(reactantAtoms));
    }
  });

  it('every fuzzed reaction conserves total mass within floating-point epsilon', () => {
    for (const { a, b, T } of FUZZ_PAIRS) {
      const result = findBestPartition(a, b, T);
      if (!result) continue;
      const reactantAtoms = [...a.atoms, ...(b?.atoms ?? [])];
      const productAtoms = result.products.flatMap((p) => p.atoms);
      expect(totalMass(productAtoms)).toBeCloseTo(totalMass(reactantAtoms), 6);
    }
  });
});

describe('conservation: determinism and order-independence', () => {
  it('findBestPartition is deterministic across repeated calls', () => {
    const a = mono('C');
    const b = diatomic('O', 'O', 2);
    const r1 = findBestPartition(a, b, 298);
    const r2 = findBestPartition(a, b, 298);
    expect(r1).toEqual(r2);
  });

  it('findBestPartition gives the same deltaH regardless of argument order', () => {
    for (const { a, b } of FUZZ_PAIRS.slice(0, 40)) {
      if (!b) continue;
      const forward = findBestPartition(a, b, 500);
      const reversed = findBestPartition(b, a, 500);
      expect(forward?.deltaH ?? null).toBe(reversed?.deltaH ?? null);
    }
  });

  it('reactPair through the full orchestration layer is deterministic', () => {
    const pool = new InternedPool();
    const salt = pool.intern({
      atoms: [atom('Na', 0, 1), atom('Cl', 1, -1)],
      bonds: [{ a: 0, b: 1, order: 0 }],
    });
    const water = pool.intern(triatomicBent('O', 'H'));
    const o1 = reactPair(salt, water, 298, 101, pool);
    const o2 = reactPair(salt, water, 298, 101, pool);
    expect(o1).toEqual(o2);
  });
});

describe('conservation: species-space boundedness', () => {
  it('every interned species across the fuzz sweep has at most 6 heavy atoms', () => {
    const pool = new InternedPool();
    for (const { a, b, T } of FUZZ_PAIRS) {
      const result = findBestPartition(a, b, T);
      if (!result) continue;
      for (const product of result.products) {
        const spec = pool.intern(product);
        const heavyAtoms = spec.graph.atoms.filter((atomEntry) => atomEntry.element !== 'H').length;
        expect(heavyAtoms).toBeLessThanOrEqual(6);
      }
    }
    // Bounded species space, not unboundedly exploding across a fairly wide
    // deterministic sweep (well under u16 range regardless).
    expect(pool.size).toBeLessThan(2000);
  });

  it('canonicalizing every interned species is idempotent (stable dedup key)', () => {
    const pool = new InternedPool();
    for (const { a, b, T } of FUZZ_PAIRS.slice(0, 60)) {
      const result = findBestPartition(a, b, T);
      if (!result) continue;
      for (const product of result.products) {
        const spec = pool.intern(product);
        expect(canonicalize(spec.graph).key).toBe(spec.canonicalKey);
      }
    }
  });
});

describe('conservation: partition-count guard', () => {
  it('every fuzzed reaction stays within the "low hundreds" partition budget', () => {
    for (const { a, b, T } of FUZZ_PAIRS) {
      const result = findBestPartition(a, b, T);
      if (!result) continue;
      expect(result.partitionsConsidered).toBeLessThan(500);
    }
  });
});

describe('conservation: sign sanity', () => {
  it('C + O2 -> CO2 style combustion is exothermic (deltaH < 0)', () => {
    const result = findBestPartition(mono('C'), diatomic('O', 'O', 2), 298);
    expect(result?.deltaH).toBeLessThan(0);
  });

  it('H2 -> 2H homolysis is endothermic (deltaH > 0)', () => {
    const result = findBestPartition(diatomic('H', 'H', 1), null, 1500);
    expect(result?.deltaH).toBeGreaterThan(0);
  });
});
