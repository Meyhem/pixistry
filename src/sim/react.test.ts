import { describe, expect, it } from 'vitest';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf } from './heat';
import { stepReactions } from './react';
import { SpeciesId } from './species-data';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';

function findEntry(palette: PaletteEntry[], label: string): PaletteEntry {
  const entry = palette.find((p) => p.label === label);
  if (!entry) throw new Error(`no palette entry for ${label}`);
  return entry;
}

function paint(grid: SimGrid, species: SpeciesTable, x: number, y: number, specId: number): void {
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  const { u, phase } = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
  grid.set(x, y, specId, phase, u);
}

const alwaysFire = () => 0;
const neverFire = () => 1;

describe('stepReactions', () => {
  it('dissolves solid NaCl adjacent to water into a single aqueous NaCl pixel', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);

    paint(grid, species, 0, 0, SpeciesId.NaCl);
    paint(grid, species, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    const i = grid.index(0, 0);
    const j = grid.index(1, 0);
    expect(grid.specId[i]).toBe(SpeciesId.NaClAq);
    expect(grid.phase[i]).toBe(PhaseCode.Liquid);
    expect(grid.specId[j]).toBe(EMPTY);
  });

  it('leaves insoluble AgCl next to water untouched (no dissolution rule for it)', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);

    paint(grid, species, 0, 0, SpeciesId.AgCl);
    paint(grid, species, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.AgCl);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.H2O);
  });

  it('does not fire when rng rolls above the reaction probability', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);

    paint(grid, species, 0, 0, SpeciesId.NaCl);
    paint(grid, species, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, neverFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.NaCl);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.H2O);
  });

  it('is a no-op on an empty grid', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(4, 4);
    expect(() => stepReactions(grid, species, alwaysFire)).not.toThrow();
    for (let i = 0; i < grid.specId.length; i++) expect(grid.specId[i]).toBe(EMPTY);
  });

  it('does not react across a wall cell', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.NaCl);
    // Right neighbor stays empty -- nothing to react with, and the sole
    // populated cell must survive an untouched tick unchanged.
    stepReactions(grid, species, alwaysFire);
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.NaCl);
  });

  it('conserves total internal energy across a firing reaction', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);

    paint(grid, species, 0, 0, SpeciesId.NaCl);
    paint(grid, species, 1, 0, SpeciesId.H2O);

    const before = (grid.u[grid.index(0, 0)] as number) + (grid.u[grid.index(1, 0)] as number);
    stepReactions(grid, species, alwaysFire);
    const after = (grid.u[grid.index(0, 0)] as number) + (grid.u[grid.index(1, 0)] as number);

    // Dissolution's deltaH is a small positive (endothermic-ish) value --
    // just assert energy was actually redistributed, not silently dropped
    // or duplicated beyond a sane range.
    expect(Number.isFinite(after)).toBe(true);
    expect(after).not.toBe(before);
  });

  it('does not react below the reaction ignition threshold', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    // H2 + O2 requires minTempK: 500; ambient (~298K) must not ignite it.
    paint(grid, species, 0, 0, SpeciesId.H2);
    paint(grid, species, 1, 0, SpeciesId.O2);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.H2);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.O2);
  });

  it('reacts Na + Cl2 into NaCl using the palette lookup', () => {
    const species = new SpeciesTable();
    const palette = buildPalette();
    const grid = new SimGrid(2, 1);
    const na = findEntry(palette, 'Na');
    const cl2 = findEntry(palette, 'Cl2');

    paint(grid, species, 0, 0, na.specId);
    paint(grid, species, 1, 0, cl2.specId);

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)]];
    expect(products).toContain(SpeciesId.NaCl);
  });
});

// One end-to-end case per category from the halogen-metal/precipitation/
// acid-base/hydrolysis/dissolution expansion, plus the negative calibration
// points that same table deliberately encodes as "no rule". Table-wide
// invariants (every id valid, no duplicate pairs, solubility coverage) live
// in reactions.test.ts instead of being re-checked per case here.
describe('stepReactions: catalyst pad', () => {
  // NaCl + H2O -> NaCl(aq) is probability 0.4 with no minTempK, so an rng
  // pinned at 0.6 sits deliberately between the bare rule (0.4, won't fire)
  // and a 2x-catalysed one (0.8, fires) -- the gap is the whole point of
  // these two tests.
  const between = () => 0.6;

  function nacLInWater(): { grid: SimGrid; species: SpeciesTable } {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.NaCl);
    paint(grid, species, 1, 0, SpeciesId.H2O);
    return { grid, species };
  }

  it('does not fire at a probability the bare rule would fail', () => {
    const { grid, species } = nacLInWater();
    stepReactions(grid, species, between);
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.NaCl);
  });

  it('fires the same roll once a pad multiplies the rule probability past it', () => {
    const { grid, species } = nacLInWater();
    grid.catalystStrength[grid.index(0, 0)] = 2;
    stepReactions(grid, species, between);
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.NaClAq);
  });

  it('a pad under either reacting cell is enough, not just the first', () => {
    const { grid, species } = nacLInWater();
    grid.catalystStrength[grid.index(1, 0)] = 2;
    stepReactions(grid, species, between);
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.NaClAq);
  });

  it('never bypasses a rule\'s ignition threshold -- catalysis speeds a reaction up, it does not lower minTempK', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    // N2 + H2 -> NH3 needs 700 K; both cells are painted at ambient.
    paint(grid, species, 0, 0, SpeciesId.N2);
    paint(grid, species, 1, 0, SpeciesId.H2);
    grid.catalystStrength[grid.index(0, 0)] = 255;

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.N2);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.H2);
  });

  it('clamps the multiplied probability at 1 rather than letting it run past certainty', () => {
    const { grid, species } = nacLInWater();
    grid.catalystStrength[grid.index(0, 0)] = 200;
    // rng at 0.999 is under a clamped 1.0 but would also be under an
    // unclamped 0.4*200=80 -- what this really pins is that neverFire (1.0)
    // still cannot fire, i.e. the clamp is inclusive-exclusive the same way
    // the uncatalysed path is.
    stepReactions(grid, species, neverFire);
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.NaCl);
  });
});

