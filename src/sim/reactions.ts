// Static reaction table -- a hand-authored list of `reactants -> products`
// formulas, checked against every adjacent cell pair each tick (react.ts).
// This replaces the old graph-search/partition-search engine: the only
// products that can ever appear on the grid are the ones listed here, each
// with hand-picked, physically sane deltaH/ignition-threshold/probability,
// so reactions can't wander into estimated-property species and blow up the
// energy bookkeeping.
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
  // Dissolution collapses reactant cell + water cell into a single aqueous
  // product cell (same "2 reactants -> 1 product, extra cell vanishes"
  // convention as H2+O2->H2O above) rather than splitting into a
  // cation/anion pixel pair -- see NaCl(aq) etc.'s doc comment in
  // species-data.ts.
  { reactants: [S.NaCl, S.H2O], products: [S.NaClAq], deltaH: 4, probability: 0.4 },
  { reactants: [S.KCl, S.H2O], products: [S.KClAq], deltaH: 17, probability: 0.4 },
  { reactants: [S.CaCl2, S.H2O], products: [S.CaCl2Aq], deltaH: -82, probability: 0.4 },
  { reactants: [S.MgCl2, S.H2O], products: [S.MgCl2Aq], deltaH: -155, probability: 0.4 },
  // No AgCl + H2O rule -- deliberately preserves the NaCl-dissolves/AgCl-
  // doesn't calibration point from the old dissolution.ts.

  // ===========================================================================
  // Halogen-metal / precipitation / acid-base / hydrolysis / dissolution
  // expansion. findReaction is keyed by unordered reactant pair and returns
  // the FIRST match -- every pair below appears exactly once across this
  // whole table, checked by reactions.test.ts's invariant suite.
  // ===========================================================================

  // -- A. Halogen-metal synthesis: direct combination, real activity-series
  // asymmetry preserved on purpose (Fe reaches Fe3+ with Cl2/Br2 but only
  // Fe2+ with the weaker oxidizer I2; Cu does NOT get a rule with I2 at all
  // -- real Cu2+ + I- redox gives CuI + I2, not a simple "CuI2", and this
  // sim has no species for that, so the absence encodes the chemistry the
  // same way AgCl's missing dissolution rule does). --
  { reactants: [S.Ba, S.Cl2], products: [S.BaCl2], deltaH: -858, probability: 0.4 },
  { reactants: [S.Al, S.Cl2], products: [S.AlCl3], deltaH: -1291, probability: 0.4 },
  { reactants: [S.Fe, S.Cl2], products: [S.FeCl3], deltaH: -800, probability: 0.35 },
  { reactants: [S.Cu, S.Cl2], products: [S.CuCl2], deltaH: -220, probability: 0.3 },
  { reactants: [S.Zn, S.Cl2], products: [S.ZnCl2], deltaH: -415, probability: 0.4 },
  { reactants: [S.Pb, S.Cl2], products: [S.PbCl2], deltaH: -359, probability: 0.3 },
  { reactants: [S.Ag, S.Cl2], products: [S.AgCl], deltaH: -254, probability: 0.3 },
  { reactants: [S.H2, S.Cl2], products: [S.HCl], deltaH: -184.6, minTempK: 550, probability: 0.3 },

  { reactants: [S.Na, S.Br2], products: [S.NaBr], deltaH: -361, probability: 0.5 },
  { reactants: [S.K, S.Br2], products: [S.KBr], deltaH: -394, probability: 0.5 },
  { reactants: [S.Mg, S.Br2], products: [S.MgBr2], deltaH: -524, probability: 0.4 },
  { reactants: [S.Ca, S.Br2], products: [S.CaBr2], deltaH: -683, probability: 0.4 },
  { reactants: [S.Ba, S.Br2], products: [S.BaBr2], deltaH: -757, probability: 0.4 },
  { reactants: [S.Al, S.Br2], products: [S.AlBr3], deltaH: -1075, probability: 0.35 },
  { reactants: [S.Fe, S.Br2], products: [S.FeBr3], deltaH: -670, probability: 0.3 },
  { reactants: [S.Cu, S.Br2], products: [S.CuBr2], deltaH: -142, probability: 0.25 },
  { reactants: [S.Zn, S.Br2], products: [S.ZnBr2], deltaH: -390, probability: 0.35 },
  { reactants: [S.Ag, S.Br2], products: [S.AgBr], deltaH: -100, probability: 0.3 },
  { reactants: [S.Pb, S.Br2], products: [S.PbBr2], deltaH: -278, probability: 0.25 },
  { reactants: [S.H2, S.Br2], products: [S.HBr], deltaH: -72.8, minTempK: 600, probability: 0.2 },

  { reactants: [S.Na, S.I2], products: [S.NaI], deltaH: -288, probability: 0.4 },
  { reactants: [S.K, S.I2], products: [S.KI], deltaH: -328, probability: 0.4 },
  { reactants: [S.Mg, S.I2], products: [S.MgI2], deltaH: -364, probability: 0.3 },
  { reactants: [S.Ca, S.I2], products: [S.CaI2], deltaH: -535, probability: 0.3 },
  { reactants: [S.Ba, S.I2], products: [S.BaI2], deltaH: -605, probability: 0.3 },
  { reactants: [S.Al, S.I2], products: [S.AlI3], deltaH: -627, probability: 0.25 },
  { reactants: [S.Fe, S.I2], products: [S.FeI2], deltaH: -113, probability: 0.2 },
  { reactants: [S.Zn, S.I2], products: [S.ZnI2], deltaH: -209, probability: 0.25 },
  { reactants: [S.Ag, S.I2], products: [S.AgI], deltaH: -62, probability: 0.25 },
  { reactants: [S.Pb, S.I2], products: [S.PbI2], deltaH: -175, probability: 0.2 },
  // Real I2 + H2 is famously reversible/near-equilibrium, unlike Cl2/Br2's
  // near-complete combination -- tiny probability, near-zero deltaH.
  { reactants: [S.H2, S.I2], products: [S.HI], deltaH: -9, minTempK: 650, probability: 0.05 },

  // -- B. Halogen displacement: a more reactive halogen (higher on the
  // group) displaces a less reactive halide from aqueous solution.
  // Deliberately one-directional -- no reverse rule, same trick as AgCl's
  // absence encoding insolubility. --
  { reactants: [S.Cl2, S.NaBrAq], products: [S.NaClAq, S.Br2], deltaH: -55, probability: 0.4 },
  { reactants: [S.Cl2, S.KBrAq], products: [S.KClAq, S.Br2], deltaH: -55, probability: 0.4 },
  { reactants: [S.Cl2, S.CaBr2Aq], products: [S.CaCl2Aq, S.Br2], deltaH: -55, probability: 0.4 },
  { reactants: [S.Cl2, S.MgBr2Aq], products: [S.MgCl2Aq, S.Br2], deltaH: -55, probability: 0.4 },
  { reactants: [S.Cl2, S.NaIAq], products: [S.NaClAq, S.I2], deltaH: -105, probability: 0.5 },
  { reactants: [S.Cl2, S.KIAq], products: [S.KClAq, S.I2], deltaH: -105, probability: 0.5 },
  { reactants: [S.Br2, S.NaIAq], products: [S.NaBrAq, S.I2], deltaH: -50, probability: 0.4 },
  { reactants: [S.Br2, S.KIAq], products: [S.KBrAq, S.I2], deltaH: -50, probability: 0.4 },

  // -- C. Acid-base: neutralization, oxide + acid, carbonate + acid (fizzes
  // CO2 -- a 3-product rule), and active-metal + acid -> H2. Cu/Ag/Pb sit
  // below H2 in the reactivity series and deliberately get no HCl(aq)/
  // H2SO4(aq) rule; the one exception is Cu + HNO3(aq), since concentrated
  // nitric acid is an oxidizing acid that dissolves copper by a different
  // mechanism (brown NO2 fumes) even though dilute HCl/H2SO4 can't touch it. --
  { reactants: [S.HClAq, S.NaOHAq], products: [S.NaClAq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HClAq, S.KOHAq], products: [S.KClAq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HClAq, S.CaOH2Aq], products: [S.CaCl2Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HClAq, S.BaOH2Aq], products: [S.BaCl2Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.H2SO4Aq, S.NaOHAq], products: [S.Na2SO4Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.H2SO4Aq, S.KOHAq], products: [S.K2SO4Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  // Sulfuric acid + limewater/baryta water precipitates the sulfate --
  // CaSO4/BaSO4 are the insoluble ones (see dissolution section below).
  { reactants: [S.H2SO4Aq, S.CaOH2Aq], products: [S.CaSO4, S.H2O], deltaH: -60, probability: 0.6 },
  { reactants: [S.H2SO4Aq, S.BaOH2Aq], products: [S.BaSO4, S.H2O], deltaH: -60, probability: 0.6 },
  { reactants: [S.HNO3Aq, S.NaOHAq], products: [S.NaNO3Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HNO3Aq, S.KOHAq], products: [S.KNO3Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HNO3Aq, S.CaOH2Aq], products: [S.CaNO32Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HNO3Aq, S.BaOH2Aq], products: [S.BaNO32Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  // HBr(aq)/HI(aq) are strong acids too, so they neutralize at the same
  // -57.3 kJ/mol as HCl/HNO3/H2SO4 -- that value is the heat of
  // neutralization of H+ with OH-, which is the only bond-making step for
  // any fully-ionized acid, so it doesn't vary by which acid supplied it.
  { reactants: [S.HBrAq, S.NaOHAq], products: [S.NaBrAq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HIAq, S.NaOHAq], products: [S.NaIAq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HBrAq, S.KOHAq], products: [S.KBrAq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HIAq, S.KOHAq], products: [S.KIAq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HBrAq, S.CaOH2Aq], products: [S.CaBr2Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HIAq, S.CaOH2Aq], products: [S.CaI2Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HBrAq, S.BaOH2Aq], products: [S.BaBr2Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  { reactants: [S.HIAq, S.BaOH2Aq], products: [S.BaI2Aq, S.H2O], deltaH: -57.3, probability: 0.6 },
  // Carbonic acid is the table's one weak acid: barely ionized, so it
  // neutralizes far less exothermically and far more slowly than the strong
  // acids above. With limewater/baryta water it's the same milky carbonate
  // the CO2 rule below produces, just reached from dissolved CO2 instead.
  { reactants: [S.H2CO3Aq, S.NaOHAq], products: [S.Na2CO3Aq, S.H2O], deltaH: -12, probability: 0.25 },
  { reactants: [S.H2CO3Aq, S.KOHAq], products: [S.K2CO3Aq, S.H2O], deltaH: -12, probability: 0.25 },
  { reactants: [S.H2CO3Aq, S.CaOH2Aq], products: [S.CaCO3, S.H2O], deltaH: -12, probability: 0.25 },
  { reactants: [S.H2CO3Aq, S.BaOH2Aq], products: [S.BaCO3, S.H2O], deltaH: -12, probability: 0.25 },
  // Ammonia is a base without a hydroxide: it takes the acid's proton
  // directly onto N, so unlike every neutralization above this makes no
  // water -- the single product means react.ts clears the second reactant
  // cell. Only the chloride exists as a species, so it's the only pairing.
  { reactants: [S.HClAq, S.NH3Aq], products: [S.NH4ClAq], deltaH: -52, probability: 0.6 },
  // The classic "white smoke" demo -- two gases combining directly into a
  // solid smoke/salt, no water involved at all.
  { reactants: [S.NH3, S.HCl], products: [S.NH4Cl], deltaH: -176, probability: 0.5 },

  // Solid hydroxide + acid. The soluble four (NaOH/KOH/Ca(OH)2/Ba(OH)2)
  // could also reach this via their dissolution rules, but the six
  // precipitate hydroxides below have no aqueous form by design, so a
  // direct solid rule is the *only* way anything consumes them -- without
  // it Zn(OH)2 and friends were write-only, produced by precipitation and
  // then inert forever. deltaH is held constant per hydroxide across the
  // strong acids (same reasoning as the -57.3 above) and is larger in
  // magnitude than the aqueous case because it also pays out the solid's
  // lattice energy.
  { reactants: [S.HClAq, S.NaOH], products: [S.NaClAq, S.H2O], deltaH: -100, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.NaOH], products: [S.Na2SO4Aq, S.H2O], deltaH: -100, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.NaOH], products: [S.NaNO3Aq, S.H2O], deltaH: -100, probability: 0.5 },
  { reactants: [S.HBrAq, S.NaOH], products: [S.NaBrAq, S.H2O], deltaH: -100, probability: 0.5 },
  { reactants: [S.HIAq, S.NaOH], products: [S.NaIAq, S.H2O], deltaH: -100, probability: 0.5 },
  { reactants: [S.H2CO3Aq, S.NaOH], products: [S.Na2CO3Aq, S.H2O], deltaH: -55, probability: 0.25 },
  { reactants: [S.HClAq, S.KOH], products: [S.KClAq, S.H2O], deltaH: -115, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.KOH], products: [S.K2SO4Aq, S.H2O], deltaH: -115, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.KOH], products: [S.KNO3Aq, S.H2O], deltaH: -115, probability: 0.5 },
  { reactants: [S.HBrAq, S.KOH], products: [S.KBrAq, S.H2O], deltaH: -115, probability: 0.5 },
  { reactants: [S.HIAq, S.KOH], products: [S.KIAq, S.H2O], deltaH: -115, probability: 0.5 },
  { reactants: [S.H2CO3Aq, S.KOH], products: [S.K2CO3Aq, S.H2O], deltaH: -70, probability: 0.25 },
  { reactants: [S.HClAq, S.CaOH2], products: [S.CaCl2Aq, S.H2O], deltaH: -75, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.CaOH2], products: [S.CaSO4, S.H2O], deltaH: -75, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.CaOH2], products: [S.CaNO32Aq, S.H2O], deltaH: -75, probability: 0.5 },
  { reactants: [S.HBrAq, S.CaOH2], products: [S.CaBr2Aq, S.H2O], deltaH: -75, probability: 0.5 },
  { reactants: [S.HIAq, S.CaOH2], products: [S.CaI2Aq, S.H2O], deltaH: -75, probability: 0.5 },
  { reactants: [S.H2CO3Aq, S.CaOH2], products: [S.CaCO3, S.H2O], deltaH: -30, probability: 0.25 },
  { reactants: [S.HClAq, S.BaOH2], products: [S.BaCl2Aq, S.H2O], deltaH: -110, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.BaOH2], products: [S.BaSO4, S.H2O], deltaH: -110, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.BaOH2], products: [S.BaNO32Aq, S.H2O], deltaH: -110, probability: 0.5 },
  { reactants: [S.HBrAq, S.BaOH2], products: [S.BaBr2Aq, S.H2O], deltaH: -110, probability: 0.5 },
  { reactants: [S.HIAq, S.BaOH2], products: [S.BaI2Aq, S.H2O], deltaH: -110, probability: 0.5 },
  { reactants: [S.H2CO3Aq, S.BaOH2], products: [S.BaCO3, S.H2O], deltaH: -65, probability: 0.25 },
  // The precipitate hydroxides. Gaps here are product gaps, not chemistry
  // gaps: Mg/Zn/Al/Fe(II) nitrates and Al/Fe(III) sulfates simply aren't
  // species yet, so those pairings stay inert until they are.
  { reactants: [S.HClAq, S.MgOH2], products: [S.MgCl2Aq, S.H2O], deltaH: -95, probability: 0.45 },
  { reactants: [S.H2SO4Aq, S.MgOH2], products: [S.MgSO4Aq, S.H2O], deltaH: -95, probability: 0.45 },
  { reactants: [S.HBrAq, S.MgOH2], products: [S.MgBr2Aq, S.H2O], deltaH: -95, probability: 0.45 },
  { reactants: [S.HIAq, S.MgOH2], products: [S.MgI2Aq, S.H2O], deltaH: -95, probability: 0.45 },
  { reactants: [S.HClAq, S.CuOH2], products: [S.CuCl2Aq, S.H2O], deltaH: -65, probability: 0.45 },
  { reactants: [S.H2SO4Aq, S.CuOH2], products: [S.CuSO4Aq, S.H2O], deltaH: -65, probability: 0.45 },
  { reactants: [S.HNO3Aq, S.CuOH2], products: [S.CuNO32Aq, S.H2O], deltaH: -65, probability: 0.45 },
  { reactants: [S.HBrAq, S.CuOH2], products: [S.CuBr2Aq, S.H2O], deltaH: -65, probability: 0.45 },
  { reactants: [S.H2CO3Aq, S.CuOH2], products: [S.CuCO3, S.H2O], deltaH: -20, probability: 0.25 },
  { reactants: [S.HClAq, S.FeOH2], products: [S.FeCl2Aq, S.H2O], deltaH: -70, probability: 0.45 },
  { reactants: [S.H2SO4Aq, S.FeOH2], products: [S.FeSO4Aq, S.H2O], deltaH: -70, probability: 0.45 },
  { reactants: [S.HIAq, S.FeOH2], products: [S.FeI2Aq, S.H2O], deltaH: -70, probability: 0.45 },
  { reactants: [S.HClAq, S.FeOH3], products: [S.FeCl3Aq, S.H2O], deltaH: -55, probability: 0.4 },
  { reactants: [S.HNO3Aq, S.FeOH3], products: [S.FeNO33Aq, S.H2O], deltaH: -55, probability: 0.4 },
  { reactants: [S.HBrAq, S.FeOH3], products: [S.FeBr3Aq, S.H2O], deltaH: -55, probability: 0.4 },
  { reactants: [S.HClAq, S.AlOH3], products: [S.AlCl3Aq, S.H2O], deltaH: -70, probability: 0.4 },
  { reactants: [S.HBrAq, S.AlOH3], products: [S.AlBr3Aq, S.H2O], deltaH: -70, probability: 0.4 },
  { reactants: [S.HIAq, S.AlOH3], products: [S.AlI3Aq, S.H2O], deltaH: -70, probability: 0.4 },
  { reactants: [S.HClAq, S.ZnOH2], products: [S.ZnCl2Aq, S.H2O], deltaH: -75, probability: 0.45 },
  { reactants: [S.H2SO4Aq, S.ZnOH2], products: [S.ZnSO4Aq, S.H2O], deltaH: -75, probability: 0.45 },
  { reactants: [S.HBrAq, S.ZnOH2], products: [S.ZnBr2Aq, S.H2O], deltaH: -75, probability: 0.45 },
  { reactants: [S.HIAq, S.ZnOH2], products: [S.ZnI2Aq, S.H2O], deltaH: -75, probability: 0.45 },

  { reactants: [S.HClAq, S.MgO], products: [S.MgCl2Aq, S.H2O], deltaH: -150, probability: 0.5 },
  { reactants: [S.HClAq, S.CaO], products: [S.CaCl2Aq, S.H2O], deltaH: -186, probability: 0.5 },
  { reactants: [S.HClAq, S.CuO], products: [S.CuCl2Aq, S.H2O], deltaH: -85, probability: 0.5 },
  { reactants: [S.HClAq, S.ZnO], products: [S.ZnCl2Aq, S.H2O], deltaH: -142, probability: 0.5 },
  { reactants: [S.HClAq, S.Fe2O3], products: [S.FeCl3Aq, S.H2O], deltaH: -130, probability: 0.4 },
  { reactants: [S.H2SO4Aq, S.CuO], products: [S.CuSO4Aq, S.H2O], deltaH: -85, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.ZnO], products: [S.ZnSO4Aq, S.H2O], deltaH: -142, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.MgO], products: [S.MgSO4Aq, S.H2O], deltaH: -150, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.CuO], products: [S.CuNO32Aq, S.H2O], deltaH: -85, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.Ag2O], products: [S.AgNO3Aq, S.H2O], deltaH: -60, probability: 0.5 },
  { reactants: [S.HBrAq, S.MgO], products: [S.MgBr2Aq, S.H2O], deltaH: -150, probability: 0.5 },
  { reactants: [S.HIAq, S.MgO], products: [S.MgI2Aq, S.H2O], deltaH: -150, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.CaO], products: [S.CaSO4, S.H2O], deltaH: -186, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.CaO], products: [S.CaNO32Aq, S.H2O], deltaH: -186, probability: 0.5 },
  { reactants: [S.HBrAq, S.CaO], products: [S.CaBr2Aq, S.H2O], deltaH: -186, probability: 0.5 },
  { reactants: [S.HIAq, S.CaO], products: [S.CaI2Aq, S.H2O], deltaH: -186, probability: 0.5 },
  { reactants: [S.HClAq, S.BaO], products: [S.BaCl2Aq, S.H2O], deltaH: -190, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.BaO], products: [S.BaSO4, S.H2O], deltaH: -190, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.BaO], products: [S.BaNO32Aq, S.H2O], deltaH: -190, probability: 0.5 },
  { reactants: [S.HBrAq, S.BaO], products: [S.BaBr2Aq, S.H2O], deltaH: -190, probability: 0.5 },
  { reactants: [S.HIAq, S.BaO], products: [S.BaI2Aq, S.H2O], deltaH: -190, probability: 0.5 },
  // The alkali-metal oxides are the most violent of the set -- they'd react
  // with the water in the acid even if the acid weren't there (see the
  // Na2O/K2O hydrolysis rules below), so the acid rule releases both.
  { reactants: [S.HClAq, S.Na2O], products: [S.NaClAq, S.H2O], deltaH: -230, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.Na2O], products: [S.Na2SO4Aq, S.H2O], deltaH: -230, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.Na2O], products: [S.NaNO3Aq, S.H2O], deltaH: -230, probability: 0.5 },
  { reactants: [S.HBrAq, S.Na2O], products: [S.NaBrAq, S.H2O], deltaH: -230, probability: 0.5 },
  { reactants: [S.HIAq, S.Na2O], products: [S.NaIAq, S.H2O], deltaH: -230, probability: 0.5 },
  { reactants: [S.HClAq, S.K2O], products: [S.KClAq, S.H2O], deltaH: -215, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.K2O], products: [S.K2SO4Aq, S.H2O], deltaH: -215, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.K2O], products: [S.KNO3Aq, S.H2O], deltaH: -215, probability: 0.5 },
  { reactants: [S.HBrAq, S.K2O], products: [S.KBrAq, S.H2O], deltaH: -215, probability: 0.5 },
  { reactants: [S.HIAq, S.K2O], products: [S.KIAq, S.H2O], deltaH: -215, probability: 0.5 },
  // PbO and Ag2O mostly make their own insoluble salt back, so these read
  // as "the oxide turns into a precipitate" rather than "it dissolves" --
  // Pb(NO3)2 and AgNO3 are the only soluble products either one has.
  { reactants: [S.HClAq, S.PbO], products: [S.PbCl2, S.H2O], deltaH: -65, probability: 0.4 },
  { reactants: [S.H2SO4Aq, S.PbO], products: [S.PbSO4, S.H2O], deltaH: -65, probability: 0.4 },
  { reactants: [S.HNO3Aq, S.PbO], products: [S.PbNO32Aq, S.H2O], deltaH: -65, probability: 0.4 },
  { reactants: [S.HBrAq, S.PbO], products: [S.PbBr2, S.H2O], deltaH: -65, probability: 0.4 },
  { reactants: [S.HIAq, S.PbO], products: [S.PbI2, S.H2O], deltaH: -65, probability: 0.4 },
  { reactants: [S.HClAq, S.Ag2O], products: [S.AgCl, S.H2O], deltaH: -60, probability: 0.5 },
  { reactants: [S.HBrAq, S.Ag2O], products: [S.AgBr, S.H2O], deltaH: -60, probability: 0.5 },
  { reactants: [S.HIAq, S.Ag2O], products: [S.AgI, S.H2O], deltaH: -60, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.Fe2O3], products: [S.FeNO33Aq, S.H2O], deltaH: -130, probability: 0.4 },
  { reactants: [S.HBrAq, S.Fe2O3], products: [S.FeBr3Aq, S.H2O], deltaH: -130, probability: 0.4 },
  // Al2O3 is the stubborn one -- the passivating layer that makes aluminium
  // look unreactive. It needs hot acid, hence the only minTempK in this
  // section, and even then it goes slowly.
  { reactants: [S.HClAq, S.Al2O3], products: [S.AlCl3Aq, S.H2O], deltaH: -80, minTempK: 350, probability: 0.2 },
  { reactants: [S.HBrAq, S.Al2O3], products: [S.AlBr3Aq, S.H2O], deltaH: -80, minTempK: 350, probability: 0.2 },
  { reactants: [S.HIAq, S.Al2O3], products: [S.AlI3Aq, S.H2O], deltaH: -80, minTempK: 350, probability: 0.2 },
  { reactants: [S.HBrAq, S.CuO], products: [S.CuBr2Aq, S.H2O], deltaH: -85, probability: 0.5 },
  { reactants: [S.HBrAq, S.ZnO], products: [S.ZnBr2Aq, S.H2O], deltaH: -142, probability: 0.5 },
  { reactants: [S.HIAq, S.ZnO], products: [S.ZnI2Aq, S.H2O], deltaH: -142, probability: 0.5 },
  // Carbonic acid on a basic oxide goes straight to the carbonate -- this
  // is what weathers limestone statues and patinas copper roofs.
  { reactants: [S.H2CO3Aq, S.CaO], products: [S.CaCO3, S.H2O], deltaH: -140, probability: 0.25 },
  { reactants: [S.H2CO3Aq, S.BaO], products: [S.BaCO3, S.H2O], deltaH: -145, probability: 0.25 },
  { reactants: [S.H2CO3Aq, S.Na2O], products: [S.Na2CO3Aq, S.H2O], deltaH: -185, probability: 0.25 },
  { reactants: [S.H2CO3Aq, S.K2O], products: [S.K2CO3Aq, S.H2O], deltaH: -170, probability: 0.25 },
  { reactants: [S.H2CO3Aq, S.CuO], products: [S.CuCO3, S.H2O], deltaH: -40, probability: 0.25 },

  { reactants: [S.HClAq, S.CaCO3], products: [S.CaCl2Aq, S.H2O, S.CO2], deltaH: -17, probability: 0.5 },
  { reactants: [S.HClAq, S.Na2CO3], products: [S.NaClAq, S.H2O, S.CO2], deltaH: -33, probability: 0.5 },
  { reactants: [S.HClAq, S.CuCO3], products: [S.CuCl2Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.Na2CO3], products: [S.Na2SO4Aq, S.H2O, S.CO2], deltaH: -33, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.CaCO3], products: [S.CaNO32Aq, S.H2O, S.CO2], deltaH: -17, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.Na2CO3], products: [S.NaNO3Aq, S.H2O, S.CO2], deltaH: -33, probability: 0.5 },
  { reactants: [S.HBrAq, S.Na2CO3], products: [S.NaBrAq, S.H2O, S.CO2], deltaH: -33, probability: 0.5 },
  { reactants: [S.HIAq, S.Na2CO3], products: [S.NaIAq, S.H2O, S.CO2], deltaH: -33, probability: 0.5 },
  { reactants: [S.HClAq, S.K2CO3], products: [S.KClAq, S.H2O, S.CO2], deltaH: -35, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.K2CO3], products: [S.K2SO4Aq, S.H2O, S.CO2], deltaH: -35, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.K2CO3], products: [S.KNO3Aq, S.H2O, S.CO2], deltaH: -35, probability: 0.5 },
  { reactants: [S.HBrAq, S.K2CO3], products: [S.KBrAq, S.H2O, S.CO2], deltaH: -35, probability: 0.5 },
  { reactants: [S.HIAq, S.K2CO3], products: [S.KIAq, S.H2O, S.CO2], deltaH: -35, probability: 0.5 },
  { reactants: [S.HBrAq, S.CaCO3], products: [S.CaBr2Aq, S.H2O, S.CO2], deltaH: -17, probability: 0.5 },
  { reactants: [S.HIAq, S.CaCO3], products: [S.CaI2Aq, S.H2O, S.CO2], deltaH: -17, probability: 0.5 },
  { reactants: [S.HClAq, S.BaCO3], products: [S.BaCl2Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.BaCO3], products: [S.BaNO32Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  { reactants: [S.HBrAq, S.BaCO3], products: [S.BaBr2Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  { reactants: [S.HIAq, S.BaCO3], products: [S.BaI2Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.CuCO3], products: [S.CuSO4Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  { reactants: [S.HNO3Aq, S.CuCO3], products: [S.CuNO32Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  { reactants: [S.HBrAq, S.CuCO3], products: [S.CuBr2Aq, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },
  // Sulfuric acid on a carbonate whose sulfate is insoluble self-limits in
  // reality (the CaSO4/BaSO4 crust seals the solid off); the sim has no
  // surface-passivation model, so these just run to completion.
  { reactants: [S.H2SO4Aq, S.CaCO3], products: [S.CaSO4, S.H2O, S.CO2], deltaH: -17, probability: 0.5 },
  { reactants: [S.H2SO4Aq, S.BaCO3], products: [S.BaSO4, S.H2O, S.CO2], deltaH: -20, probability: 0.5 },

  { reactants: [S.HClAq, S.Mg], products: [S.MgCl2Aq, S.H2], deltaH: -462, probability: 0.35 },
  { reactants: [S.HClAq, S.Zn], products: [S.ZnCl2Aq, S.H2], deltaH: -153, probability: 0.3 },
  { reactants: [S.HClAq, S.Fe], products: [S.FeCl2Aq, S.H2], deltaH: -88, probability: 0.25 },
  { reactants: [S.HClAq, S.Al], products: [S.AlCl3Aq, S.H2], deltaH: -531, probability: 0.3 },
  { reactants: [S.HClAq, S.Ca], products: [S.CaCl2Aq, S.H2], deltaH: -543, probability: 0.4 },
  { reactants: [S.H2SO4Aq, S.Mg], products: [S.MgSO4Aq, S.H2], deltaH: -462, probability: 0.35 },
  { reactants: [S.H2SO4Aq, S.Zn], products: [S.ZnSO4Aq, S.H2], deltaH: -153, probability: 0.3 },
  { reactants: [S.H2SO4Aq, S.Fe], products: [S.FeSO4Aq, S.H2], deltaH: -88, probability: 0.25 },
  { reactants: [S.HBrAq, S.Mg], products: [S.MgBr2Aq, S.H2], deltaH: -462, probability: 0.35 },
  { reactants: [S.HIAq, S.Mg], products: [S.MgI2Aq, S.H2], deltaH: -462, probability: 0.35 },
  { reactants: [S.HBrAq, S.Zn], products: [S.ZnBr2Aq, S.H2], deltaH: -153, probability: 0.3 },
  { reactants: [S.HIAq, S.Zn], products: [S.ZnI2Aq, S.H2], deltaH: -153, probability: 0.3 },
  { reactants: [S.HBrAq, S.Al], products: [S.AlBr3Aq, S.H2], deltaH: -531, probability: 0.3 },
  { reactants: [S.HIAq, S.Al], products: [S.AlI3Aq, S.H2], deltaH: -531, probability: 0.3 },
  { reactants: [S.HBrAq, S.Ca], products: [S.CaBr2Aq, S.H2], deltaH: -543, probability: 0.4 },
  { reactants: [S.HIAq, S.Ca], products: [S.CaI2Aq, S.H2], deltaH: -543, probability: 0.4 },
  { reactants: [S.HNO3Aq, S.Ca], products: [S.CaNO32Aq, S.H2], deltaH: -543, probability: 0.4 },
  { reactants: [S.H2SO4Aq, S.Ca], products: [S.CaSO4, S.H2], deltaH: -543, probability: 0.4 },
  // Iron dissolves to Fe(II), never Fe(III) -- the Fe(III) salts are only
  // reachable by oxidizing the metal first (Fe2O3) or via Fe(OH)3.
  { reactants: [S.HIAq, S.Fe], products: [S.FeI2Aq, S.H2], deltaH: -88, probability: 0.25 },
  // Copper dissolving in nitric acid -- the classic brown-fumes demo,
  // reachable only via the oxidizing acid (no HCl(aq)/H2SO4(aq) rule for
  // Cu exists above, matching its real place in the activity series).
  { reactants: [S.HNO3Aq, S.Cu], products: [S.CuNO32Aq, S.NO2, S.H2O], deltaH: -110, probability: 0.25 },

  // -- D. Hydrolysis / hydration --
  { reactants: [S.CaO, S.H2O], products: [S.CaOH2Aq], deltaH: -63.7, probability: 0.5 },
  { reactants: [S.BaO, S.H2O], products: [S.BaOH2Aq], deltaH: -100, probability: 0.5 },
  { reactants: [S.MgO, S.H2O], products: [S.MgOH2], deltaH: -37, probability: 0.3 },
  { reactants: [S.Na2O, S.H2O], products: [S.NaOHAq], deltaH: -146, probability: 0.5 },
  { reactants: [S.K2O, S.H2O], products: [S.KOHAq], deltaH: -134, probability: 0.5 },
  // Contact-process step -- strongly exothermic, the "never add water to
  // concentrated acid" demo.
  { reactants: [S.SO3, S.H2O], products: [S.H2SO4Aq], deltaH: -130, probability: 0.4 },
  { reactants: [S.SO2, S.H2O], products: [S.H2SO3Aq], deltaH: -9, probability: 0.3 },
  { reactants: [S.CO2, S.H2O], products: [S.H2CO3Aq], deltaH: -20, probability: 0.2 },
  { reactants: [S.NO2, S.H2O], products: [S.HNO3Aq, S.NO], deltaH: -117, probability: 0.3 },
  { reactants: [S.HCl, S.H2O], products: [S.HClAq], deltaH: -75, probability: 0.4 },
  { reactants: [S.H2SO4, S.H2O], products: [S.H2SO4Aq], deltaH: -88, probability: 0.4 },
  { reactants: [S.HNO3, S.H2O], products: [S.HNO3Aq], deltaH: -33, probability: 0.4 },
  { reactants: [S.HBr, S.H2O], products: [S.HBrAq], deltaH: -85, probability: 0.4 },
  { reactants: [S.HI, S.H2O], products: [S.HIAq], deltaH: -81, probability: 0.4 },
  { reactants: [S.NH3, S.H2O], products: [S.NH3Aq], deltaH: -30, probability: 0.4 },

  // -- E. Precipitation: aqueous + aqueous -> insoluble solid + aqueous
  // byproduct. AgNO3(aq)/Pb(NO3)2(aq)/BaCl2(aq) etc. are the standard
  // "soluble cation source" reagents; every insoluble product below has no
  // dissolution rule in section F, which is what keeps it a precipitate. --
  { reactants: [S.AgNO3Aq, S.NaClAq], products: [S.AgCl, S.NaNO3Aq], deltaH: -65, probability: 0.7 },
  { reactants: [S.AgNO3Aq, S.KBrAq], products: [S.AgBr, S.KNO3Aq], deltaH: -84, probability: 0.7 },
  { reactants: [S.AgNO3Aq, S.KIAq], products: [S.AgI, S.KNO3Aq], deltaH: -111, probability: 0.7 },
  { reactants: [S.PbNO32Aq, S.KIAq], products: [S.PbI2, S.KNO3Aq], deltaH: -47, probability: 0.7 },
  { reactants: [S.PbNO32Aq, S.NaClAq], products: [S.PbCl2, S.NaNO3Aq], deltaH: -30, probability: 0.6 },
  { reactants: [S.PbNO32Aq, S.Na2SO4Aq], products: [S.PbSO4, S.NaNO3Aq], deltaH: -97, probability: 0.7 },
  { reactants: [S.BaCl2Aq, S.Na2SO4Aq], products: [S.BaSO4, S.NaClAq], deltaH: -18, probability: 0.7 },
  { reactants: [S.BaCl2Aq, S.Na2CO3Aq], products: [S.BaCO3, S.NaClAq], deltaH: -15, probability: 0.7 },
  { reactants: [S.BaNO32Aq, S.K2SO4Aq], products: [S.BaSO4, S.KNO3Aq], deltaH: -18, probability: 0.7 },
  { reactants: [S.CaCl2Aq, S.Na2CO3Aq], products: [S.CaCO3, S.NaClAq], deltaH: -13, probability: 0.6 },
  // Limewater test: CO2 gas bubbled through Ca(OH)2(aq) turns it milky.
  { reactants: [S.CaOH2Aq, S.CO2], products: [S.CaCO3, S.H2O], deltaH: -113, probability: 0.6 },
  { reactants: [S.CuSO4Aq, S.NaOHAq], products: [S.CuOH2, S.Na2SO4Aq], deltaH: -50, probability: 0.6 },
  { reactants: [S.FeCl3Aq, S.NaOHAq], products: [S.FeOH3, S.NaClAq], deltaH: -55, probability: 0.6 },
  { reactants: [S.FeSO4Aq, S.NaOHAq], products: [S.FeOH2, S.Na2SO4Aq], deltaH: -45, probability: 0.6 },
  { reactants: [S.MgCl2Aq, S.NaOHAq], products: [S.MgOH2, S.NaClAq], deltaH: -37, probability: 0.6 },
  { reactants: [S.ZnSO4Aq, S.NaOHAq], products: [S.ZnOH2, S.Na2SO4Aq], deltaH: -40, probability: 0.6 },
  { reactants: [S.AlCl3Aq, S.NaOHAq], products: [S.AlOH3, S.NaClAq], deltaH: -42, probability: 0.6 },
  { reactants: [S.CuSO4Aq, S.Na2CO3Aq], products: [S.CuCO3, S.Na2SO4Aq], deltaH: -25, probability: 0.6 },

  // -- F. Dissolution: solid + H2O -> aqueous species. One rule per soluble
  // solid; the genuinely insoluble ones (AgBr, AgI, PbCl2, PbBr2, PbI2,
  // BaSO4, PbSO4, CaSO4, CaCO3, BaCO3, CuCO3, and every hydroxide
  // precipitate) deliberately get none -- same calibration point as AgCl. --
  { reactants: [S.BaCl2, S.H2O], products: [S.BaCl2Aq], deltaH: -13, probability: 0.4 },
  { reactants: [S.BaBr2, S.H2O], products: [S.BaBr2Aq], deltaH: -18, probability: 0.4 },
  { reactants: [S.BaI2, S.H2O], products: [S.BaI2Aq], deltaH: -22, probability: 0.4 },
  { reactants: [S.AlCl3, S.H2O], products: [S.AlCl3Aq], deltaH: -33, probability: 0.4 },
  { reactants: [S.AlBr3, S.H2O], products: [S.AlBr3Aq], deltaH: -40, probability: 0.4 },
  { reactants: [S.AlI3, S.H2O], products: [S.AlI3Aq], deltaH: -45, probability: 0.4 },
  { reactants: [S.FeCl2, S.H2O], products: [S.FeCl2Aq], deltaH: -12, probability: 0.4 },
  { reactants: [S.FeCl3, S.H2O], products: [S.FeCl3Aq], deltaH: -32, probability: 0.4 },
  { reactants: [S.FeBr3, S.H2O], products: [S.FeBr3Aq], deltaH: -35, probability: 0.4 },
  { reactants: [S.FeI2, S.H2O], products: [S.FeI2Aq], deltaH: -8, probability: 0.4 },
  { reactants: [S.CuCl2, S.H2O], products: [S.CuCl2Aq], deltaH: -14, probability: 0.4 },
  { reactants: [S.CuBr2, S.H2O], products: [S.CuBr2Aq], deltaH: -16, probability: 0.4 },
  { reactants: [S.ZnCl2, S.H2O], products: [S.ZnCl2Aq], deltaH: -16, probability: 0.4 },
  { reactants: [S.ZnBr2, S.H2O], products: [S.ZnBr2Aq], deltaH: -18, probability: 0.4 },
  { reactants: [S.ZnI2, S.H2O], products: [S.ZnI2Aq], deltaH: -10, probability: 0.4 },
  { reactants: [S.NaBr, S.H2O], products: [S.NaBrAq], deltaH: -0.6, probability: 0.4 },
  { reactants: [S.NaI, S.H2O], products: [S.NaIAq], deltaH: -7.5, probability: 0.4 },
  { reactants: [S.KBr, S.H2O], products: [S.KBrAq], deltaH: 20, probability: 0.4 },
  { reactants: [S.KI, S.H2O], products: [S.KIAq], deltaH: 20, probability: 0.4 },
  { reactants: [S.MgBr2, S.H2O], products: [S.MgBr2Aq], deltaH: -185, probability: 0.4 },
  { reactants: [S.MgI2, S.H2O], products: [S.MgI2Aq], deltaH: -213, probability: 0.4 },
  { reactants: [S.CaBr2, S.H2O], products: [S.CaBr2Aq], deltaH: -103, probability: 0.4 },
  { reactants: [S.CaI2, S.H2O], products: [S.CaI2Aq], deltaH: -110, probability: 0.4 },
  { reactants: [S.AgNO3, S.H2O], products: [S.AgNO3Aq], deltaH: 22, probability: 0.4 },
  { reactants: [S.PbNO32, S.H2O], products: [S.PbNO32Aq], deltaH: 36, probability: 0.4 },
  { reactants: [S.NaNO3, S.H2O], products: [S.NaNO3Aq], deltaH: 21, probability: 0.4 },
  { reactants: [S.KNO3, S.H2O], products: [S.KNO3Aq], deltaH: 35, probability: 0.4 },
  { reactants: [S.BaNO32, S.H2O], products: [S.BaNO32Aq], deltaH: 40, probability: 0.4 },
  { reactants: [S.CuNO32, S.H2O], products: [S.CuNO32Aq], deltaH: -46, probability: 0.4 },
  { reactants: [S.FeNO33, S.H2O], products: [S.FeNO33Aq], deltaH: -132, probability: 0.4 },
  { reactants: [S.CaNO32, S.H2O], products: [S.CaNO32Aq], deltaH: -19, probability: 0.4 },
  { reactants: [S.Na2SO4, S.H2O], products: [S.Na2SO4Aq], deltaH: -2, probability: 0.4 },
  { reactants: [S.K2SO4, S.H2O], products: [S.K2SO4Aq], deltaH: 24, probability: 0.4 },
  { reactants: [S.CuSO4, S.H2O], products: [S.CuSO4Aq], deltaH: -73, probability: 0.4 },
  { reactants: [S.MgSO4, S.H2O], products: [S.MgSO4Aq], deltaH: -91, probability: 0.4 },
  { reactants: [S.ZnSO4, S.H2O], products: [S.ZnSO4Aq], deltaH: -78, probability: 0.4 },
  { reactants: [S.FeSO4, S.H2O], products: [S.FeSO4Aq], deltaH: -70, probability: 0.4 },
  { reactants: [S.Na2CO3, S.H2O], products: [S.Na2CO3Aq], deltaH: -25, probability: 0.4 },
  { reactants: [S.K2CO3, S.H2O], products: [S.K2CO3Aq], deltaH: -30, probability: 0.4 },
  { reactants: [S.KOH, S.H2O], products: [S.KOHAq], deltaH: -58, probability: 0.4 },
  { reactants: [S.CaOH2, S.H2O], products: [S.CaOH2Aq], deltaH: -16, probability: 0.4 },
  { reactants: [S.BaOH2, S.H2O], products: [S.BaOH2Aq], deltaH: -51, probability: 0.4 },
  { reactants: [S.NH4Cl, S.H2O], products: [S.NH4ClAq], deltaH: 15, probability: 0.4 },
];

export function findReaction(specA: number, specB: number): ReactionRule | undefined {
  for (const rule of REACTIONS) {
    const [a, b] = rule.reactants;
    if ((a === specA && b === specB) || (a === specB && b === specA)) return rule;
  }
  return undefined;
}
