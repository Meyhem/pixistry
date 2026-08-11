import type { Element, ElementSymbol } from './types';

// Reference values are rounded literature figures (Pauling EN, empirical/covalent
// radii, standard atomization enthalpies). Precision beyond ~3 sig figs isn't
// meaningful for the estimation formulas built on top of this table.
const TABLE: Element[] = [
  { symbol: 'H', Z: 1, molarMass: 1.008, electronegativity: 2.20, covalentRadius: 31, standardValences: [1], commonIonCharges: [1, -1], isMetal: false, atomizationEnthalpy: 218.0, pureElementForm: 'diatomic' },
  { symbol: 'C', Z: 6, molarMass: 12.011, electronegativity: 2.55, covalentRadius: 76, standardValences: [4], commonIonCharges: [], isMetal: false, atomizationEnthalpy: 717.0, pureElementForm: 'lattice' },
  { symbol: 'N', Z: 7, molarMass: 14.007, electronegativity: 3.04, covalentRadius: 71, standardValences: [3, 5], commonIonCharges: [-3], isMetal: false, atomizationEnthalpy: 472.7, pureElementForm: 'diatomic' },
  { symbol: 'O', Z: 8, molarMass: 15.999, electronegativity: 3.44, covalentRadius: 66, standardValences: [2], commonIonCharges: [-2], isMetal: false, atomizationEnthalpy: 249.2, pureElementForm: 'diatomic' },
  { symbol: 'Na', Z: 11, molarMass: 22.990, electronegativity: 0.93, covalentRadius: 166, ionicRadius: 102, standardValences: [1], commonIonCharges: [1], isMetal: true, atomizationEnthalpy: 107.3, pureElementForm: 'lattice' },
  { symbol: 'Mg', Z: 12, molarMass: 24.305, electronegativity: 1.31, covalentRadius: 141, ionicRadius: 72, standardValences: [2], commonIonCharges: [2], isMetal: true, atomizationEnthalpy: 147.1, pureElementForm: 'lattice' },
  { symbol: 'Al', Z: 13, molarMass: 26.982, electronegativity: 1.61, covalentRadius: 121, ionicRadius: 53.5, standardValences: [3], commonIonCharges: [3], isMetal: true, atomizationEnthalpy: 330.9, pureElementForm: 'lattice' },
  { symbol: 'S', Z: 16, molarMass: 32.06, electronegativity: 2.58, covalentRadius: 105, standardValences: [2, 4, 6], commonIonCharges: [-2], isMetal: false, atomizationEnthalpy: 278.8, pureElementForm: 'lattice' },
  { symbol: 'Cl', Z: 17, molarMass: 35.45, electronegativity: 3.16, covalentRadius: 102, ionicRadius: 181, standardValences: [1], commonIonCharges: [-1], isMetal: false, atomizationEnthalpy: 121.3, pureElementForm: 'diatomic' },
  { symbol: 'K', Z: 19, molarMass: 39.098, electronegativity: 0.82, covalentRadius: 203, ionicRadius: 138, standardValences: [1], commonIonCharges: [1], isMetal: true, atomizationEnthalpy: 89.0, pureElementForm: 'lattice' },
  { symbol: 'Ca', Z: 20, molarMass: 40.078, electronegativity: 1.00, covalentRadius: 176, ionicRadius: 100, standardValences: [2], commonIonCharges: [2], isMetal: true, atomizationEnthalpy: 178.2, pureElementForm: 'lattice' },
  { symbol: 'Fe', Z: 26, molarMass: 55.845, electronegativity: 1.83, covalentRadius: 132, ionicRadius: 78, standardValences: [2, 3], commonIonCharges: [2, 3], isMetal: true, atomizationEnthalpy: 416.3, pureElementForm: 'lattice' },
  { symbol: 'Cu', Z: 29, molarMass: 63.546, electronegativity: 1.90, covalentRadius: 132, ionicRadius: 73, standardValences: [1, 2], commonIonCharges: [1, 2], isMetal: true, atomizationEnthalpy: 337.4, pureElementForm: 'lattice' },
  { symbol: 'Zn', Z: 30, molarMass: 65.38, electronegativity: 1.65, covalentRadius: 122, ionicRadius: 74, standardValences: [2], commonIonCharges: [2], isMetal: true, atomizationEnthalpy: 130.4, pureElementForm: 'lattice' },
  { symbol: 'Ag', Z: 47, molarMass: 107.868, electronegativity: 1.93, covalentRadius: 145, ionicRadius: 115, standardValences: [1], commonIonCharges: [1], isMetal: true, atomizationEnthalpy: 284.9, pureElementForm: 'lattice' },
];

export const ELEMENTS: Readonly<Record<ElementSymbol, Element>> = Object.fromEntries(
  TABLE.map((e) => [e.symbol, e]),
) as Record<ElementSymbol, Element>;

export const ELEMENT_SYMBOLS: readonly ElementSymbol[] = TABLE.map((e) => e.symbol);

export function getElement(symbol: ElementSymbol): Element {
  const el = ELEMENTS[symbol];
  if (!el) throw new Error(`Unknown element symbol: ${symbol}`);
  return el;
}
