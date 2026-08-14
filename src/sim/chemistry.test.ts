// Real-chemistry conformance tests: does the static table actually behave
// the way the substances it's named after behave? reactions.test.ts checks
// the table's internal consistency (valid ids, no duplicate pairs, ...) and
// react.test.ts checks the engine mechanics (probability gating, energy
// bookkeeping, ...) on a handful of examples. This file is the "does it
// match reality" layer: it runs dissolution/hydrolysis/precipitation live on
// a grid for every relevant rule in the table (not just a hand-picked few)
// and checks the *chemistry* -- right product, sane temperature, and the
// physical-state invariant that a dissolved species (one grid pixel standing
// in for a whole solution, see species-data.ts's WATER_THERMAL comment) can
// never legitimately boil away into "gaseous salt water" or freeze into
// "solid dissolved salt" -- both would require splitting a cell's mass into
// vapor/ice + residual solute, which this per-cell model has no mechanism
// for (see ThermalProfile.alwaysLiquid in species.ts).
import { describe, expect, it } from 'vitest';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { AMBIENT_TEMPERATURE_K, applyPointHeatSource, energyForTemperature, massOf, MAX_TEMP_K, temperatureOf } from './heat';
import { stepReactions } from './react';
import { REACTIONS } from './reactions';
import { SPECIES, SpeciesId } from './species-data';
import { SpeciesTable } from './species';

const species = new SpeciesTable();
const alwaysFire = () => 0;
const S = SpeciesId as unknown as Record<string, number | undefined>;

function paint(grid: SimGrid, x: number, y: number, specId: number, tempK = AMBIENT_TEMPERATURE_K): void {
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  const { u, phase } = energyForTemperature(thermal, mass, tempK);
  grid.set(x, y, specId, phase, u);
}

function readTemp(grid: SimGrid, idx: number): { tempK: number; phase: PhaseCode } {
  const specId = grid.specId[idx] as number;
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  return temperatureOf(thermal, mass, grid.u[idx] as number);
}

function idOf(name: string): number {
  const id = S[name];
  expect(id, `${name} missing from SpeciesId`).toBeDefined();
  return id as number;
}

