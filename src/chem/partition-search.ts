import { bondDissociationEnergy, canFormBondOrder } from './bonds';
import { canonicalize } from './canonical';
import { getElement } from './elements';
import { computeProperties } from './properties';
import type { Atom, Bond, ElementSymbol, MoleculeGraph, ReactionCandidate } from './types';

/**
 * The algorithmic core: given two reactant graphs (b=null for a unimolecular
 * step), finds the lowest-Delta-G set of valence-valid products. See the
 * project plan doc for the step-by-step design (group-shape partition
 * generation -> per-group bonding-graph DFS -> Delta-G scoring).
 */

const MAX_GROUPS = 3;
const MAX_HEAVY_ATOMS = 6;
const MAX_CARBON_ATOMS = 2;
const MAX_BOND_GRAPH_RESULTS_PER_GROUP = 64;
const MAX_PARTITIONS_CONSIDERED = 1000;

type CountVector = Map<ElementSymbol, number>;

// --- Combine reactants into one tagged atom pool ---

function combineReactants(a: MoleculeGraph, b: MoleculeGraph | null): { atoms: Atom[]; bonds: Bond[] } {
  const offset = a.atoms.length;
  const bAtoms = b ? b.atoms.map((atom) => ({ ...atom, id: atom.id + offset })) : [];
  const bBonds = b ? b.bonds.map((bond) => ({ a: bond.a + offset, b: bond.b + offset, order: bond.order })) : [];
  return {
    atoms: [...a.atoms, ...bAtoms],
    bonds: [...a.bonds, ...bBonds],
  };
}

function combinedCounts(atoms: Atom[]): CountVector {
  const counts = new Map<ElementSymbol, number>();
  for (const atom of atoms) counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  return counts;
}

// --- Step B: group-shape (per-element-count) partition generation ---

function distributeAmount(total: number, parts: number, cb: (parts: number[]) => void): void {
  const current = new Array<number>(parts).fill(0);
  function rec(index: number, remaining: number): void {
    if (index === parts - 1) {
      current[index] = remaining;
      cb([...current]);
      return;
    }
    for (let v = 0; v <= remaining; v++) {
      current[index] = v;
      rec(index + 1, remaining - v);
    }
  }
  rec(0, total);
}

function shapeKey(shape: CountVector[]): string {
  return shape
    .map((g) => [...g.entries()].sort().map(([el, n]) => `${el}${n}`).join(''))
    .sort()
    .join('|');
}

function generateShapes(counts: CountVector, maxGroups: number): CountVector[][] {
  const elements = [...counts.keys()];
  const raw: CountVector[][] = [];

  function build(elementIndex: number, groups: CountVector[]): void {
    if (elementIndex === elements.length) {
      const nonEmpty = groups.filter((g) => [...g.values()].some((v) => v > 0));
      if (nonEmpty.length > 0) raw.push(nonEmpty.map((g) => new Map(g)));
      return;
    }
    const element = elements[elementIndex] as ElementSymbol;
    const total = counts.get(element) ?? 0;
    distributeAmount(total, groups.length, (parts) => {
      const next = groups.map((g, i) => {
        const copy = new Map(g);
        const amount = parts[i] ?? 0;
        if (amount > 0) copy.set(element, amount);
        return copy;
      });
      build(elementIndex + 1, next);
    });
  }

  build(0, Array.from({ length: maxGroups }, () => new Map<ElementSymbol, number>()));

  const seen = new Set<string>();
  const deduped: CountVector[][] = [];
  for (const shape of raw) {
    const key = shapeKey(shape);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(shape);
  }
  return deduped;
}

function shapeIsPlausible(shape: CountVector[]): boolean {
  for (const group of shape) {
    let heavy = 0;
    let size = 0;
    let carbon = 0;
    let maxValenceSum = 0;
    for (const [el, n] of group) {
      size += n;
      if (el !== 'H') heavy += n;
      if (el === 'C') carbon += n;
      maxValenceSum += Math.max(...getElement(el).standardValences) * n;
    }
    if (heavy > MAX_HEAVY_ATOMS) return false;
    if (carbon > MAX_CARBON_ATOMS) return false;
    if (size > 1 && maxValenceSum < 2 * (size - 1)) return false;
  }
  return true;
}

