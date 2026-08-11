import { attemptDissolution } from './dissolution';
import type { InternedPool } from './intern';
import { evansPolanyiEa, reactionProbability } from './kinetics';
import { findBestPartition } from './partition-search';
import type { MoleculeSpec, ReactionCandidate, ReactionOutcome } from './types';

/**
 * Public orchestration layer: decides whether a reactant pair routes to the
 * dissolution model or the general partition-search model, and (for the
 * *attempt variants) fires probabilistically and interns products.
 */

// Small, mostly solvation-reorganization activation energy for dissolution
// -- it isn't a bond-homolysis process, so Evans-Polanyi's bonds-broken
// formula doesn't apply here the way it does for covalent reactions.
const DISSOLUTION_EA_KJ = 15;

function isIonicSolid(spec: MoleculeSpec): boolean {
  return spec.graph.bonds.some((b) => b.order === 0);
}

function isWater(spec: MoleculeSpec): boolean {
  return spec.properties.formula === 'H2O';
}

function dissolutionOutcome(solid: MoleculeSpec, T: number): ReactionOutcome {
  const result = attemptDissolution(solid.graph, T);
  if (!result.favorable) {
    return { candidate: null, Ea: 0, probability: 0 };
  }
  const candidate: ReactionCandidate = {
    products: result.products,
    deltaH: result.deltaH,
    deltaS: 0,
    deltaG: result.deltaG,
    bondsBrokenEnthalpy: 0,
    partitionsConsidered: 1,
  };
  const probability = reactionProbability(DISSOLUTION_EA_KJ, T);
  return { candidate, Ea: DISSOLUTION_EA_KJ, probability };
}

/** Preview what would happen if a and b reacted at (T, P) -- no firing, no pool mutation. */
export function reactPair(a: MoleculeSpec, b: MoleculeSpec, T: number, _P: number, _pool: InternedPool): ReactionOutcome {
  if (isIonicSolid(a) && isWater(b)) return dissolutionOutcome(a, T);
  if (isIonicSolid(b) && isWater(a)) return dissolutionOutcome(b, T);

  const candidate = findBestPartition(a.graph, b.graph, T);
  if (!candidate) {
    return { candidate: null, Ea: 0, probability: 0 };
  }
  const Ea = evansPolanyiEa(candidate.bondsBrokenEnthalpy, candidate.deltaH);
  const probability = reactionProbability(Ea, T);
  return { candidate, Ea, probability };
}

/** Previews a and b reacting, then fires probabilistically via rng() and interns any products. */
export function attemptReaction(
  a: MoleculeSpec,
  b: MoleculeSpec,
  T: number,
  P: number,
  pool: InternedPool,
  rng: () => number,
): ReactionOutcome & { fired: boolean; productSpecIds?: number[] } {
  const outcome = reactPair(a, b, T, P, pool);
  if (!outcome.candidate || rng() >= outcome.probability) {
    return { ...outcome, fired: false };
  }
  const productSpecIds = outcome.candidate.products.map((p) => pool.intern(p).specId);
  return { ...outcome, fired: true, productSpecIds };
}

/**
 * Previews (or, with rng, attempts) unimolecular decomposition of a. rng is
 * optional: omit it to just preview the outcome without firing/interning.
 */
export function decomposeUnimolecular(
  a: MoleculeSpec,
  T: number,
  pool: InternedPool,
  rng?: () => number,
): ReactionOutcome & { fired?: boolean; productSpecIds?: number[] } {
  const candidate = findBestPartition(a.graph, null, T);
  if (!candidate) {
    return { candidate: null, Ea: 0, probability: 0 };
  }
  const Ea = evansPolanyiEa(candidate.bondsBrokenEnthalpy, candidate.deltaH);
  const probability = reactionProbability(Ea, T);
  const outcome: ReactionOutcome = { candidate, Ea, probability };

  if (!rng) return outcome;
  if (rng() >= probability) return { ...outcome, fired: false };

  const productSpecIds = candidate.products.map((p) => pool.intern(p).specId);
  return { ...outcome, fired: true, productSpecIds };
}