// ---------------------------------------------------------------------------
// The physical-state invariant: an aqueous-phase species must stay Liquid no
// matter how much energy it's carrying.
// ---------------------------------------------------------------------------
describe('aqueous species can never be Solid or Gas', () => {
  const aqueousSpecies = SPECIES.map((sp, id) => ({ sp, id })).filter(({ sp }) => sp.phaseAtSTP === 'aqueous');

  it('the table actually has aqueous species to check (sanity)', () => {
    expect(aqueousSpecies.length).toBeGreaterThan(50);
  });

  it.each(aqueousSpecies.map(({ sp, id }) => [sp.name, id] as const))(
    '%s stays Liquid across the sim\'s full energy range, from 0 up to MAX_TEMP_K',
    (_name, specId) => {
      const thermal = species.thermalOf(specId);
      const mass = massOf(species, specId);

      for (const testK of [1, 100, AMBIENT_TEMPERATURE_K, 373.15, 500, 2000, MAX_TEMP_K]) {
        const { phase, u } = energyForTemperature(thermal, mass, testK);
        expect(phase).toBe(PhaseCode.Liquid);
        // energyForTemperature/temperatureOf must round-trip through the
        // same always-Liquid branch, not just agree at the seed point.
        expect(temperatureOf(thermal, mass, u).phase).toBe(PhaseCode.Liquid);
      }

      // Direct energy sweep too, independent of energyForTemperature's own
      // landmarks -- large u must never flip phase away from Liquid.
      for (const u of [0, mass * 10, mass * 10000, 1e9]) {
        expect(temperatureOf(thermal, mass, u).phase).toBe(PhaseCode.Liquid);
      }
    },
  );

  it('a genuinely liquid (non-aqueous) species, e.g. H2O, still boils into Gas normally -- the cap is aqueous-specific, not a general regression', () => {
    const thermal = species.thermalOf(SpeciesId.H2O);
    const mass = massOf(species, SpeciesId.H2O);
    const { phase, tempK } = temperatureOf(thermal, mass, energyForTemperature(thermal, mass, 500).u);
    expect(phase).toBe(PhaseCode.Gas);
    expect(tempK).toBeGreaterThan(373.15);
  });

  it("live regression: dissolving Na2CO3 in water gives aqueous sodium carbonate, and blasting it with heat afterward never turns it to vapor (the user's literal example)", () => {
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, SpeciesId.Na2CO3);
    paint(grid, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    const idx = grid.index(0, 0);
    expect(grid.specId[idx]).toBe(SpeciesId.Na2CO3Aq);
    expect(grid.specId[grid.index(1, 0)]).toBe(EMPTY); // water consumed into the aqueous cell
    expect(grid.phase[idx]).toBe(PhaseCode.Liquid);

    // Now try to boil it: a strong, sustained heat source aimed straight at it.
    for (let t = 0; t < 500; t++) {
      applyPointHeatSource(grid, species, 0, 0, 0, 5000, MAX_TEMP_K, 1);
    }

    expect(grid.specId[idx]).toBe(SpeciesId.Na2CO3Aq); // still the same species, not decomposed into something else
    expect(grid.phase[idx]).toBe(PhaseCode.Liquid); // never flipped to Gas, however hot it gets
    const { tempK } = readTemp(grid, idx);
    expect(Number.isFinite(tempK)).toBe(true);
    expect(tempK).toBeGreaterThan(AMBIENT_TEMPERATURE_K); // it did get hotter
  });
});

// ---------------------------------------------------------------------------
// Dissolution: X + H2O -> X(aq), the name-preserving case (no chemical
// change, just going into solution). Auto-derived from the table itself --
// every H2O-paired rule whose product's name equals "<reactant>(aq)" -- so
// this stays exhaustive as the table grows instead of needing a hand-kept
// list to stay in sync.
// ---------------------------------------------------------------------------
describe('dissolution reactions produce a correctly-named aqueous product', () => {
  const H2O = SpeciesId.H2O;
  const dissolutionRules = REACTIONS.filter((r) => {
    const [a, b] = r.reactants;
    if (a !== H2O && b !== H2O) return false;
    if (r.products.length !== 1) return false;
    const product = SPECIES[r.products[0] as number];
    const reactant = SPECIES[a === H2O ? b : a];
    return product?.phaseAtSTP === 'aqueous' && product.name === `${reactant?.name}(aq)`;
  });

  it('finds a substantial set of pure dissolution rules to check (sanity)', () => {
    expect(dissolutionRules.length).toBeGreaterThanOrEqual(40);
  });

  it.each(
    dissolutionRules.map((r) => {
      const [a, b] = r.reactants;
      const solidId = a === H2O ? b : a;
      return [SPECIES[solidId]?.name, solidId, r.products[0] as number] as const;
    }),
  )('%s + H2O -> its aqueous form, at a physically sane temperature, phase Liquid', (_name, soluteId, expectedAqId) => {
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, soluteId);
    paint(grid, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    const idx = grid.index(0, 0);
    expect(grid.specId[idx]).toBe(expectedAqId);
    expect(grid.specId[grid.index(1, 0)]).toBe(EMPTY);
    expect(grid.phase[idx]).toBe(PhaseCode.Liquid);

    const { tempK } = readTemp(grid, idx);
    expect(Number.isFinite(tempK)).toBe(true);
    expect(tempK).toBeGreaterThan(0);
    // Generous sanity ceiling: real dissolution enthalpies in this table
    // top out well under 1500K starting from ambient (checked empirically);
    // 3000K is loose enough to never false-positive on a legitimate rule but
    // tight enough to catch a genuine scaling bug long before it reaches the
    // engine's own MAX_TEMP_K=10000K clamp.
    expect(tempK).toBeLessThan(3000);
  });
});