// Assigns specific original atoms (preserving id/charge) to a shape's
// per-group element counts. Same-element atoms are sorted by (charge, id)
// and sliced sequentially -- this doesn't explore every possible charge-to-
// group assignment when same-element atoms carry different charges, but
// that situation is rare in v1 reactant pairs; documented simplification.
function assignAtomsToShape(atoms: Atom[], shape: CountVector[]): Atom[][] | null {
  const byElement = new Map<ElementSymbol, Atom[]>();
  for (const atom of atoms) {
    const list = byElement.get(atom.element) ?? [];
    list.push(atom);
    byElement.set(atom.element, list);
  }
  for (const list of byElement.values()) {
    list.sort((x, y) => x.charge - y.charge || x.id - y.id);
  }

  const groups: Atom[][] = shape.map(() => []);
  const cursor = new Map<ElementSymbol, number>();

  for (let g = 0; g < shape.length; g++) {
    const group = shape[g];
    if (!group) continue;
    for (const [element, count] of group) {
      const pool = byElement.get(element) ?? [];
      const start = cursor.get(element) ?? 0;
      const slice = pool.slice(start, start + count);
      if (slice.length !== count) return null;
      groups[g]?.push(...slice);
      cursor.set(element, start + count);
    }
  }
  return groups;
}

// --- Step C: per-group bonding-graph DFS enumeration ---

function isConnected(ids: number[], bonds: Bond[]): boolean {
  if (ids.length <= 1) return true;
  const adj = new Map<number, number[]>();
  for (const id of ids) adj.set(id, []);
  for (const b of bonds) {
    adj.get(b.a)?.push(b.b);
    adj.get(b.b)?.push(b.a);
  }
  const start = ids[0];
  if (start === undefined) return true;
  const visited = new Set<number>([start]);
  const stack = [start];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) continue;
    for (const next of adj.get(cur) ?? []) {
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }
  return visited.size === ids.length;
}

// A group containing both a metal and a nonmetal atom bonds ionically
// (order=0), not covalently -- see bonds.ts's bondCategory. The valence-sum
// DFS below is built for covalent bonding (bond order = valence consumed)
// and doesn't apply to ionic contacts, so mixed groups are routed to a
// separate charge-balancing constructor instead.
function groupIsIonic(atoms: Atom[]): boolean {
  const hasMetal = atoms.some((a) => getElement(a.element).isMetal);
  const hasNonmetal = atoms.some((a) => !getElement(a.element).isMetal);
  return hasMetal && hasNonmetal;
}

// Connects one metal atom (the "hub") to every nonmetal atom, and every
// other metal atom to the first nonmetal atom -- a minimal spanning tree
// (atoms.length - 1 bonds) that's always fully connected, regardless of
// exact real crystal topology (which this simulation doesn't model).
function buildIonicSpanningTree(metals: Atom[], nonmetals: Atom[]): Bond[] {
  const hub = metals[0];
  const firstNonmetal = nonmetals[0];
  if (!hub || !firstNonmetal) return [];
  const bonds: Bond[] = nonmetals.map((nm) => ({ a: hub.id, b: nm.id, order: 0 as const }));
  for (const m of metals.slice(1)) {
    bonds.push({ a: m.id, b: firstNonmetal.id, order: 0 });
  }
  return bonds;
}

// Tries every combination of each atom's common ion charges, keeping only
// charge-balanced (net-neutral) formula units -- e.g. for {Fe:2, O:3} only
// Fe3+/Fe3+/O2-/O2-/O2- sums to zero, correctly picking Fe(III) oxide over
// Fe(II).
function enumerateIonicGraphs(groupAtoms: Atom[]): MoleculeGraph[] {
  const metals = groupAtoms.filter((a) => getElement(a.element).isMetal);
  const nonmetals = groupAtoms.filter((a) => !getElement(a.element).isMetal);
  if (metals.length === 0 || nonmetals.length === 0) return [];

  const metalOptions = metals.map((a) => getElement(a.element).commonIonCharges.filter((c) => c > 0));
  const nonmetalOptions = nonmetals.map((a) => getElement(a.element).commonIonCharges.filter((c) => c < 0));
  if (metalOptions.some((opts) => opts.length === 0) || nonmetalOptions.some((opts) => opts.length === 0)) {
    return [];
  }

  function allCombinations(options: number[][]): number[][] {
    let combos: number[][] = [[]];
    for (const opts of options) {
      const next: number[][] = [];
      for (const combo of combos) {
        for (const charge of opts) next.push([...combo, charge]);
      }
      combos = next;
    }
    return combos;
  }

  const results: MoleculeGraph[] = [];
  const seen = new Set<string>();
  for (const metalCharges of allCombinations(metalOptions)) {
    for (const nonmetalCharges of allCombinations(nonmetalOptions)) {
      const total = metalCharges.reduce((s, c) => s + c, 0) + nonmetalCharges.reduce((s, c) => s + c, 0);
      if (total !== 0) continue;
      const chargedMetals = metals.map((a, i) => ({ ...a, charge: metalCharges[i] ?? 0 }));
      const chargedNonmetals = nonmetals.map((a, i) => ({ ...a, charge: nonmetalCharges[i] ?? 0 }));
      const key = [...chargedMetals, ...chargedNonmetals].map((a) => `${a.id}:${a.charge}`).sort().join(',');
      if (seen.has(key)) continue;
      seen.add(key);
      results.push({
        atoms: [...chargedMetals, ...chargedNonmetals],
        bonds: buildIonicSpanningTree(chargedMetals, chargedNonmetals),
      });
    }
  }
  return results;
}

