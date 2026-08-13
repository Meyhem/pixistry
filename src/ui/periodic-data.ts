// Static periodic-table data (periods 1-5, Z 1-54) for the periodic-table
// modal -- hand-authored the same way species-data.ts/reactions.ts are: a
// small fixed table, no derivation. Only the 15 elements the sim actually
// simulates (see PURE_FOR_ELEMENT) are clickable; the rest render dimmed as
// "not simulated" context around them.
export type ElementCategory =
  | 'alkali'
  | 'alkalineEarth'
  | 'transitionMetal'
  | 'postTransitionMetal'
  | 'metalloid'
  | 'nonmetal'
  | 'halogen'
  | 'nobleGas';

export interface ElementData {
  readonly z: number;
  readonly symbol: string;
  readonly name: string;
  readonly group: number;
  readonly period: number;
  readonly category: ElementCategory;
}

export const CATEGORY_LABEL: Record<ElementCategory, string> = {
  alkali: 'Alkali metal',
  alkalineEarth: 'Alkaline earth metal',
  transitionMetal: 'Transition metal',
  postTransitionMetal: 'Post-transition metal',
  metalloid: 'Metalloid',
  nonmetal: 'Nonmetal',
  halogen: 'Halogen',
  nobleGas: 'Noble gas',
};

/** Hue (degrees) used for both the modal's per-category cell tint and its
 * selected-element detail chip -- kept as a single source so the two always
 * agree. */
export const CATEGORY_HUE: Record<ElementCategory, number> = {
  alkali: 20,
  alkalineEarth: 50,
  transitionMetal: 220,
  postTransitionMetal: 200,
  metalloid: 175,
  nonmetal: 145,
  halogen: 90,
  nobleGas: 280,
};

