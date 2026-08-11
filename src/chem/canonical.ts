import type { BondOrder } from './bonds';
import { getElement } from './elements';
import type { Atom, Bond, MoleculeGraph } from './types';

/**
 * Canonical graph labeling for small molecule graphs (v1 species are capped
 * at <=6 heavy atoms, no rings), used as the InternedPool dedup key.
 *
 * Approach: iterative Weisfeiler-Leman-style atom-invariant refinement to
 * classify atoms into structural equivalence classes, then a canonical DFS
 * traversal (trying every atom as a candidate root -- cheap at this size,
 * automorphism groups are tiny) to pick the lexicographically smallest
 * whole-graph string. This is not full general-graph canonicalization (it
 * assumes acyclic/near-acyclic graphs, consistent with the "no rings in v1"
 * constraint); a real ring would still produce a deterministic string via
 * the visited-set DFS below, just not a rigorously-proven-canonical one.
 */

export interface CanonicalResult {
  key: string;
  graph: MoleculeGraph;
}

interface AdjEntry {
  to: number;
  order: BondOrder;
}

function buildAdjacency(graph: MoleculeGraph): Map<number, AdjEntry[]> {
  const adj = new Map<number, AdjEntry[]>();
  for (const atom of graph.atoms) adj.set(atom.id, []);
  for (const bond of graph.bonds) {
    adj.get(bond.a)?.push({ to: bond.b, order: bond.order });
    adj.get(bond.b)?.push({ to: bond.a, order: bond.order });
  }
  return adj;
}

function initialInvariant(atom: Atom, degree: number, sumOrders: number): string {
  const el = getElement(atom.element);
  return `${el.electronegativity.toFixed(2)}|${atom.element}|${atom.charge}|${degree}|${sumOrders}`;
}

function normalizeInvariants(raw: Map<number, string>, ids: number[]): Map<number, string> {
  const distinct = [...new Set(ids.map((id) => raw.get(id) ?? ''))].sort();
  const rankOf = new Map(distinct.map((v, i) => [v, String(i).padStart(4, '0')]));
  const result = new Map<number, string>();
  for (const id of ids) result.set(id, rankOf.get(raw.get(id) ?? '') ?? '0000');
  return result;
}

function refineInvariants(graph: MoleculeGraph, adj: Map<number, AdjEntry[]>): Map<number, string> {
  const ids = graph.atoms.map((a) => a.id);
  let invariants = new Map<number, string>();
  for (const atom of graph.atoms) {
    const neighbors = adj.get(atom.id) ?? [];
    const degree = neighbors.length;
    const sumOrders = neighbors.reduce((s, n) => s + n.order, 0);
    invariants.set(atom.id, initialInvariant(atom, degree, sumOrders));
  }
  invariants = normalizeInvariants(invariants, ids);

  const maxRounds = graph.atoms.length + 1;
  for (let round = 0; round < maxRounds; round++) {
    const next = new Map<number, string>();
    for (const id of ids) {
      const neighbors = adj.get(id) ?? [];
      const signature = neighbors
        .map((n) => `${invariants.get(n.to) ?? ''}#${n.order}`)
        .sort()
        .join(',');
      next.set(id, `${invariants.get(id) ?? ''}[${signature}]`);
    }
    const normalized = normalizeInvariants(next, ids);
    const changed = ids.some((id) => normalized.get(id) !== invariants.get(id));
    invariants = normalized;
    if (!changed) break;
  }
  return invariants;
}

function dfsTraversal(
  graph: MoleculeGraph,
  adj: Map<number, AdjEntry[]>,
  invariants: Map<number, string>,
  root: number,
): { str: string; order: number[] } {
  const byId = new Map(graph.atoms.map((a) => [a.id, a]));
  const visited = new Set<number>();
  const order: number[] = [];

  function visit(id: number): string {
    visited.add(id);
    order.push(id);
    const atom = byId.get(id);
    const neighbors = (adj.get(id) ?? [])
      .filter((n) => !visited.has(n.to))
      .sort((x, y) => {
        const c = (invariants.get(x.to) ?? '').localeCompare(invariants.get(y.to) ?? '');
        return c !== 0 ? c : x.order - y.order;
      });
    const childStrings = neighbors.map((n) => `${n.order}:${visit(n.to)}`);
    const chargeStr = atom && atom.charge >= 0 ? `+${atom.charge}` : `${atom?.charge ?? 0}`;
    return `(${atom?.element ?? '?'}${chargeStr}:${childStrings.join('|')})`;
  }

  let str = visit(root);

  // Any atoms not reached from root (disconnected components -- not expected
  // for v1 species, but kept deterministic rather than silently dropped).
  const remaining = graph.atoms.map((a) => a.id).filter((id) => !visited.has(id));
  remaining.sort((x, y) => (invariants.get(x) ?? '').localeCompare(invariants.get(y) ?? ''));
  for (const id of remaining) {
    str += `;${visit(id)}`;
  }

  return { str, order };
}

function smallestInvariantClass(graph: MoleculeGraph, invariants: Map<number, string>): number[] {
  const classes = new Map<string, number[]>();
  for (const atom of graph.atoms) {
    const inv = invariants.get(atom.id) ?? '';
    const list = classes.get(inv) ?? [];
    list.push(atom.id);
    classes.set(inv, list);
  }
  let smallest: number[] = graph.atoms.map((a) => a.id);
  for (const list of classes.values()) {
    if (list.length < smallest.length) smallest = list;
  }
  return smallest;
}

// Above this atom count, restrict candidate DFS roots to the smallest
// invariant class instead of brute-forcing every atom. v1 species (<=6
// heavy atoms) essentially never reach this, it's a defensive cap.
const BRUTE_FORCE_ROOT_LIMIT = 12;

export function canonicalize(graph: MoleculeGraph): CanonicalResult {
  if (graph.atoms.length === 0) return { key: '', graph: { atoms: [], bonds: [] } };

  const adj = buildAdjacency(graph);
  const invariants = refineInvariants(graph, adj);

  const candidateRoots =
    graph.atoms.length <= BRUTE_FORCE_ROOT_LIMIT
      ? graph.atoms.map((a) => a.id)
      : smallestInvariantClass(graph, invariants);

  let best: { str: string; order: number[] } | null = null;
  for (const root of candidateRoots) {
    const result = dfsTraversal(graph, adj, invariants, root);
    if (best === null || result.str < best.str) best = result;
  }
  if (best === null) {
    throw new Error('canonicalize: no candidate roots (unreachable for non-empty graph)');
  }

  const orderMap = new Map(best.order.map((origId, idx) => [origId, idx]));
  const byId = new Map(graph.atoms.map((a) => [a.id, a]));
  const atoms: Atom[] = best.order.map((origId, idx) => {
    const original = byId.get(origId);
    return { id: idx, element: original?.element ?? 'H', charge: original?.charge ?? 0 };
  });
  const bonds: Bond[] = graph.bonds
    .map((b) => ({
      a: orderMap.get(b.a) ?? 0,
      b: orderMap.get(b.b) ?? 0,
      order: b.order,
    }))
    .sort((x, y) => x.a - y.a || x.b - y.b);

  return { key: best.str, graph: { atoms, bonds } };
}
