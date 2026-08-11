import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid } from './grid';
import { stirRegion } from './mixer';
import { mulberry32 } from './rng';
import { buildPalette, type PaletteEntry } from './species';

function findEntry(palette: PaletteEntry[], label: string): PaletteEntry {
  const entry = palette.find((p) => p.label === label);
  if (!entry) throw new Error(`no palette entry for ${label}`);
  return entry;
}

function countBySpec(grid: SimGrid): Map<number, number> {
  const counts = new Map<number, number>();
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (grid.isEmptyAt(i)) continue;
    const specId = grid.specId[i] as number;
    counts.set(specId, (counts.get(specId) ?? 0) + 1);
  }
  return counts;
}

describe('stirRegion', () => {
  it('conserves the count of each species', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(10, 10);
    for (let x = 0; x < 5; x++) grid.set(x, 5, water.specId, PhaseCode.Liquid);
    for (let x = 5; x < 10; x++) grid.set(x, 5, hydrogen.specId, PhaseCode.Gas);
    const before = countBySpec(grid);

    const rng = mulberry32(7);
    for (let i = 0; i < 20; i++) stirRegion(grid, rng, 5, 5, 5);

    expect(countBySpec(grid)).toEqual(before);
  });

  it('does not touch solids or walls', () => {
    const palette = buildPalette();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(5, 5);
    grid.set(2, 2, iron.specId, PhaseCode.Solid);
    const before = grid.specId.slice();

    const rng = mulberry32(1);
    for (let i = 0; i < 10; i++) stirRegion(grid, rng, 2, 2, 3);

    expect(grid.specId).toEqual(before);
  });

  it('leaves an empty grid untouched', () => {
    const grid = new SimGrid(6, 6);
    const rng = mulberry32(2);
    stirRegion(grid, rng, 3, 3, 3);
    for (let i = 0; i < grid.width * grid.height; i++) {
      expect(grid.isEmptyAt(i)).toBe(true);
    }
  });

  it('actually moves some liquid cells over many pulses', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(10, 10);
    for (let x = 0; x < 5; x++) grid.set(x, 5, water.specId, PhaseCode.Liquid);
    for (let x = 5; x < 10; x++) grid.set(x, 5, hydrogen.specId, PhaseCode.Gas);
    const before = grid.specId.slice();

    const rng = mulberry32(42);
    for (let i = 0; i < 30; i++) stirRegion(grid, rng, 5, 5, 5, 1);

    expect(grid.specId).not.toEqual(before);
  });
});
