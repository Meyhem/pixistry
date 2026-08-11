import { getElement } from './elements';
import type { Element, ElementSymbol, MoleculeGraph } from './types';

/**
 * Dissolution as a Delta-G-gated reaction: solid ionic lattice -> separated
 * aqueous ions, via a simplified Born-Haber-like cycle:
 *   deltaH_solution = latticeEnergy (positive, cost of breaking the lattice
 *                     into gaseous ions) + hydrationEnthalpy (negative,
 *                     release of surrounding gaseous ions with water)
 *   deltaG_solution = deltaH_solution - T * deltaS_sol
 * A solid ionic compound is represented with Bond.order=0 ("ionic contact")
 * between its cation(s) and anion(s) -- see bonds.ts's bondCategory.
 */

// Kapustinskii-equation constants (a well-known generalization of the
// Born-Lande/Madelung approach that estimates lattice energy from ion
// charges, ion count per formula unit, and contact distance alone -- no
// structure-specific Madelung constant needed). This matters here because
// v1 salts span multiple stoichiometries (NaCl 1:1, CaCl2 1:2, ...) and a
// naive per-ionic-bond sum of a fixed-Madelung-constant pairwise formula
// badly over-counts for non-1:1 compounds; Kapustinskii doesn't have that
// problem since it's parameterized directly by ion count (nu).
const KAPUSTINSKII_K = 1.2025e5; // kJ*pm/mol
const KAPUSTINSKII_D = 34.5; // pm

// Elements whose real lattice energies run well above a pure ionic
// (Kapustinskii/Born-Lande) prediction due to significant covalent
// character in their bonding (well documented for d-block metal halides,
// e.g. AgCl vs NaCl). Modeled here as a flat lattice-energy bonus rather
// than an accurate quantum-mechanical treatment.
const COVALENT_CHARACTER_ELEMENTS: ReadonlySet<ElementSymbol> = new Set(['Fe', 'Cu', 'Zn', 'Ag']);
const COVALENT_LATTICE_BONUS_KJ = 150;

function hasCovalentCharacter(el: Element): boolean {
  return COVALENT_CHARACTER_ELEMENTS.has(el.symbol);
}

/**
 * Lattice energy (kJ/mol) for a whole formula unit, positive = energy
 * required to separate the solid lattice into gaseous ions. `ionCount` is
 * the total number of ions per formula unit (e.g. 2 for NaCl, 3 for CaCl2).
 */
export function bornLandeLatticeEnergy(
  cation: Element,
  cationCharge: number,
  anion: Element,
  anionCharge: number,
  ionCount: number,
): number {
  const r0 = (cation.ionicRadius ?? cation.covalentRadius) + (anion.ionicRadius ?? anion.covalentRadius);
  const kapustinskii =
    (KAPUSTINSKII_K * ionCount * Math.abs(cationCharge) * Math.abs(anionCharge)) / r0 * (1 - KAPUSTINSKII_D / r0);
  const covalentBonus = hasCovalentCharacter(cation) || hasCovalentCharacter(anion) ? COVALENT_LATTICE_BONUS_KJ : 0;
  return kapustinskii + covalentBonus;
}

// Calibrated separately for cations vs anions against Na+ (-405 kJ/mol at
// r=102pm) and Cl- (-364 kJ/mol at r=181pm) -- a single shared constant
// can't fit both well, reflecting a real, well-known cation/anion hydration
// asymmetry that a naive symmetric Born solvation model misses.
const CATION_HYDRATION_CONST = 405 * 102;
const ANION_HYDRATION_CONST = 364 * 181;

/** Born-model single-ion hydration enthalpy (kJ/mol), negative = favorable. */
export function hydrationEnthalpy(ion: Element, charge: number): number {
  if (charge === 0) return 0;
  const r = ion.ionicRadius ?? ion.covalentRadius;
  // Charge sign determines which calibration applies, not isMetal -- a
  // nonmetal can still be the cation side (e.g. H+).
  const constant = charge > 0 ? CATION_HYDRATION_CONST : ANION_HYDRATION_CONST;
  return -(constant * charge * charge) / r;
}

/** deltaG of solution (kJ/mol) from lattice energy, total hydration release, and deltaS (J/mol/K). */
export function dissolutionDeltaG(latticeEnergy: number, hydrationSum: number, deltaSsol: number, T: number): number {
  const deltaHsolution = latticeEnergy + hydrationSum;
  return deltaHsolution - (T * deltaSsol) / 1000;
}

// Typical order of magnitude for the entropy gain of a simple 1:1-ish ionic
// solid dissociating into freely-diffusing aqueous ions.
const DEFAULT_DELTA_S_SOL = 50;

export interface DissolutionResult {
  favorable: boolean;
  deltaH: number;
  deltaG: number;
  products: MoleculeGraph[];
}

/**
 * Attempts to dissolve a solid ionic MoleculeGraph (atoms connected by
 * order=0 "ionic contact" bonds). Not favorable (deltaG >= 0) means the
 * solid stays as-is (e.g. AgCl); favorable means it comes apart into one
 * aqueous-ion MoleculeGraph per atom (e.g. Na+(aq), Cl-(aq)).
 */
export function attemptDissolution(solid: MoleculeGraph, T: number): DissolutionResult {
  const ionicBonds = solid.bonds.filter((b) => b.order === 0);
  if (ionicBonds.length === 0) {
    return { favorable: false, deltaH: Infinity, deltaG: Infinity, products: [] };
  }

  const byId = new Map(solid.atoms.map((a) => [a.id, a]));

  // v1 ionic solids are simple homogeneous binary salts -- representative
  // cation/anion charge and contact distance come from the first ionic
  // bond, and the Kapustinskii ion-count term (not a per-bond sum) carries
  // the stoichiometry dependence.
  const firstBond = ionicBonds[0];
  const bondA = firstBond ? byId.get(firstBond.a) : undefined;
  const bondB = firstBond ? byId.get(firstBond.b) : undefined;
  let latticeEnergy = 0;
  if (bondA && bondB) {
    const cation = bondA.charge > 0 ? bondA : bondB;
    const anion = bondA.charge > 0 ? bondB : bondA;
    latticeEnergy = bornLandeLatticeEnergy(
      getElement(cation.element),
      cation.charge,
      getElement(anion.element),
      anion.charge,
      solid.atoms.length,
    );
  }

  let hydrationSum = 0;
  for (const atom of solid.atoms) {
    hydrationSum += hydrationEnthalpy(getElement(atom.element), atom.charge);
  }

  const deltaH = latticeEnergy + hydrationSum;
  const deltaG = dissolutionDeltaG(latticeEnergy, hydrationSum, DEFAULT_DELTA_S_SOL, T);

  if (deltaG >= 0) {
    return { favorable: false, deltaH, deltaG, products: [] };
  }

  const products: MoleculeGraph[] = solid.atoms.map((atom) => ({
    atoms: [{ id: 0, element: atom.element, charge: atom.charge }],
    bonds: [],
  }));

  return { favorable: true, deltaH, deltaG, products };
}
