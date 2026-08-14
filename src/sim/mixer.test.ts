import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid } from './grid';
import { stirRegion } from './mixer';
import { mulberry32 } from './rng';
import { buildPalette, type PaletteEntry } from './species';
import { GLASS_WALL_SPEC_ID, WALL_PHASE } from './walls';

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

  it('does not touch walls', () => {
    const grid = new SimGrid(5, 5);
    grid.set(2, 2, GLASS_WALL_SPEC_ID, WALL_PHASE);
    const before = grid.specId.slice();

    const rng = mulberry32(1);
    for (let i = 0; i < 10; i++) stirRegion(grid, rng, 2, 2, 3);

    expect(grid.specId).toEqual(before);
  });

  it('also shuffles solid cells alongside liquid/gas ones', () => {
    const palette = buildPalette();
    const iron = findEntry(palette, 'Fe');
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(5, 5);
    grid.set(2, 2, iron.specId, PhaseCode.Solid);
    for (let x = 0; x < 5; x++) {
      if (x !== 2) grid.set(x, 2, water.specId, PhaseCode.Liquid);
    }
    const before = grid.specId.slice();

    const rng = mulberry32(1);
    let moved = false;
    for (let i = 0; i < 20; i++) {
      stirRegion(grid, rng, 2, 2, 3);
      if (grid.specId[grid.index(2, 2)] !== iron.specId) moved = true;
    }

    expect(moved).toBe(true);
    expect(grid.specId).not.toEqual(before);
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
    for (let i = 0; i < 30; i++) stirRegion(grid, rng, 5, 5, 5);

    expect(grid.specId).not.toEqual(before);
  });

  it('randomizes essentially every cell within the radius in a single call', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');
    const hydrogen = findEntry(palette, 'H2');

    // Alternating columns of two distinguishable species -- a single full
    // shuffle should scramble this checkerboard, not leave most of it
    // untouched the way the old per-cell-probability swap did.
    const grid = new SimGrid(12, 12);
    for (let y = 0; y < 12; y++) {
      for (let x = 0; x < 12; x++) {
        const isWater = (x + y) % 2 === 0;
        grid.set(x, y, isWater ? water.specId : hydrogen.specId, isWater ? PhaseCode.Liquid : PhaseCode.Gas);
      }
    }
    const before = grid.specId.slice();

    const rng = mulberry32(99);
    stirRegion(grid, rng, 6, 6, 6);

    // A full random permutation of a 50/50 checkerboard only changes a cell
    // when it lands on the *other* species, which happens ~50% of the time
    // in expectation -- so this just needs to be well above what the old
    // per-cell-probability swap achieved (a small minority of cells), not
    // above 50%.
    let changed = 0;
    for (let i = 0; i < before.length; i++) {
      if (grid.specId[i] !== before[i]) changed++;
    }
    expect(changed).toBeGreaterThan(before.length * 0.3);
  });
});
