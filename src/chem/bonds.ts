import { getElement } from './elements';
import type { ElementSymbol } from './types';

export type BondOrder = 0 | 1 | 2 | 3;

/**
 * Whether two elements can be bonded at all, and if so as an "ionic contact"
 * (order 0, routed to Born-Lande / lattice-energy treatment elsewhere) or as
 * a covalent bond (order 1-3). v1 rule: exactly one atom being a metal means
 * ionic; two nonmetals means covalent; two metals never bond in v1 (bulk
 * metal is represented as unbonded lattice atoms).
 */
export type BondCategory = 'ionic' | 'covalent' | 'illegal';

export function bondCategory(elA: ElementSymbol, elB: ElementSymbol): BondCategory {
  const a = getElement(elA).isMetal;
  const b = getElement(elB).isMetal;
  if (a && b) return 'illegal';
  if (a !== b) return 'ionic';
  return 'covalent';
}

// Elements capable of forming double bonds with each other (v1 scope).
const DOUBLE_BOND_ELEMENTS: ReadonlySet<ElementSymbol> = new Set(['C', 'N', 'O', 'S']);
// Pairs capable of forming a triple bond -- deliberately narrow (real triple
// bonds outside organic/N2/CO chemistry are essentially nonexistent).
const TRIPLE_BOND_PAIRS: ReadonlySet<string> = new Set(['C-C', 'C-N', 'C-O', 'N-N']);

function sortedPairKey(elA: ElementSymbol, elB: ElementSymbol): string {
  return elA <= elB ? `${elA}-${elB}` : `${elB}-${elA}`;
}

export function canFormBondOrder(elA: ElementSymbol, elB: ElementSymbol, order: BondOrder): boolean {
  const category = bondCategory(elA, elB);
  if (category === 'illegal') return false;
  if (category === 'ionic') return order === 0;
  // covalent
  if (order === 0) return false;
  if (order === 1) return true;
  if (order === 2) return DOUBLE_BOND_ELEMENTS.has(elA) && DOUBLE_BOND_ELEMENTS.has(elB);
  return TRIPLE_BOND_PAIRS.has(sortedPairKey(elA, elB));
}

// Curated bond dissociation energies (kJ/mol), average literature values, for
// the covalent bond types this project's v1 species space actually produces.
// Not exhaustive over every possible pair/order -- gaps fall back to a
// Pauling-style electronegativity estimate, see bondDissociationEnergy below.
const BDE_TABLE = new Map<string, number>();
function setBde(elA: ElementSymbol, elB: ElementSymbol, order: 1 | 2 | 3, value: number): void {
  BDE_TABLE.set(`${sortedPairKey(elA, elB)}-${order}`, value);
}

// Order 1 (single bonds)
setBde('H', 'H', 1, 436);
setBde('C', 'C', 1, 347);
setBde('N', 'N', 1, 163);
setBde('O', 'O', 1, 146);
setBde('S', 'S', 1, 266);
setBde('Cl', 'Cl', 1, 243);
setBde('C', 'H', 1, 413);
setBde('N', 'H', 1, 391);
setBde('O', 'H', 1, 463);
setBde('S', 'H', 1, 347);
setBde('Cl', 'H', 1, 432);
setBde('C', 'N', 1, 305);
setBde('C', 'O', 1, 358);
setBde('C', 'S', 1, 259);
setBde('C', 'Cl', 1, 339);
setBde('N', 'O', 1, 201);
setBde('N', 'S', 1, 270);
setBde('N', 'Cl', 1, 190);
setBde('O', 'S', 1, 265);
setBde('O', 'Cl', 1, 205);
setBde('S', 'Cl', 1, 255);

// Order 2 (double bonds), within {C, N, O, S}
setBde('C', 'C', 2, 614);
setBde('C', 'N', 2, 615);
setBde('C', 'O', 2, 745);
setBde('C', 'S', 2, 573);
setBde('N', 'N', 2, 418);
setBde('N', 'O', 2, 607);
setBde('O', 'O', 2, 498);
setBde('O', 'S', 2, 522);
setBde('N', 'S', 2, 447);
setBde('S', 'S', 2, 425);

// Order 3 (triple bonds), narrow legal set
setBde('C', 'C', 3, 839);
setBde('C', 'N', 3, 891);
setBde('C', 'O', 3, 1072); // carbon monoxide
setBde('N', 'N', 3, 945);

function homonuclearSingleFallback(el: ElementSymbol): number {
  const tabulated = BDE_TABLE.get(`${el}-${el}-1`);
  if (tabulated !== undefined) return tabulated;
  // Rough covalent-character estimate for elements with no tabulated
  // homonuclear single bond (mostly metals, whose bonds are handled via the
  // ionic path anyway -- this only feeds the Pauling estimate as a last resort).
  return Math.min(300, Math.max(50, getElement(el).atomizationEnthalpy * 0.6));
}