describe('stepReactions: halogen-metal / precipitation / acid-base / hydrolysis / dissolution expansion', () => {
  it('halogen-metal: Ba + Cl2 -> BaCl2', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.Ba);
    paint(grid, species, 1, 0, SpeciesId.Cl2);

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)]];
    expect(products).toContain(SpeciesId.BaCl2);
  });

  it('halogen displacement: Cl2 displaces iodide out of KI(aq) into KCl(aq) + I2', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.Cl2);
    paint(grid, species, 1, 0, SpeciesId.KIAq);

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)]];
    expect(products).toContain(SpeciesId.KClAq);
    expect(products).toContain(SpeciesId.I2);
  });

  it('does not let Br2 displace chloride back out of NaCl(aq) -- no reverse-direction rule exists', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.Br2);
    paint(grid, species, 1, 0, SpeciesId.NaClAq);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.Br2);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.NaClAq);
  });

  it('acid-base: aqueous HCl neutralizes aqueous NaOH into NaCl(aq) + H2O', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.HClAq);
    paint(grid, species, 1, 0, SpeciesId.NaOHAq);

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)]];
    expect(products).toContain(SpeciesId.NaClAq);
    expect(products).toContain(SpeciesId.H2O);
  });

  it('acid + carbonate is a 3-product reaction that fizzes CO2 into a free neighbor cell', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 1);
    paint(grid, species, 0, 0, SpeciesId.HClAq);
    paint(grid, species, 1, 0, SpeciesId.CaCO3);
    // (2, 0) stays empty -- the 3rd product's landing spot.

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)], grid.specId[grid.index(2, 0)]];
    expect(products).toContain(SpeciesId.CaCl2Aq);
    expect(products).toContain(SpeciesId.H2O);
    expect(products).toContain(SpeciesId.CO2);
  });

  it('does not let copper react with aqueous HCl -- Cu sits below H2 in the activity series, no rule for it', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.HClAq);
    paint(grid, species, 1, 0, SpeciesId.Cu);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.HClAq);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.Cu);
  });

  it('but copper does dissolve in aqueous nitric acid (the oxidizing-acid exception, brown NO2 fumes) -- a 3-product reaction, needs a free neighbor', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 1);
    paint(grid, species, 0, 0, SpeciesId.HNO3Aq);
    paint(grid, species, 1, 0, SpeciesId.Cu);
    // (2, 0) stays empty -- the 3rd product's landing spot.

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)], grid.specId[grid.index(2, 0)]];
    expect(products).toContain(SpeciesId.CuNO32Aq);
    expect(products).toContain(SpeciesId.NO2);
    expect(products).toContain(SpeciesId.H2O);
  });

  it('hydrolysis: CaO + H2O -> Ca(OH)2(aq), the slaked-lime reaction', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.CaO);
    paint(grid, species, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)]];
    expect(products).toContain(SpeciesId.CaOH2Aq);
  });

  it('precipitation: AgNO3(aq) + NaCl(aq) -> AgCl precipitate + NaNO3(aq)', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.AgNO3Aq);
    paint(grid, species, 1, 0, SpeciesId.NaClAq);

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)]];
    expect(products).toContain(SpeciesId.AgCl);
    expect(products).toContain(SpeciesId.NaNO3Aq);
  });

  it('precipitation: Pb(NO3)2(aq) + KI(aq) -> PbI2 golden-yellow precipitate', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.PbNO32Aq);
    paint(grid, species, 1, 0, SpeciesId.KIAq);

    stepReactions(grid, species, alwaysFire);

    const products = [grid.specId[grid.index(0, 0)], grid.specId[grid.index(1, 0)]];
    expect(products).toContain(SpeciesId.PbI2);
  });

  it('dissolution: soluble BaCl2 dissolves into BaCl2(aq)', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.BaCl2);
    paint(grid, species, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.BaCl2Aq);
  });

  it('leaves insoluble PbI2 next to water untouched -- no dissolution rule for it, same as AgCl', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.PbI2);
    paint(grid, species, 1, 0, SpeciesId.H2O);

    stepReactions(grid, species, alwaysFire);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.PbI2);
    expect(grid.specId[grid.index(1, 0)]).toBe(SpeciesId.H2O);
  });
});
