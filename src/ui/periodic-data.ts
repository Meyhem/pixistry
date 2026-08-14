// Static periodic-table data (periods 1-5 in full, Z 1-54, plus the
// period-6 main-group elements needed to give Ba/Pb a cell -- Cs/Ba on the
// left edge and Tl/Pb/Bi/Po/At/Rn on the right, period 6's transition
// metals/lanthanides deliberately left out since nothing in the sim needs
// them) for the periodic-table modal -- hand-authored the same way
// species-data.ts/reactions.ts are: a small fixed table, no derivation.
// Only the 19 elements the sim actually simulates (see PURE_FOR_ELEMENT)
// are clickable; the rest render dimmed as "not simulated" context around
// them.
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
  { z: 55, symbol: 'Cs', name: 'Caesium', group: 1, period: 6, category: 'alkali' },
  { z: 56, symbol: 'Ba', name: 'Barium', group: 2, period: 6, category: 'alkalineEarth' },
  { z: 81, symbol: 'Tl', name: 'Thallium', group: 13, period: 6, category: 'postTransitionMetal' },
  { z: 82, symbol: 'Pb', name: 'Lead', group: 14, period: 6, category: 'postTransitionMetal' },
  { z: 83, symbol: 'Bi', name: 'Bismuth', group: 15, period: 6, category: 'postTransitionMetal' },
  { z: 84, symbol: 'Po', name: 'Polonium', group: 16, period: 6, category: 'metalloid' },
  { z: 85, symbol: 'At', name: 'Astatine', group: 17, period: 6, category: 'halogen' },
  { z: 86, symbol: 'Rn', name: 'Radon', group: 18, period: 6, category: 'nobleGas' },
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
  Br: 'Br2',
  I: 'I2',
  Pb: 'Pb',
  Ba: 'Ba',
};

/** Element symbol -> paint-palette labels of compounds it forms that are
 * directly paintable (species-data.ts's paintable:true), for the modal's
 * "pickable in Pixistry" list. Generated from species-data.ts's SPECIES
 * table (every paintable compound whose formula contains the element) --
 * see the halogen-metal/precipitation/acid-base/hydrolysis/dissolution
 * expansion comment there for what each compound is for. */
