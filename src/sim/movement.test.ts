import { describe, expect, it } from 'vitest';
import { EMPTY, PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf } from './heat';
import { stepMovement } from './movement';
import { mulberry32 } from './rng';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';
import { SpeciesId } from './species-data';

function findEntry(palette: PaletteEntry[], label: string): PaletteEntry {
  const entry = palette.find((p) => p.label === label);
  if (!entry) throw new Error(`no palette entry for ${label}`);
  return entry;
}

function countNonEmpty(grid: SimGrid): number {
  let count = 0;
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isEmptyAt(i)) count++;
  }
  return count;
}

describe('stepMovement', () => {
  it('a solid falls one row per tick through vacuum', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 5);
    grid.set(1, 0, iron.specId, iron.phase);
    const rng = mulberry32(1);

    for (let tick = 0; tick < 4; tick++) {
      stepMovement(grid, species, rng, tick);
      expect(grid.specId[grid.index(1, tick + 1)]).toBe(iron.specId);
    }
    // Resting on the floor, one more tick should not move it further.
    stepMovement(grid, species, rng, 4);
    expect(grid.specId[grid.index(1, 4)]).toBe(iron.specId);
  });

  it('a gas rises one row per tick through vacuum', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(3, 5);
    grid.set(1, 4, hydrogen.specId, hydrogen.phase);
    const rng = mulberry32(2);

    for (let tick = 0; tick < 4; tick++) {
      stepMovement(grid, species, rng, tick);
      expect(grid.specId[grid.index(1, 3 - tick)]).toBe(hydrogen.specId);
    }
  });

  it('a dense solid sinks through a liquid', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const water = findEntry(palette, 'H2O');
    expect(species.densityOf(iron.specId)).toBeGreaterThan(species.densityOf(water.specId));

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, iron.specId, iron.phase);
    grid.set(0, 1, water.specId, water.phase);
    const rng = mulberry32(3);

    stepMovement(grid, species, rng, 0);

    expect(grid.specId[grid.index(0, 1)]).toBe(iron.specId);
    expect(grid.specId[grid.index(0, 0)]).toBe(water.specId);
  });

  it('does not let a denser solid sink through a lighter solid -- solids stay statically mixed', () => {
    const species = new SpeciesTable();
    const palette = buildPalette();
    const silver = findEntry(palette, 'Ag'); // density 10.49
    const sodium = findEntry(palette, 'Na'); // density 0.97
    expect(species.densityOf(silver.specId)).toBeGreaterThan(species.densityOf(sodium.specId));

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, silver.specId, silver.phase);
    grid.set(0, 1, sodium.specId, sodium.phase);
    const rng = mulberry32(6);

    for (let tick = 0; tick < 10; tick++) stepMovement(grid, species, rng, tick);

    expect(grid.specId[grid.index(0, 0)]).toBe(silver.specId);
    expect(grid.specId[grid.index(0, 1)]).toBe(sodium.specId);
  });

  it('sinks a denser liquid below a lighter one', () => {
    const species = new SpeciesTable();
    expect(species.densityOf(SpeciesId.NaClAq)).toBeGreaterThan(species.densityOf(SpeciesId.H2O));

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, SpeciesId.NaClAq, PhaseCode.Liquid);
    grid.set(0, 1, SpeciesId.H2O, PhaseCode.Liquid);
    const rng = mulberry32(7);

    stepMovement(grid, species, rng, 0);

    expect(grid.specId[grid.index(0, 1)]).toBe(SpeciesId.NaClAq);
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.H2O);
  });

  it('lets boiled water (steam) rise through the liquid water it just came from (regression)', () => {
    // Before buoyantDensityOf existed, canDisplace compared densityOf's
    // single fixed table value for both cells -- a gas-phase H2O cell
    // reported the same density as the liquid water surrounding it, so
    // `fromDensity < targetDensity` was always false and steam could never
    // rise through its own liquid, just sat there looking identical to it.
    const species = new SpeciesTable();
    const thermal = species.thermalOf(SpeciesId.H2O);
    const mass = massOf(species, SpeciesId.H2O);
    const steam = energyForTemperature(thermal, mass, thermal.boilK + 50);
    expect(steam.phase).toBe(PhaseCode.Gas);
    const liquid = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
    expect(liquid.phase).toBe(PhaseCode.Liquid);

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, SpeciesId.H2O, liquid.phase, liquid.u);
    grid.set(0, 1, SpeciesId.H2O, steam.phase, steam.u);
    const rng = mulberry32(8);

    stepMovement(grid, species, rng, 0);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.H2O);
    expect(grid.phase[grid.index(0, 0)]).toBe(PhaseCode.Gas);
    expect(grid.phase[grid.index(0, 1)]).toBe(PhaseCode.Liquid);
  });

  it('conserves the number of occupied cells', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(8, 8);
    grid.set(2, 0, iron.specId, iron.phase);
    grid.set(5, 7, hydrogen.specId, hydrogen.phase);
    grid.set(4, 4, iron.specId, iron.phase);
    const before = countNonEmpty(grid);

    const rng = mulberry32(4);
    for (let tick = 0; tick < 10; tick++) stepMovement(grid, species, rng, tick);

    expect(countNonEmpty(grid)).toBe(before);
  });

  it('is deterministic for a given seed', () => {
    buildPalette();
    const species = new SpeciesTable();
    const palette = buildPalette();
    const iron = findEntry(palette, 'Fe');
    const hydrogen = findEntry(palette, 'H2');

    function run(): Uint16Array {
      const grid = new SimGrid(10, 10);
      grid.set(2, 0, iron.specId, iron.phase);
      grid.set(7, 9, hydrogen.specId, hydrogen.phase);
      grid.set(5, 3, iron.specId, iron.phase);
      const rng = mulberry32(99);
      for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick);
      return grid.specId.slice();
    }

    expect(run()).toEqual(run());
  });

  it('lets a lighter liquid rise out of an envelope of denser liquid resting on a solid (regression)', () => {
    // Before the lateral-mixing/buoyant-rise fix, moveFalling only tried to
    // move a liquid down/diagonal-down by density, or sideways into empty
    // space -- never sideways/upward past another liquid. A lighter liquid
    // pinned against a solid floor with denser liquid on every open side had
    // no legal move at all and sat frozen forever.
    const species = new SpeciesTable();
    expect(species.densityOf(SpeciesId.H2O2)).toBeGreaterThan(species.densityOf(SpeciesId.H2O)); // 1.45 vs 1.0

    const grid = new SimGrid(5, 6);
    // Solid floor.
    for (let x = 0; x < 5; x++) grid.set(x, 5, SpeciesId.Fe, PhaseCode.Solid);
    // Denser H2O2 pool filling everything above the floor.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) grid.set(x, y, SpeciesId.H2O2, PhaseCode.Liquid);
    }
    // Lighter water, enveloped: resting on the floor, H2O2 on every side.
    grid.set(2, 4, SpeciesId.H2O, PhaseCode.Liquid);

    const rng = mulberry32(11);
    for (let tick = 0; tick < 400; tick++) stepMovement(grid, species, rng, tick);

    let waterY = -1;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 5; x++) {
        if (grid.specId[grid.index(x, y)] === SpeciesId.H2O) waterY = y;
      }
    }
    expect(waterY).toBeGreaterThanOrEqual(0);
    expect(waterY).toBeLessThan(4); // it moved up off the floor, not stuck
  });

  it('never lets a falling solid displace into a tube lumen cell', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 5);
    grid.set(1, 0, iron.specId, iron.phase);
    grid.tubeMask[grid.index(1, 1)] = TubeMaskValue.Lumen;
    const rng = mulberry32(1);

    stepMovement(grid, species, rng, 0);
    // The lumen cell directly below stays empty -- displacement straight
    // down is blocked, though the solid may still fall diagonally past it.
    expect(grid.isEmptyAt(grid.index(1, 1))).toBe(true);
  });

  it('never moves a cell that is itself inside a tube lumen', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 5);
    grid.set(1, 2, iron.specId, iron.phase);
    grid.tubeMask[grid.index(1, 2)] = TubeMaskValue.Lumen;
    const rng = mulberry32(1);

    stepMovement(grid, species, rng, 0);
    expect(grid.specId[grid.index(1, 2)]).toBe(iron.specId);
  });

  it('never moves a cell that is itself inside a tube suction cone -- only stepTubes may pull it out', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');

    // Empty space all around so ordinary gravity/lateral spread would
    // otherwise happily move this liquid every which way.
    const grid = new SimGrid(5, 5);
    grid.set(2, 2, water.specId, water.phase);
    grid.tubeMask[grid.index(2, 2)] = TubeMaskValue.Cone;
    const rng = mulberry32(1);

    for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick);
    expect(grid.specId[grid.index(2, 2)]).toBe(water.specId);
  });

  it('still lets ordinary movement fall/spread INTO a cone cell from outside it', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(3, 5);
    grid.set(1, 0, water.specId, water.phase);
    grid.tubeMask[grid.index(1, 1)] = TubeMaskValue.Cone;
    const rng = mulberry32(2);

    stepMovement(grid, species, rng, 0);
    expect(grid.specId[grid.index(1, 1)]).toBe(water.specId);
    expect(grid.isEmptyAt(grid.index(1, 0))).toBe(true);
  });

  it('leaves EMPTY untouched when the grid is all vacuum', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(4, 4);
    const rng = mulberry32(5);
    stepMovement(grid, species, rng, 0);
    for (let i = 0; i < grid.width * grid.height; i++) {
      expect(grid.specId[i]).toBe(EMPTY);
    }
  });
});