export function enumerateBondGraphs(groupAtoms: Atom[]): MoleculeGraph[] {
  const n = groupAtoms.length;
  if (n === 0) return [];
  if (n === 1) {
    const a = groupAtoms[0];
    if (!a) return [];
    // A lone atom can also represent simple electron transfer (no bond
    // formed at all) into any of its common ion charge states, not just its
    // input charge -- e.g. Cu(0) -> Cu2+ paired elsewhere in the same
    // reaction with some other atom gaining that charge. Which combination
    // is actually chosen (and charge-conserving) is resolved by the caller.
    const options = new Set<number>([a.charge, 0, ...getElement(a.element).commonIonCharges]);
    return [...options].map((charge) => ({ atoms: [{ ...a, charge }], bonds: [] }));
  }
  if (groupIsIonic(groupAtoms)) return enumerateIonicGraphs(groupAtoms);

  const ordered = [...groupAtoms].sort((x, y) => {
    const enX = getElement(x.element).electronegativity;
    const enY = getElement(y.element).electronegativity;
    return enX !== enY ? enY - enX : x.id - y.id;
  });
  const ids = ordered.map((a) => a.id);
  const byId = new Map(ordered.map((a) => [a.id, a]));

  const currentSum = new Map<number, number>(ids.map((id) => [id, 0]));
  const bonds: Bond[] = [];
  const results: MoleculeGraph[] = [];
  const seenKeys = new Set<string>();
  const excused = new Set<number>();
  let steps = 0;

  function isSatisfiable(id: number): boolean {
    const atom = byId.get(id);
    if (!atom) return true;
    return getElement(atom.element).standardValences.includes(currentSum.get(id) ?? 0);
  }

  function hasTripleBond(id: number): boolean {
    return bonds.some((b) => (b.a === id || b.b === id) && b.order === 3);
  }

  function canAcceptMore(id: number): boolean {
    const atom = byId.get(id);
    if (!atom) return false;
    // A triple bond saturates real bonding capacity in every v1 case (N2,
    // C-C, C-N, C-O/CO) even when the element's nominal valence list would
    // technically allow more -- without this, e.g. N already triple-bonded
    // to N could still pick up extra O= substituents via its valence-5
    // option, producing hypervalent structures with no real analogue.
    if (hasTripleBond(id)) return false;
    const maxValence = Math.max(...getElement(atom.element).standardValences);
    return (currentSum.get(id) ?? 0) < maxValence;
  }

  function nextUnsatisfied(): number | null {
    for (const id of ids) {
      if (excused.has(id)) continue;
      if (!isSatisfiable(id)) return id;
    }
    return null;
  }

  function recordIfValid(): void {
    if (!isConnected(ids, bonds)) return;
    const key = [...bonds].map((b) => `${b.a}-${b.b}-${b.order}`).sort().join(',');
    if (seenKeys.has(key)) return;
    seenKeys.add(key);
    results.push({
      atoms: ordered.map((a) => ({ ...a })),
      bonds: bonds.map((b) => ({ ...b })),
    });
  }

  function backtrack(): void {
    if (results.length >= MAX_BOND_GRAPH_RESULTS_PER_GROUP) return;
    steps++;
    if (steps > 50_000) return;

    const unsatisfiedId = nextUnsatisfied();
    if (unsatisfiedId === null) {
      recordIfValid();
      return;
    }

    const atom = byId.get(unsatisfiedId);
    if (!atom) return;
    const valences = getElement(atom.element).standardValences;
    const sum = currentSum.get(unsatisfiedId) ?? 0;
    const isOffByOne = valences.some((v) => v === sum + 1);

    if (excused.size === 0 && isOffByOne && atom.charge === 0) {
      excused.add(unsatisfiedId);
      backtrack();
      excused.delete(unsatisfiedId);
    }

    if (canAcceptMore(unsatisfiedId)) {
      for (const otherId of ids) {
        if (otherId === unsatisfiedId) continue;
        if (!canAcceptMore(otherId)) continue;
        const otherAtom = byId.get(otherId);
        if (!otherAtom) continue;
        if (bonds.some((b) => (b.a === unsatisfiedId && b.b === otherId) || (b.a === otherId && b.b === unsatisfiedId))) {
          continue;
        }
        for (const order of [1, 2, 3] as const) {
          if (!canFormBondOrder(atom.element, otherAtom.element, order)) continue;
          const otherMax = Math.max(...getElement(otherAtom.element).standardValences);
          const selfMax = Math.max(...valences);
          if (sum + order > selfMax) continue;
          if ((currentSum.get(otherId) ?? 0) + order > otherMax) continue;
          // A brand-new triple bond only forms between two atoms that are
          // still completely unbonded -- it monopolizes bonding capacity
          // from the start (see canAcceptMore's post-formation check),
          // not just after it already exists.
          if (order === 3 && (sum !== 0 || (currentSum.get(otherId) ?? 0) !== 0)) continue;

          bonds.push({ a: unsatisfiedId, b: otherId, order });
          currentSum.set(unsatisfiedId, (currentSum.get(unsatisfiedId) ?? 0) + order);
          currentSum.set(otherId, (currentSum.get(otherId) ?? 0) + order);

          backtrack();

          bonds.pop();
          currentSum.set(unsatisfiedId, (currentSum.get(unsatisfiedId) ?? 0) - order);
          currentSum.set(otherId, (currentSum.get(otherId) ?? 0) - order);
        }
      }
    }
  }

  backtrack();
  return results;
}