// ---------------------------------------------------------------------------
// Hydrolysis: a genuine chemical change on contact with water (oxide ->
// hydroxide/acid), not just "goes into solution" -- so unlike plain
// dissolution the product name is expected to differ from the reactant's,
// and each one is hand-verified against real chemistry rather than
// auto-derived.
// ---------------------------------------------------------------------------
describe('hydrolysis reactions produce the real-world chemical product, not just a dissolved form of the reactant', () => {
  const cases: ReadonlyArray<[reactant: string, expectedProduct: string]> = [
    ['CaO', 'Ca(OH)2(aq)'], // quicklime + water -> slaked lime solution
    ['BaO', 'Ba(OH)2(aq)'],
    ['Na2O', 'NaOH(aq)'], // sodium oxide + water -> sodium hydroxide
    ['K2O', 'KOH(aq)'],
    ['SO3', 'H2SO4(aq)'], // sulfur trioxide + water -> sulfuric acid (contact process)
    ['SO2', 'H2SO3(aq)'], // sulfur dioxide + water -> sulfurous acid
    ['CO2', 'H2CO3(aq)'], // carbon dioxide + water -> carbonic acid
  ];

  it.each(cases)('%s + H2O -> %s', (reactantName, expectedProductName) => {
    const reactantId = idOf(reactantName);
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, reactantId);
    paint(grid, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    const idx = grid.index(0, 0);
    const producedName = SPECIES[grid.specId[idx] as number]?.name;
    expect(producedName).toBe(expectedProductName);
    expect(grid.phase[idx]).toBe(PhaseCode.Liquid);
  });
});

// ---------------------------------------------------------------------------
// Insoluble solids: the "absence of a dissolution rule" calibration point
// (see reactions.ts), checked live on the grid rather than just structurally
// (reactions.test.ts already checks findReaction returns undefined for
// these; this confirms stepReactions actually leaves them alone).
// ---------------------------------------------------------------------------
describe('insoluble solids stay solid and undissolved next to water', () => {
  const insolubleNames = [
    'AgCl', 'AgBr', 'AgI', 'PbCl2', 'PbBr2', 'PbI2',
    'BaSO4', 'PbSO4', 'CaSO4', 'CaCO3', 'BaCO3', 'CuCO3',
    'MgOH2', 'CuOH2', 'FeOH2', 'FeOH3', 'AlOH3', 'ZnOH2',
  ];

  it.each(insolubleNames)('%s + H2O -> unchanged, no aqueous species appears', (name) => {
    const solidId = idOf(name);
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, solidId);
    paint(grid, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(solidId);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.H2O);
  });
});

