// Static reaction table -- a hand-authored list of `reactants -> products`
// formulas, checked against every adjacent cell pair each tick (react.ts).
// This replaces the old graph-search/partition-search engine: the only
// products that can ever appear on the grid are the ones listed here, each
// with hand-picked, physically sane deltaH/ignition-threshold/probability,
// so reactions can't wander into estimated-property species and blow up the
// energy/pressure bookkeeping.
import { SpeciesId } from './species-data';

export interface ReactionRule {
  readonly reactants: readonly [number, number];
  readonly products: readonly number[];
  /** kJ/mol, negative = exothermic. Scaled by react.ts against reactant A's
   * own nominal parcel mass, same convention the old engine used. */
  readonly deltaH: number;
  /** Reaction only eligible once avg(T) >= this. Omit for no threshold. */
  readonly minTempK?: number;
  /** Flat per-tick chance of firing once eligible. */
  readonly probability: number;
}

const S = SpeciesId;

export const REACTIONS: readonly ReactionRule[] = [
  { reactants: [S.H2, S.O2], products: [S.H2O], deltaH: -286, minTempK: 500, probability: 0.3 },
  { reactants: [S.C, S.O2], products: [S.CO2], deltaH: -393.5, minTempK: 600, probability: 0.3 },
  { reactants: [S.Na, S.Cl2], products: [S.NaCl], deltaH: -411, probability: 0.5 },
  { reactants: [S.Mg, S.Cl2], products: [S.MgCl2], deltaH: -641, probability: 0.4 },
  { reactants: [S.Ca, S.Cl2], products: [S.CaCl2], deltaH: -796, probability: 0.4 },
  { reactants: [S.K, S.Cl2], products: [S.KCl], deltaH: -436.5, probability: 0.5 },
  { reactants: [S.Fe, S.S], products: [S.FeS], deltaH: -100, probability: 0.2 },
  { reactants: [S.Fe, S.O2], products: [S.Fe2O3], deltaH: -824, minTempK: 400, probability: 0.2 },
  { reactants: [S.Cu, S.O2], products: [S.CuO], deltaH: -157, minTempK: 400, probability: 0.2 },
  { reactants: [S.Zn, S.O2], products: [S.ZnO], deltaH: -350.5, minTempK: 400, probability: 0.2 },
  { reactants: [S.Al, S.O2], products: [S.Al2O3], deltaH: -1676, minTempK: 400, probability: 0.2 },
  { reactants: [S.N2, S.H2], products: [S.NH3], deltaH: -45.9, minTempK: 700, probability: 0.1 },
  { reactants: [S.Na, S.H2O], products: [S.NaOH, S.H2], deltaH: -400, probability: 0.3 },
  { reactants: [S.HCl, S.NaOH], products: [S.NaCl, S.H2O], deltaH: -57, probability: 0.6 },
  { reactants: [S.NaCl, S.H2O], products: [S.NaPlusAq, S.ClMinusAq], deltaH: 4, probability: 0.4 },
  // No AgCl + H2O rule -- deliberately preserves the NaCl-dissolves/AgCl-
  // doesn't calibration point from the old dissolution.ts.
];

export function findReaction(specA: number, specB: number): ReactionRule | undefined {
  for (const rule of REACTIONS) {
    const [a, b] = rule.reactants;
    if ((a === specA && b === specB) || (a === specB && b === specA)) return rule;
  }
  return undefined;
}