// --- Step D/E: score a full partition and pick the best ---

function computeBondsBrokenEnthalpy(originalAtoms: Atom[], originalBonds: Bond[], products: MoleculeGraph[]): number {
  const byId = new Map(originalAtoms.map((a) => [a.id, a]));
  const productPairs = new Set<string>();
  for (const p of products) {
    for (const bond of p.bonds) {
      productPairs.add(bond.a <= bond.b ? `${bond.a}-${bond.b}` : `${bond.b}-${bond.a}`);
    }
  }
  let total = 0;
  for (const bond of originalBonds) {
    const key = bond.a <= bond.b ? `${bond.a}-${bond.b}` : `${bond.b}-${bond.a}`;
    if (productPairs.has(key)) continue;
    const elA = byId.get(bond.a)?.element;
    const elB = byId.get(bond.b)?.element;
    if (!elA || !elB) continue;
    total += bondDissociationEnergy(elA, elB, bond.order);
  }
  return total;
}

function conservesAtoms(originalAtoms: Atom[], products: MoleculeGraph[]): boolean {
  const originalCounts = combinedCounts(originalAtoms);
  const productAtoms = products.flatMap((p) => p.atoms);
  if (productAtoms.length !== originalAtoms.length) return false;
  const productCounts = combinedCounts(productAtoms);
  for (const [el, n] of originalCounts) {
    if (productCounts.get(el) !== n) return false;
  }
  return true;
}

function buildCacheKey(a: MoleculeGraph, b: MoleculeGraph | null, T: number): string {
  const keyA = canonicalize(a).key;
  const keyB = b ? canonicalize(b).key : '';
  const [lo, hi] = keyA <= keyB ? [keyA, keyB] : [keyB, keyA];
  const tempBucket = Math.round(T / 50) * 50;
  return `${lo}|${hi}|${tempBucket}`;
}

const CACHE = new Map<string, ReactionCandidate | null>();

function cartesianProduct<T>(sets: T[][]): T[][] {
  let result: T[][] = [[]];
  for (const set of sets) {
    const next: T[][] = [];
    for (const combo of result) {
      for (const item of set) next.push([...combo, item]);
    }
    result = next;
  }
  return result;
}