export const ELEMENTS: readonly ElementData[] = [
  { z: 1, symbol: 'H', name: 'Hydrogen', group: 1, period: 1, category: 'nonmetal' },
  { z: 2, symbol: 'He', name: 'Helium', group: 18, period: 1, category: 'nobleGas' },
  { z: 3, symbol: 'Li', name: 'Lithium', group: 1, period: 2, category: 'alkali' },
  { z: 4, symbol: 'Be', name: 'Beryllium', group: 2, period: 2, category: 'alkalineEarth' },
  { z: 5, symbol: 'B', name: 'Boron', group: 13, period: 2, category: 'metalloid' },
  { z: 6, symbol: 'C', name: 'Carbon', group: 14, period: 2, category: 'nonmetal' },
  { z: 7, symbol: 'N', name: 'Nitrogen', group: 15, period: 2, category: 'nonmetal' },
  { z: 8, symbol: 'O', name: 'Oxygen', group: 16, period: 2, category: 'nonmetal' },
  { z: 9, symbol: 'F', name: 'Fluorine', group: 17, period: 2, category: 'halogen' },
  { z: 10, symbol: 'Ne', name: 'Neon', group: 18, period: 2, category: 'nobleGas' },
  { z: 11, symbol: 'Na', name: 'Sodium', group: 1, period: 3, category: 'alkali' },
  { z: 12, symbol: 'Mg', name: 'Magnesium', group: 2, period: 3, category: 'alkalineEarth' },
  { z: 13, symbol: 'Al', name: 'Aluminium', group: 13, period: 3, category: 'postTransitionMetal' },
  { z: 14, symbol: 'Si', name: 'Silicon', group: 14, period: 3, category: 'metalloid' },
  { z: 15, symbol: 'P', name: 'Phosphorus', group: 15, period: 3, category: 'nonmetal' },
  { z: 16, symbol: 'S', name: 'Sulfur', group: 16, period: 3, category: 'nonmetal' },
  { z: 17, symbol: 'Cl', name: 'Chlorine', group: 17, period: 3, category: 'halogen' },
  { z: 18, symbol: 'Ar', name: 'Argon', group: 18, period: 3, category: 'nobleGas' },
  { z: 19, symbol: 'K', name: 'Potassium', group: 1, period: 4, category: 'alkali' },
  { z: 20, symbol: 'Ca', name: 'Calcium', group: 2, period: 4, category: 'alkalineEarth' },
  { z: 21, symbol: 'Sc', name: 'Scandium', group: 3, period: 4, category: 'transitionMetal' },
  { z: 22, symbol: 'Ti', name: 'Titanium', group: 4, period: 4, category: 'transitionMetal' },
  { z: 23, symbol: 'V', name: 'Vanadium', group: 5, period: 4, category: 'transitionMetal' },
  { z: 24, symbol: 'Cr', name: 'Chromium', group: 6, period: 4, category: 'transitionMetal' },
  { z: 25, symbol: 'Mn', name: 'Manganese', group: 7, period: 4, category: 'transitionMetal' },
  { z: 26, symbol: 'Fe', name: 'Iron', group: 8, period: 4, category: 'transitionMetal' },
  { z: 27, symbol: 'Co', name: 'Cobalt', group: 9, period: 4, category: 'transitionMetal' },
  { z: 28, symbol: 'Ni', name: 'Nickel', group: 10, period: 4, category: 'transitionMetal' },
  { z: 29, symbol: 'Cu', name: 'Copper', group: 11, period: 4, category: 'transitionMetal' },
  { z: 30, symbol: 'Zn', name: 'Zinc', group: 12, period: 4, category: 'transitionMetal' },
  { z: 31, symbol: 'Ga', name: 'Gallium', group: 13, period: 4, category: 'postTransitionMetal' },
  { z: 32, symbol: 'Ge', name: 'Germanium', group: 14, period: 4, category: 'metalloid' },
  { z: 33, symbol: 'As', name: 'Arsenic', group: 15, period: 4, category: 'metalloid' },
  { z: 34, symbol: 'Se', name: 'Selenium', group: 16, period: 4, category: 'nonmetal' },
  { z: 35, symbol: 'Br', name: 'Bromine', group: 17, period: 4, category: 'halogen' },
  { z: 36, symbol: 'Kr', name: 'Krypton', group: 18, period: 4, category: 'nobleGas' },
  { z: 37, symbol: 'Rb', name: 'Rubidium', group: 1, period: 5, category: 'alkali' },
  { z: 38, symbol: 'Sr', name: 'Strontium', group: 2, period: 5, category: 'alkalineEarth' },
  { z: 39, symbol: 'Y', name: 'Yttrium', group: 3, period: 5, category: 'transitionMetal' },
  { z: 40, symbol: 'Zr', name: 'Zirconium', group: 4, period: 5, category: 'transitionMetal' },
  { z: 41, symbol: 'Nb', name: 'Niobium', group: 5, period: 5, category: 'transitionMetal' },
  { z: 42, symbol: 'Mo', name: 'Molybdenum', group: 6, period: 5, category: 'transitionMetal' },
  { z: 43, symbol: 'Tc', name: 'Technetium', group: 7, period: 5, category: 'transitionMetal' },
  { z: 44, symbol: 'Ru', name: 'Ruthenium', group: 8, period: 5, category: 'transitionMetal' },
  { z: 45, symbol: 'Rh', name: 'Rhodium', group: 9, period: 5, category: 'transitionMetal' },
  { z: 46, symbol: 'Pd', name: 'Palladium', group: 10, period: 5, category: 'transitionMetal' },
  { z: 47, symbol: 'Ag', name: 'Silver', group: 11, period: 5, category: 'transitionMetal' },
  { z: 48, symbol: 'Cd', name: 'Cadmium', group: 12, period: 5, category: 'transitionMetal' },
  { z: 49, symbol: 'In', name: 'Indium', group: 13, period: 5, category: 'postTransitionMetal' },
  { z: 50, symbol: 'Sn', name: 'Tin', group: 14, period: 5, category: 'postTransitionMetal' },
  { z: 51, symbol: 'Sb', name: 'Antimony', group: 15, period: 5, category: 'metalloid' },
  { z: 52, symbol: 'Te', name: 'Tellurium', group: 16, period: 5, category: 'metalloid' },
  { z: 53, symbol: 'I', name: 'Iodine', group: 17, period: 5, category: 'halogen' },
  { z: 54, symbol: 'Xe', name: 'Xenon', group: 18, period: 5, category: 'nobleGas' },
];

/** Element symbol -> paint-palette label of its pure/elemental species, for
 * every element the sim actually simulates. Resolved against the live
 * palette (by label, not by re-deriving a specId) so this table never has
 * to know specIds. */
export const PURE_FOR_ELEMENT: Record<string, string> = {
  H: 'H2',
  N: 'N2',
  O: 'O2',
  Cl: 'Cl2',
  C: 'C',
  Na: 'Na',
  Mg: 'Mg',
  Al: 'Al',
  S: 'S',
  K: 'K',
  Ca: 'Ca',
  Fe: 'Fe',
  Cu: 'Cu',
  Zn: 'Zn',
  Ag: 'Ag',
};

/** Element symbol -> paint-palette labels of compounds it forms that are
 * directly paintable (species-data.ts's paintable:true), for the modal's
 * "pickable in Pixistry" list. */
export const COMPOUNDS_FOR_ELEMENT: Record<string, readonly string[]> = {
  H: ['H2O'],
  O: ['H2O'],
  Na: ['NaCl'],
  Cl: ['NaCl', 'AgCl'],
  Ag: ['AgCl'],
};
