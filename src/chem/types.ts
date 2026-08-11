export type ElementSymbol =
  | 'H' | 'C' | 'N' | 'O' | 'Na' | 'Mg' | 'Al' | 'S' | 'Cl' | 'K' | 'Ca' | 'Fe' | 'Cu' | 'Zn' | 'Ag';

export enum Phase {
  Solid = 'solid',
  Liquid = 'liquid',
  Gas = 'gas',
  Aqueous = 'aqueous',
}

export interface Element {
  symbol: ElementSymbol;
  Z: number;
  molarMass: number; // g/mol
  electronegativity: number; // Pauling scale
  covalentRadius: number; // pm
  ionicRadius?: number; // pm, for the element's common ion charge
  standardValences: number[]; // e.g. S: [2, 4, 6]
  commonIonCharges: number[]; // e.g. Na: [1], Fe: [2, 3]
  isMetal: boolean;
  atomizationEnthalpy: number; // kJ/mol, X(standard state) -> X(g)
  pureElementForm: 'monatomic' | 'diatomic' | 'lattice';
}

/** An atom within a MoleculeGraph. `id` is a local index, 0..n-1. */
export interface Atom {
  id: number;
  element: ElementSymbol;
  charge: number; // formal charge, integer
}

/**
 * A bond between two atoms (by local id).
 * order 0 = ionic contact (lattice, not covalent) -- routes to Born-Lande treatment.
 * order 1-3 = covalent single/double/triple.
 */
export interface Bond {
  a: number;
  b: number;
  order: 0 | 1 | 2 | 3;
}

export interface MoleculeGraph {
  atoms: Atom[];
  bonds: Bond[];
}

export interface MoleculeProperties {
  formula: string; // Hill notation, canonical key for overrides
  molarMass: number; // g/mol
  deltaHf: number; // kJ/mol
  standardEntropy: number; // J/mol/K
  dipoleMoment: number; // Debye
  boilingPointC: number;
  meltingPointC: number;
  density: number; // g/cm^3, condensed-phase estimate
  phaseAtSTP: Phase;
  isRadical: boolean;
  netCharge: number;
  color: string; // hex
  source: 'estimated' | 'override';

  // Thermal properties, per-phase since the same species behaves very
  // differently as ice/water/steam. Specific heat in J/(g*K), latent heats
  // in J/g, thermal conductivity in W/(m*K) (used as a relative rate
  // constant by src/sim -- no physical cell size in meters is defined, see
  // src/sim/heat.ts).
  specificHeatSolid: number;
  specificHeatLiquid: number;
  specificHeatGas: number;
  heatOfFusion: number; // J/g, solid -> liquid
  heatOfVaporization: number; // J/g, liquid -> gas
  thermalConductivitySolid: number;
  thermalConductivityLiquid: number;
  thermalConductivityGas: number;
}

export interface MoleculeSpec {
  specId: number;
  graph: MoleculeGraph; // canonicalized
  canonicalKey: string;
  properties: MoleculeProperties;
}

export interface ReactionCandidate {
  products: MoleculeGraph[];
  deltaH: number; // kJ/mol, products - reactants
  deltaS: number; // J/mol/K
  deltaG: number; // kJ/mol, at evaluation T
  bondsBrokenEnthalpy: number; // kJ/mol, sum of BDE of bonds broken
  partitionsConsidered: number;
}

export interface ReactionOutcome {
  candidate: ReactionCandidate | null;
  Ea: number; // kJ/mol
  probability: number; // P = exp(-Ea/RT) at the actual T
  fired?: boolean;
  productSpecIds?: number[];
}