function computeBestPartition(a: MoleculeGraph, b: MoleculeGraph | null, T: number): ReactionCandidate | null {
  const { atoms, bonds: originalBonds } = combineReactants(a, b);
  const counts = combinedCounts(atoms);
  const shapes = generateShapes(counts, MAX_GROUPS).filter(shapeIsPlausible);

  const reactantDeltaHf = computeProperties(a).deltaHf + (b ? computeProperties(b).deltaHf : 0);
  const reactantEntropy = computeProperties(a).standardEntropy + (b ? computeProperties(b).standardEntropy : 0);
  const reactantCharge = atoms.reduce((sum, atomEntry) => sum + atomEntry.charge, 0);
  const reactantFormula = computeProperties(a).formula;

  let best: ReactionCandidate | null = null;
  let partitionsConsidered = 0;

  for (const shape of shapes) {
    if (partitionsConsidered >= MAX_PARTITIONS_CONSIDERED) break;
    const groupAtomSets = assignAtomsToShape(atoms, shape);
    if (!groupAtomSets) continue;

    // Multi-atom groups: their net charge contribution is fixed regardless
    // of which isomer wins (covalent groups pass input charges through
    // unchanged; ionic groups are constructed to always net to zero), so
    // pick the single lowest-deltaHf candidate immediately. Single-atom
    // groups can represent electron transfer (see enumerateBondGraphs),
    // so all their charge-state candidates are kept for the charge-
    // conserving cross-product below.
    const groupCandidateSets: MoleculeGraph[][] = [];
    let feasible = true;
    for (const groupAtoms of groupAtomSets) {
      const candidates = enumerateBondGraphs(groupAtoms);
      if (candidates.length === 0) {
        feasible = false;
        break;
      }
      if (groupAtoms.length === 1) {
        groupCandidateSets.push(candidates);
        continue;
      }
      let bestGraph = candidates[0] as MoleculeGraph;
      let bestDeltaHf = computeProperties(bestGraph).deltaHf;
      for (const candidate of candidates.slice(1)) {
        const dHf = computeProperties(candidate).deltaHf;
        if (dHf < bestDeltaHf) {
          bestDeltaHf = dHf;
          bestGraph = candidate;
        }
      }
      groupCandidateSets.push([bestGraph]);
    }
    if (!feasible) continue;

    for (const groupProducts of cartesianProduct(groupCandidateSets)) {
      const productCharge = groupProducts.reduce(
        (sum, p) => sum + p.atoms.reduce((s, atomEntry) => s + atomEntry.charge, 0),
        0,
      );
      if (productCharge !== reactantCharge) continue;
      if (!conservesAtoms(atoms, groupProducts)) continue;

      partitionsConsidered++;
      if (partitionsConsidered > MAX_PARTITIONS_CONSIDERED) break;

      // Reforming into a single product that's the same species as the
      // original reactant isn't decomposition -- exclude it for
      // unimolecular calls so a genuinely metastable species (H2O2, O3,
      // Cl2, ...) can surface its real (higher-energy) fragmentation
      // products instead of trivially "staying itself".
      if (b === null && groupProducts.length === 1) {
        const productFormula = computeProperties(groupProducts[0] as MoleculeGraph).formula;
        if (productFormula === reactantFormula) continue;
      }

      const productDeltaHf = groupProducts.reduce((sum, p) => sum + computeProperties(p).deltaHf, 0);
      const productEntropy = groupProducts.reduce((sum, p) => sum + computeProperties(p).standardEntropy, 0);
      const deltaH = productDeltaHf - reactantDeltaHf;
      const deltaS = productEntropy - reactantEntropy;
      const deltaG = deltaH - (T * deltaS) / 1000;
      const bondsBrokenEnthalpy = computeBondsBrokenEnthalpy(atoms, originalBonds, groupProducts);

      const candidate: ReactionCandidate = {
        products: groupProducts,
        deltaH,
        deltaS,
        deltaG,
        bondsBrokenEnthalpy,
        partitionsConsidered,
      };

      if (
        best === null ||
        candidate.deltaG < best.deltaG ||
        (candidate.deltaG === best.deltaG && candidate.bondsBrokenEnthalpy < best.bondsBrokenEnthalpy)
      ) {
        best = candidate;
      }
    }
  }

  if (best) best.partitionsConsidered = partitionsConsidered;
  return best;
}

export function findBestPartition(a: MoleculeGraph, b: MoleculeGraph | null, T: number): ReactionCandidate | null {
  const key = buildCacheKey(a, b, T);
  if (CACHE.has(key)) return CACHE.get(key) ?? null;
  const result = computeBestPartition(a, b, T);
  CACHE.set(key, result);
  return result;
}