export const COMPOUNDS_FOR_ELEMENT: Record<string, readonly string[]> = {
  H: ["H2O", "H2SO4", "HNO3", "HBr", "HI", "KOH", "Ca(OH)2", "Ba(OH)2", "Mg(OH)2", "Cu(OH)2", "Fe(OH)2", "Fe(OH)3", "Al(OH)3", "Zn(OH)2", "NH4Cl", "HCl(aq)", "H2SO4(aq)", "HNO3(aq)", "HBr(aq)", "HI(aq)", "H2CO3(aq)", "H2SO3(aq)", "NaOH(aq)", "KOH(aq)", "Ca(OH)2(aq)", "Ba(OH)2(aq)", "NH3(aq)", "NH4Cl(aq)"],
  N: ["HNO3", "NO", "NO2", "AgNO3", "Pb(NO3)2", "NaNO3", "KNO3", "Ba(NO3)2", "Cu(NO3)2", "Fe(NO3)3", "Ca(NO3)2", "NH4Cl", "HNO3(aq)", "NH3(aq)", "AgNO3(aq)", "Pb(NO3)2(aq)", "NaNO3(aq)", "KNO3(aq)", "Ba(NO3)2(aq)", "Cu(NO3)2(aq)", "Fe(NO3)3(aq)", "Ca(NO3)2(aq)", "NH4Cl(aq)"],
  O: ["H2O", "H2SO4", "HNO3", "KOH", "Ca(OH)2", "Ba(OH)2", "MgO", "CaO", "BaO", "Na2O", "K2O", "PbO", "Ag2O", "SO2", "SO3", "NO", "NO2", "AgNO3", "Pb(NO3)2", "NaNO3", "KNO3", "Ba(NO3)2", "Cu(NO3)2", "Fe(NO3)3", "Ca(NO3)2", "Na2SO4", "K2SO4", "CuSO4", "MgSO4", "ZnSO4", "FeSO4", "BaSO4", "PbSO4", "CaSO4", "Na2CO3", "K2CO3", "CaCO3", "BaCO3", "CuCO3", "Mg(OH)2", "Cu(OH)2", "Fe(OH)2", "Fe(OH)3", "Al(OH)3", "Zn(OH)2", "H2SO4(aq)", "HNO3(aq)", "H2CO3(aq)", "H2SO3(aq)", "NaOH(aq)", "KOH(aq)", "Ca(OH)2(aq)", "Ba(OH)2(aq)", "AgNO3(aq)", "Pb(NO3)2(aq)", "NaNO3(aq)", "KNO3(aq)", "Ba(NO3)2(aq)", "Cu(NO3)2(aq)", "Fe(NO3)3(aq)", "Ca(NO3)2(aq)", "Na2SO4(aq)", "K2SO4(aq)", "CuSO4(aq)", "MgSO4(aq)", "ZnSO4(aq)", "FeSO4(aq)", "Na2CO3(aq)", "K2CO3(aq)"],
  Cl: ["NaCl", "AgCl", "BaCl2", "AlCl3", "FeCl2", "FeCl3", "CuCl2", "ZnCl2", "PbCl2", "NH4Cl", "HCl(aq)", "BaCl2(aq)", "AlCl3(aq)", "FeCl2(aq)", "FeCl3(aq)", "CuCl2(aq)", "ZnCl2(aq)", "NH4Cl(aq)"],
  C: ["Na2CO3", "K2CO3", "CaCO3", "BaCO3", "CuCO3", "H2CO3(aq)", "Na2CO3(aq)", "K2CO3(aq)"],
  Na: ["NaCl", "Na2O", "NaBr", "NaI", "NaNO3", "Na2SO4", "Na2CO3", "NaOH(aq)", "NaBr(aq)", "NaI(aq)", "NaNO3(aq)", "Na2SO4(aq)", "Na2CO3(aq)"],
  Mg: ["MgO", "MgBr2", "MgI2", "MgSO4", "Mg(OH)2", "MgBr2(aq)", "MgI2(aq)", "MgSO4(aq)"],
  Al: ["AlCl3", "AlBr3", "AlI3", "Al(OH)3", "AlCl3(aq)", "AlBr3(aq)", "AlI3(aq)"],
  S: ["H2SO4", "SO2", "SO3", "Na2SO4", "K2SO4", "CuSO4", "MgSO4", "ZnSO4", "FeSO4", "BaSO4", "PbSO4", "CaSO4", "H2SO4(aq)", "H2SO3(aq)", "Na2SO4(aq)", "K2SO4(aq)", "CuSO4(aq)", "MgSO4(aq)", "ZnSO4(aq)", "FeSO4(aq)"],
  K: ["KOH", "K2O", "KBr", "KI", "KNO3", "K2SO4", "K2CO3", "KOH(aq)", "KBr(aq)", "KI(aq)", "KNO3(aq)", "K2SO4(aq)", "K2CO3(aq)"],
  Ca: ["Ca(OH)2", "CaO", "CaBr2", "CaI2", "Ca(NO3)2", "CaSO4", "CaCO3", "Ca(OH)2(aq)", "CaBr2(aq)", "CaI2(aq)", "Ca(NO3)2(aq)"],
  Fe: ["FeCl2", "FeCl3", "FeBr3", "FeI2", "Fe(NO3)3", "FeSO4", "Fe(OH)2", "Fe(OH)3", "FeCl2(aq)", "FeCl3(aq)", "FeBr3(aq)", "FeI2(aq)", "Fe(NO3)3(aq)", "FeSO4(aq)"],
  Cu: ["CuCl2", "CuBr2", "Cu(NO3)2", "CuSO4", "CuCO3", "Cu(OH)2", "CuCl2(aq)", "CuBr2(aq)", "Cu(NO3)2(aq)", "CuSO4(aq)"],
  Zn: ["ZnCl2", "ZnBr2", "ZnI2", "ZnSO4", "Zn(OH)2", "ZnCl2(aq)", "ZnBr2(aq)", "ZnI2(aq)", "ZnSO4(aq)"],
  Ag: ["AgCl", "Ag2O", "AgBr", "AgI", "AgNO3", "AgNO3(aq)"],
  Br: ["HBr", "BaBr2", "AlBr3", "FeBr3", "CuBr2", "ZnBr2", "PbBr2", "AgBr", "NaBr", "KBr", "MgBr2", "CaBr2", "HBr(aq)", "BaBr2(aq)", "AlBr3(aq)", "FeBr3(aq)", "CuBr2(aq)", "ZnBr2(aq)", "NaBr(aq)", "KBr(aq)", "MgBr2(aq)", "CaBr2(aq)"],
  I: ["HI", "BaI2", "AlI3", "FeI2", "ZnI2", "PbI2", "AgI", "NaI", "KI", "MgI2", "CaI2", "HI(aq)", "BaI2(aq)", "AlI3(aq)", "FeI2(aq)", "ZnI2(aq)", "NaI(aq)", "KI(aq)", "MgI2(aq)", "CaI2(aq)"],
  Pb: ["PbO", "PbCl2", "PbBr2", "PbI2", "Pb(NO3)2", "PbSO4", "Pb(NO3)2(aq)"],
  Ba: ["Ba(OH)2", "BaO", "BaCl2", "BaBr2", "BaI2", "Ba(NO3)2", "BaSO4", "BaCO3", "Ba(OH)2(aq)", "BaCl2(aq)", "BaBr2(aq)", "BaI2(aq)", "Ba(NO3)2(aq)"],
};