// ---------------------------------------------------------------------------
// Blanket sanity net across the *entire* reaction table: fire every rule
// once from a fresh grid and check nothing produces a wild state -- an
// infinite/NaN/negative temperature, a temperature over the engine's own
// ceiling, or a species that isn't one of the rule's own declared products.
// Complements fuzz.test.ts's long random run with a deterministic,
// one-fire-per-rule pass that pinpoints exactly which rule misbehaves if one
// ever does.
// ---------------------------------------------------------------------------
describe('every reaction rule produces only sane, declared products when fired', () => {
  it.each(REACTIONS.map((r, i) => [i, SPECIES[r.reactants[0]]?.name, SPECIES[r.reactants[1]]?.name] as const))(
    'rule #%i (%s + %s)',
    (i) => {
      const rule = REACTIONS[i] as (typeof REACTIONS)[number];
      const [a, b] = rule.reactants;
      const startTemp = rule.minTempK !== undefined ? rule.minTempK + 50 : AMBIENT_TEMPERATURE_K;
      const grid = new SimGrid(rule.products.length > 2 ? 3 : 2, 1);
      paint(grid, 0, 0, a, startTemp);
      paint(grid, 1, 0, b, startTemp);

      stepReactions(grid, species, alwaysFire);

      const allowedIds = new Set<number>(rule.products);
      let producedCount = 0;
      for (let idx = 0; idx < grid.specId.length; idx++) {
        const specId = grid.specId[idx] as number;
        if (specId === EMPTY) continue;
        producedCount++;
        expect(allowedIds.has(specId), `unexpected species ${SPECIES[specId]?.name} produced by rule #${i}`).toBe(true);

        const { tempK, phase } = readTemp(grid, idx);
        expect(Number.isFinite(tempK), `rule #${i} produced non-finite temperature`).toBe(true);
        expect(tempK, `rule #${i} produced a temperature below 0K`).toBeGreaterThan(0);
        expect(tempK, `rule #${i} produced a temperature above MAX_TEMP_K`).toBeLessThanOrEqual(MAX_TEMP_K);
        expect([PhaseCode.Solid, PhaseCode.Liquid, PhaseCode.Gas]).toContain(phase);
      }
      expect(producedCount, `rule #${i} fired but left no product on the grid`).toBeGreaterThan(0);
    },
  );
});

// ---------------------------------------------------------------------------
// A handful of named, real-world qualitative-chemistry checks that aren't
// already covered by react.test.ts's per-category examples -- distinct
// reactions chosen for their well-known real-world products/colors.
// ---------------------------------------------------------------------------
describe('spot checks against well-known real chemistry', () => {
  it('CuSO4(aq) + NaOH(aq) -> Cu(OH)2, the classic blue gelatinous precipitate', () => {
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, SpeciesId.CuSO4Aq);
    paint(grid, 1, 0, SpeciesId.NaOHAq);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.CuOH2);
    expect(SPECIES[SpeciesId.CuOH2]?.color).toBe('#3f9ec4'); // real Cu(OH)2 is pale blue
  });

  it('BaCl2(aq) + Na2SO4(aq) -> BaSO4, the classic white insoluble sulfate test', () => {
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, SpeciesId.BaCl2Aq);
    paint(grid, 1, 0, SpeciesId.Na2SO4Aq);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.BaSO4);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.NaClAq);
  });

  it('Fe + Cl2 -> FeCl3 (iron reaches the +3 oxidation state with the strong oxidizer Cl2), not FeCl2', () => {
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, SpeciesId.Fe);
    paint(grid, 1, 0, SpeciesId.Cl2);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.FeCl3);
  });

  it('Fe + I2 -> FeI2 (the weaker oxidizer I2 only reaches +2), not FeI3', () => {
    const grid = new SimGrid(2, 1);
    paint(grid, 0, 0, SpeciesId.Fe);
    paint(grid, 1, 0, SpeciesId.I2);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.FeI2);
  });

  it('Cu does not react with HCl(aq) (below hydrogen in the activity series) but does react with HNO3(aq) (oxidizing acid)', () => {
    const inert = new SimGrid(2, 1);
    paint(inert, 0, 0, SpeciesId.Cu);
    paint(inert, 1, 0, SpeciesId.HClAq);
    stepReactions(inert, species, alwaysFire);
    expect(inert.specId[inert.index(0, 0)]).toBe(SpeciesId.Cu);
    expect(inert.specId[inert.index(1, 0)]).toBe(SpeciesId.HClAq);

    const reactive = new SimGrid(3, 1);
    paint(reactive, 0, 0, SpeciesId.Cu);
    paint(reactive, 1, 0, SpeciesId.HNO3Aq);
    stepReactions(reactive, species, alwaysFire);
    const producedIds = [reactive.specId[0], reactive.specId[1], reactive.specId[2]].filter((id) => id !== EMPTY);
    expect(producedIds).toContain(SpeciesId.CuNO32Aq);
  });
});
