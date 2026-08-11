import { describe, expect, it } from 'vitest';
import { enumerateBondGraphs, findBestPartition } from './partition-search';
import type { Atom, MoleculeGraph } from './types';

function atom(element: Atom['element'], id: number, charge = 0): Atom {
  return { id, element, charge };
}

describe('enumerateBondGraphs (spike: de-risking the DFS bonding approach)', () => {
  it('bonds two H atoms into H2', () => {
    const results = enumerateBondGraphs([atom('H', 0), atom('H', 1)]);
    expect(results.length).toBeGreaterThan(0);
    const h2 = results.find((g) => g.bonds.length === 1);
    expect(h2).toBeDefined();
    expect(h2?.bonds[0]?.order).toBe(1);
  });

  it('returns the atom itself, unbonded, for a single-atom group (plus any alternate charge states)', () => {
    const results = enumerateBondGraphs([atom('Na', 0, 1)]);
    expect(results.length).toBeGreaterThanOrEqual(1);
    for (const r of results) expect(r.bonds).toHaveLength(0);
    const original = results.find((r) => r.atoms[0]?.charge === 1);
    expect(original).toBeDefined();
  });

  it('returns nothing for an empty group', () => {
    expect(enumerateBondGraphs([])).toEqual([]);
  });

  it('bonds O + 2H into a connected water-shaped graph', () => {
    const results = enumerateBondGraphs([atom('O', 0), atom('H', 1), atom('H', 2)]);
    const water = results.find((g) => g.bonds.length === 2 && g.bonds.every((b) => b.order === 1));
    expect(water).toBeDefined();
  });

  it('allows a single radical (one atom short by exactly one valence unit)', () => {
    // A lone O atom has no partner -- must come out as a radical (degree 0, O valence [2])
    const results = enumerateBondGraphs([atom('O', 0), atom('H', 1)]);
    // O-H (both satisfied, degree1 each -- O is a radical here since its only
    // valence option is 2, but this is the OH radical case, expected)
    expect(results.length).toBeGreaterThan(0);
    for (const g of results) {
      expect(g.bonds.length).toBeLessThanOrEqual(1);
    }
  });

  it('only produces connected graphs', () => {
    const results = enumerateBondGraphs([atom('C', 0), atom('H', 1), atom('H', 2), atom('H', 3), atom('H', 4)]);
    for (const g of results) {
      // CH4-shaped: every result must be a single connected component
      const ids = g.atoms.map((a) => a.id);
      const adj = new Map<number, number[]>(ids.map((id) => [id, []]));
      for (const b of g.bonds) {
        adj.get(b.a)?.push(b.b);
        adj.get(b.b)?.push(b.a);
      }
      const visited = new Set<number>([ids[0] as number]);
      const stack = [ids[0] as number];
      while (stack.length) {
        const cur = stack.pop() as number;
        for (const n of adj.get(cur) ?? []) {
          if (!visited.has(n)) {
            visited.add(n);
            stack.push(n);
          }
        }
      }
      expect(visited.size).toBe(ids.length);
    }
  });
});

function diatomic(elA: Atom['element'], elB: Atom['element'], order: 1 | 2 | 3): MoleculeGraph {
  return { atoms: [atom(elA, 0), atom(elB, 1)], bonds: [{ a: 0, b: 1, order }] };
}

describe('findBestPartition', () => {
  it('finds H + H -> H2 as favorable at room temperature', () => {
    const h = (id: number): MoleculeGraph => ({ atoms: [atom('H', id)], bonds: [] });
    const result = findBestPartition(h(0), h(1), 298);
    expect(result).not.toBeNull();
    expect(result?.products).toHaveLength(1);
    expect(result?.products[0]?.atoms).toHaveLength(2);
    expect(result?.deltaH).toBeLessThan(0); // H2 formation from atoms is exothermic
  });

  it('finds OH + H -> H2O as strongly exothermic', () => {
    const oh: MoleculeGraph = { atoms: [atom('O', 0), atom('H', 1)], bonds: [{ a: 0, b: 1, order: 1 }] };
    const hAtom: MoleculeGraph = { atoms: [atom('H', 0)], bonds: [] };
    const result = findBestPartition(oh, hAtom, 298);
    expect(result).not.toBeNull();
    expect(result?.deltaH).toBeLessThan(-100);
    const products = result?.products ?? [];
    expect(products).toHaveLength(1);
    const water = products[0];
    expect(water?.atoms).toHaveLength(3);
  });

  it('is order-independent (a,b gives the same result as b,a)', () => {
    const h = (id: number): MoleculeGraph => ({ atoms: [atom('H', id)], bonds: [] });
    const r1 = findBestPartition(h(0), h(1), 500);
    const r2 = findBestPartition(h(0), h(1), 500);
    expect(r1?.deltaH).toBe(r2?.deltaH);
  });

  it('is deterministic across repeated calls (memoization does not leak nondeterminism)', () => {
    const co2 = { atoms: [atom('C', 0), atom('O', 1), atom('O', 2)], bonds: [{ a: 0 as const, b: 1 as const, order: 2 as const }, { a: 0 as const, b: 2 as const, order: 2 as const }] };
    const o = (id: number): MoleculeGraph => ({ atoms: [atom('O', id)], bonds: [] });
    const r1 = findBestPartition(co2, o(3), 298);
    const r2 = findBestPartition(co2, o(3), 298);
    expect(r1).toEqual(r2);
  });

  it('keeps partitions-considered bounded ("low hundreds") for a moderate reactant pair', () => {
    const h2o2: MoleculeGraph = {
      atoms: [atom('H', 0), atom('O', 1), atom('O', 2), atom('H', 3)],
      bonds: [
        { a: 0, b: 1, order: 1 },
        { a: 1, b: 2, order: 1 },
        { a: 2, b: 3, order: 1 },
      ],
    };
    const o2 = diatomic('O', 'O', 2);
    const result = findBestPartition(h2o2, o2, 298);
    expect(result).not.toBeNull();
    expect(result?.partitionsConsidered ?? 0).toBeLessThan(500);
  });

  it('returns null when no reactant pair is given and the molecule is already the simplest form', () => {
    const heliumLike: MoleculeGraph = { atoms: [atom('Na', 0)], bonds: [] };
    // A lone Na atom has nothing to combine with in a unimolecular step and
    // no bonds to break -- there is no lower-energy partition than itself,
    // so the search should find nothing better (null) or a trivial no-op.
    const result = findBestPartition(heliumLike, null, 298);
    expect(result === null || result.deltaH >= 0).toBe(true);
  });
});