function paulingEstimate(elA: ElementSymbol, elB: ElementSymbol): number {
  const a = getElement(elA);
  const b = getElement(elB);
  const arithmeticMean = (homonuclearSingleFallback(elA) + homonuclearSingleFallback(elB)) / 2;
  const ionicCorrection = 96.5 * (a.electronegativity - b.electronegativity) ** 2;
  return arithmeticMean + ionicCorrection;
}

// e^2 / (4*pi*eps0) * N_A, converted to kJ*pm/mol -- the Coulomb energy of a
// one-electron-charge ion pair separated by 1 pm, per mole.
const COULOMB_KJ_PM_PER_MOL = 138_935;

function ionicContactEnergy(elA: ElementSymbol, elB: ElementSymbol): number {
  const a = getElement(elA);
  const b = getElement(elB);
  const metal = a.isMetal ? a : b;
  const nonmetal = a.isMetal ? b : a;
  const zMetal = Math.abs(metal.commonIonCharges[0] ?? 1);
  const zNonmetal = Math.abs(nonmetal.commonIonCharges[0] ?? 1);
  const r0 = (metal.ionicRadius ?? metal.covalentRadius) + (nonmetal.ionicRadius ?? nonmetal.covalentRadius);
  return (COULOMB_KJ_PM_PER_MOL * zMetal * zNonmetal) / r0;
}

/**
 * Bond dissociation / ionic-contact energy in kJ/mol for a bond of the given
 * order between two elements. order=0 routes to a simple Coulombic ionic
 * estimate; order 1-3 look up the curated table, falling back to a
 * Pauling-style electronegativity estimate (scaled for order>1) when untabulated.
 */
export function bondDissociationEnergy(elA: ElementSymbol, elB: ElementSymbol, order: BondOrder): number {
  if (order === 0) return ionicContactEnergy(elA, elB);
  const tabulated = BDE_TABLE.get(`${sortedPairKey(elA, elB)}-${order}`);
  if (tabulated !== undefined) return tabulated;
  const singleEstimate = BDE_TABLE.get(`${sortedPairKey(elA, elB)}-1`) ?? paulingEstimate(elA, elB);
  const multiplier = order === 1 ? 1 : order === 2 ? 1.75 : 2.2;
  return singleEstimate * multiplier;
}

// --- VSEPR-lite geometry, used by properties.ts to vector-sum bond dipoles ---

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

function normalize(v: Vec3): Vec3 {
  const len = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

const LINEAR: Vec3[] = [
  { x: 1, y: 0, z: 0 },
  { x: -1, y: 0, z: 0 },
];
const TRIGONAL: Vec3[] = [0, 120, 240].map((deg) => {
  const r = (deg * Math.PI) / 180;
  return { x: Math.cos(r), y: Math.sin(r), z: 0 };
});
const TETRAHEDRAL: Vec3[] = [
  { x: 1, y: 1, z: 1 },
  { x: 1, y: -1, z: -1 },
  { x: -1, y: 1, z: -1 },
  { x: -1, y: -1, z: 1 },
].map(normalize);

// Typical lone-pair count at an element's lowest common valence -- a static
// approximation (not context-sensitive to actual bonding), sufficient for
// v1's geometry-guessing purposes.
const LONE_PAIRS: Partial<Record<ElementSymbol, number>> = { N: 1, O: 2, S: 2, Cl: 3 };

export function estimateLonePairs(element: ElementSymbol): number {
  return LONE_PAIRS[element] ?? 0;
}

/**
 * Idealized unit-vector bond directions for a central atom with the given
 * number of bond domains (multi-bonds count once) and lone pairs, per
 * VSEPR steric number. Approximate: bond positions are simply the first
 * `bondDomainCount` idealized positions of the steric-number geometry.
 */
export function vseprBondVectors(bondDomainCount: number, lonePairCount: number): Vec3[] {
  if (bondDomainCount <= 0) return [];
  const steric = bondDomainCount + lonePairCount;
  let positions: Vec3[];
  if (steric <= 1) positions = [{ x: 1, y: 0, z: 0 }];
  else if (steric === 2) positions = LINEAR;
  else if (steric === 3) positions = TRIGONAL;
  else positions = TETRAHEDRAL;
  return positions.slice(0, Math.min(bondDomainCount, positions.length));
}

// Calibrated against HCl (~1.05 D at delta-EN 0.96) and used as a rough
// per-bond dipole magnitude for vector-summing molecular dipole moments.
export const BOND_DIPOLE_DEBYE_PER_EN = 1.09;

export function bondDipoleMagnitude(elA: ElementSymbol, elB: ElementSymbol): number {
  const dEN = getElement(elA).electronegativity - getElement(elB).electronegativity;
  return BOND_DIPOLE_DEBYE_PER_EN * Math.abs(dEN);
}
