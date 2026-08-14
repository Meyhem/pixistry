// Table-wide invariants for REACTIONS/SPECIES -- checked once here instead
// of by eye, since the halogen-metal/precipitation/acid-base/hydrolysis/
// dissolution expansion pushed the table past 150 species and 150 rules.
// react.test.ts covers individual reaction *behavior*; this file covers
// the table's internal consistency.
import { describe, expect, it } from 'vitest';
import { REACTIONS } from './reactions';
import { SPECIES, SpeciesId } from './species-data';

describe('REACTIONS table invariants', () => {
  it('every reactant/product id is a valid SPECIES index', () => {
    for (const rule of REACTIONS) {
      for (const id of [...rule.reactants, ...rule.products]) {
        expect(id, `id ${id} out of range`).toBeGreaterThanOrEqual(0);
        expect(id, `id ${id} out of range`).toBeLessThan(SPECIES.length);
      }
    }
  });

  it('has no duplicate unordered reactant pair (findReaction returns the first match, so a duplicate silently shadows a rule)', () => {
    const seen = new Map<string, number>();
    REACTIONS.forEach((rule, i) => {
      const [a, b] = rule.reactants;
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      const prior = seen.get(key);
      expect(prior, `rule #${i} (${SPECIES[a]?.name}+${SPECIES[b]?.name}) duplicates rule #${prior}'s reactant pair`).toBeUndefined();
      seen.set(key, i);
    });
  });

  it('never produces more than 3 products (2 reactant slots + at most 1 empty neighbor -- see react.ts findEmptyNeighbor)', () => {
    for (const rule of REACTIONS) {
      expect(rule.products.length).toBeGreaterThan(0);
      expect(rule.products.length).toBeLessThanOrEqual(3);
    }
  });

  it('has a probability in (0, 1] for every rule', () => {
    for (const rule of REACTIONS) {
      expect(rule.probability).toBeGreaterThan(0);
      expect(rule.probability).toBeLessThanOrEqual(1);
    }
  });

  it('gives every species a nonzero specific heat and thermal conductivity for all three phases (a zero is a division-by-zero hazard in heat.ts)', () => {
    for (const sp of SPECIES) {
      expect(sp.specificHeatSolid, `${sp.name} specificHeatSolid`).toBeGreaterThan(0);
      expect(sp.specificHeatLiquid, `${sp.name} specificHeatLiquid`).toBeGreaterThan(0);
      expect(sp.specificHeatGas, `${sp.name} specificHeatGas`).toBeGreaterThan(0);
      expect(sp.thermalConductivitySolid, `${sp.name} thermalConductivitySolid`).toBeGreaterThan(0);
      expect(sp.thermalConductivityLiquid, `${sp.name} thermalConductivityLiquid`).toBeGreaterThan(0);
      expect(sp.thermalConductivityGas, `${sp.name} thermalConductivityGas`).toBeGreaterThan(0);
    }
  });

  it('gives every species a positive molarMass and density', () => {
    for (const sp of SPECIES) {
      expect(sp.molarMass, sp.name).toBeGreaterThan(0);
      expect(sp.density, sp.name).toBeGreaterThan(0);
    }
  });

  // Solubility calibration: a solid whose dissolution rule is present
  // becomes paintable-and-dissolvable; a solid with no such rule is the
  // sim's way of encoding "insoluble" (the AgCl precedent, see
  // reactions.ts's dissolution section). Both lists are exhaustive checks
  // against the actual table, not just spot checks, so a future insertion
  // that forgets a soluble salt's dissolution rule (or accidentally adds
  // one for something meant to precipitate) fails loudly here.
  const solubleSolids = [
    'NaCl', 'KCl', 'CaCl2', 'MgCl2',
    'BaCl2', 'BaBr2', 'BaI2', 'AlCl3', 'AlBr3', 'AlI3', 'FeCl2', 'FeCl3', 'FeBr3', 'FeI2',
    'CuCl2', 'CuBr2', 'ZnCl2', 'ZnBr2', 'ZnI2', 'NaBr', 'NaI', 'KBr', 'KI', 'MgBr2', 'MgI2',
    'CaBr2', 'CaI2', 'AgNO3', 'PbNO32', 'NaNO3', 'KNO3', 'BaNO32', 'CuNO32', 'FeNO33', 'CaNO32',
    'Na2SO4', 'K2SO4', 'CuSO4', 'MgSO4', 'ZnSO4', 'FeSO4', 'Na2CO3', 'K2CO3',
    'KOH', 'CaOH2', 'BaOH2', 'NH4Cl',
  ] as const;

  const insolubleSolids = [
    'AgCl', 'AgBr', 'AgI', 'PbCl2', 'PbBr2', 'PbI2',
    'BaSO4', 'PbSO4', 'CaSO4', 'CaCO3', 'BaCO3', 'CuCO3',
    'MgOH2', 'CuOH2', 'FeOH2', 'FeOH3', 'AlOH3', 'ZnOH2',
  ] as const;

  function hasWaterPairedRule(specId: number): boolean {
    const H2O = SpeciesId.H2O;
    return REACTIONS.some((r) => {
      const [a, b] = r.reactants;
      return (a === H2O && b === specId) || (b === H2O && a === specId);
    });
  }

  it('gives every soluble solid exactly one dissolution rule (paired with H2O)', () => {
    const S = SpeciesId as unknown as Record<string, number | undefined>;
    for (const name of solubleSolids) {
      const id = S[name];
      expect(id, `${name} missing from SpeciesId`).toBeDefined();
      expect(hasWaterPairedRule(id as number), `${name} (id ${id}) has no H2O-paired dissolution rule`).toBe(true);
    }
  });

  it('gives every insoluble solid no dissolution rule at all (that absence is what makes it a precipitate)', () => {
    const S = SpeciesId as unknown as Record<string, number | undefined>;
    for (const name of insolubleSolids) {
      const id = S[name];
      expect(id, `${name} missing from SpeciesId`).toBeDefined();
      expect(hasWaterPairedRule(id as number), `${name} (id ${id}) unexpectedly has an H2O-paired rule`).toBe(false);
    }
  });

  it('makes every aqueous-phase species reachable as some rule\'s product', () => {
    const produced = new Set<number>();
    for (const rule of REACTIONS) for (const p of rule.products) produced.add(p);
    SPECIES.forEach((sp, id) => {
      if (sp.phaseAtSTP === 'aqueous') {
        expect(produced.has(id), `${sp.name} (id ${id}) is aqueous but no rule produces it`).toBe(true);
      }
    });
  });
});
