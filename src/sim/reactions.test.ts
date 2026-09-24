// Table-wide invariants for REACTIONS/SPECIES -- checked once here instead
// of by eye, since the halogen-metal/precipitation/acid-base/hydrolysis/
// dissolution expansion pushed the table past 150 species and 150 rules.
// react.test.ts covers individual reaction *behavior*; this file covers
// the table's internal consistency.
import { describe, expect, it } from 'vitest';
import { findReaction, REACTIONS } from './reactions';
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

  // Acid-base completeness: every aqueous acid paired with every base the
  // table carries (aqueous hydroxide, solid hydroxide, metal oxide,
  // carbonate) needs a rule -- *provided the resulting salt is itself a
  // species*. Zn(OH)2 + H2SO4(aq) sitting inert was the bug that motivated
  // this check: Zn(OH)2 was only ever a precipitation product, with nothing
  // in the table consuming it, even though ZnSO4(aq) existed all along.
  //
  // The "provided the salt exists" clause is the same absence-encodes-
  // chemistry convention AgCl's missing dissolution rule uses. Salts that
  // aren't in SPECIES are skipped here rather than listed as exemptions,
  // which covers three distinct reasons at once: the species genuinely
  // can't form (CuI2 and FeI3 are redox-unstable), the anion family isn't
  // modeled at all (no sulfite exists, so H2SO3(aq) reacts with nothing),
  // or it's simply not in the curated table yet (Zn(NO3)2, Al2(SO4)3).
  // Adding any such salt to SPECIES makes this test start demanding its
  // rules, which is the intended pressure.
  const aqueousAcids = [
    { id: 'HClAq', anion: 'Cl', anionCharge: 1 },
    { id: 'H2SO4Aq', anion: 'SO4', anionCharge: 2 },
    { id: 'HNO3Aq', anion: 'NO3', anionCharge: 1 },
    { id: 'HBrAq', anion: 'Br', anionCharge: 1 },
    { id: 'HIAq', anion: 'I', anionCharge: 1 },
    { id: 'H2CO3Aq', anion: 'CO3', anionCharge: 2 },
    { id: 'H2SO3Aq', anion: 'SO3', anionCharge: 2 },
  ] as const;

  const bases = [
    { id: 'NaOHAq', cation: 'Na', cationCharge: 1 },
    { id: 'KOHAq', cation: 'K', cationCharge: 1 },
    { id: 'CaOH2Aq', cation: 'Ca', cationCharge: 2 },
    { id: 'BaOH2Aq', cation: 'Ba', cationCharge: 2 },
    { id: 'NH3Aq', cation: 'NH4', cationCharge: 1 },
    { id: 'NaOH', cation: 'Na', cationCharge: 1 },
    { id: 'KOH', cation: 'K', cationCharge: 1 },
    { id: 'CaOH2', cation: 'Ca', cationCharge: 2 },
    { id: 'BaOH2', cation: 'Ba', cationCharge: 2 },
    { id: 'MgOH2', cation: 'Mg', cationCharge: 2 },
    { id: 'CuOH2', cation: 'Cu', cationCharge: 2 },
    { id: 'FeOH2', cation: 'Fe', cationCharge: 2 },
    { id: 'FeOH3', cation: 'Fe', cationCharge: 3 },
    { id: 'AlOH3', cation: 'Al', cationCharge: 3 },
    { id: 'ZnOH2', cation: 'Zn', cationCharge: 2 },
    { id: 'MgO', cation: 'Mg', cationCharge: 2 },
    { id: 'CaO', cation: 'Ca', cationCharge: 2 },
    { id: 'BaO', cation: 'Ba', cationCharge: 2 },
    { id: 'Na2O', cation: 'Na', cationCharge: 1 },
    { id: 'K2O', cation: 'K', cationCharge: 1 },
    { id: 'PbO', cation: 'Pb', cationCharge: 2 },
    { id: 'Ag2O', cation: 'Ag', cationCharge: 1 },
    { id: 'Fe2O3', cation: 'Fe', cationCharge: 3 },
    { id: 'Al2O3', cation: 'Al', cationCharge: 3 },
    { id: 'CuO', cation: 'Cu', cationCharge: 2 },
    { id: 'ZnO', cation: 'Zn', cationCharge: 2 },
    { id: 'Na2CO3', cation: 'Na', cationCharge: 1 },
    { id: 'K2CO3', cation: 'K', cationCharge: 1 },
    { id: 'CaCO3', cation: 'Ca', cationCharge: 2 },
    { id: 'BaCO3', cation: 'Ba', cationCharge: 2 },
    { id: 'CuCO3', cation: 'Cu', cationCharge: 2 },
  ] as const;

  /** Builds the salt's formula the same way species-data.ts spells it, so
   * the lookup below is a plain name match: subscripts from the
   * charge-balance LCM, parentheses around any multi-atom group that takes
   * a subscript (Ca(NO3)2, but CaCl2 and Na2SO4 bare). */
  function saltFormula(cation: string, cationCharge: number, anion: string, anionCharge: number): string {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    const lcm = (cationCharge * anionCharge) / gcd(cationCharge, anionCharge);
    const group = (sym: string, count: number) =>
      count === 1 ? sym : sym.length > 2 ? `(${sym})${count}` : `${sym}${count}`;
    return group(cation, lcm / cationCharge) + group(anion, lcm / anionCharge);
  }

  it('has a rule for every acid-base pair whose salt exists in SPECIES', () => {
    const S = SpeciesId as unknown as Record<string, number | undefined>;
    const named = new Set(SPECIES.map((sp) => sp.name));
    const missing: string[] = [];

    for (const base of bases) {
      const baseId = S[base.id];
      expect(baseId, `${base.id} missing from SpeciesId`).toBeDefined();
      for (const acid of aqueousAcids) {
        const acidId = S[acid.id];
        expect(acidId, `${acid.id} missing from SpeciesId`).toBeDefined();
        // Carbonic acid on a carbonate would make a bicarbonate, an anion
        // family the table doesn't model.
        if (acid.anion === 'CO3' && base.id.includes('CO3')) continue;
        const salt = saltFormula(base.cation, base.cationCharge, acid.anion, acid.anionCharge);
        if (!named.has(salt) && !named.has(`${salt}(aq)`)) continue;
        if (!findReaction(acidId as number, baseId as number)) {
          missing.push(`${base.id} + ${acid.id} -> ${salt}`);
        }
      }
    }

    expect(missing, `${missing.length} acid-base pairs have no rule`).toEqual([]);
  });

  // The same completeness idea for metal + acid -> salt + H2. Only metals
  // above hydrogen in the reactivity series belong here; Cu/Ag/Pb sit below
  // it and are excluded by construction, which is why Cu's only acid rule
  // is the oxidizing-acid HNO3(aq) one. Iron dissolves to Fe(II), not
  // Fe(III), so its salts are looked up at charge 2.
  const activeMetals = [
    { id: 'Mg', cation: 'Mg', cationCharge: 2 },
    { id: 'Al', cation: 'Al', cationCharge: 3 },
    { id: 'Ca', cation: 'Ca', cationCharge: 2 },
    { id: 'Fe', cation: 'Fe', cationCharge: 2 },
    { id: 'Zn', cation: 'Zn', cationCharge: 2 },
  ] as const;

  it('has a rule for every active-metal + acid pair whose salt exists in SPECIES', () => {
    const S = SpeciesId as unknown as Record<string, number | undefined>;
    const named = new Set(SPECIES.map((sp) => sp.name));
    const missing: string[] = [];

    for (const metal of activeMetals) {
      const metalId = S[metal.id];
      expect(metalId, `${metal.id} missing from SpeciesId`).toBeDefined();
      for (const acid of aqueousAcids) {
        // Carbonic and sulfurous acid are too weak to displace hydrogen
        // from a metal, so they are not expected to have rules here.
        if (acid.anion === 'CO3' || acid.anion === 'SO3') continue;
        const acidId = S[acid.id];
        const salt = saltFormula(metal.cation, metal.cationCharge, acid.anion, acid.anionCharge);
        if (!named.has(salt) && !named.has(`${salt}(aq)`)) continue;
        if (!findReaction(acidId as number, metalId as number)) {
          missing.push(`${metal.id} + ${acid.id} -> ${salt}`);
        }
      }
    }

    expect(missing, `${missing.length} metal-acid pairs have no rule`).toEqual([]);
  });
});
