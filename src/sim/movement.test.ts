import { describe, expect, it } from 'vitest';
import { EMPTY, PhaseCode, SimGrid } from './grid';
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
