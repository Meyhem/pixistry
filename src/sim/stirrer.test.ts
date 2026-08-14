import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid } from './grid';
import { stepStirrers } from './stirrer';
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

describe('stepStirrers', () => {
  it('does nothing where no stirrer overlay is painted', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(6, 6);
    for (let x = 0; x < 6; x++) grid.set(x, 3, water.specId, PhaseCode.Liquid);
    const before = grid.specId.slice();

    const rng = mulberry32(1);
    for (let i = 0; i < 10; i++) stepStirrers(grid, rng);

    expect(grid.specId).toEqual(before);
  });

  it('conserves species counts while randomizing masked cells', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(10, 10);
    for (let x = 0; x < 10; x++) {
      const isWater = x < 5;
      grid.set(x, 5, isWater ? water.specId : hydrogen.specId, isWater ? PhaseCode.Liquid : PhaseCode.Gas);
      grid.stirrerMask[grid.index(x, 5)] = 1;
    }
    const before = countBySpec(grid);
    const beforeSpecId = grid.specId.slice();

    const rng = mulberry32(7);
    for (let i = 0; i < 10; i++) stepStirrers(grid, rng);

    expect(countBySpec(grid)).toEqual(before);
    expect(grid.specId).not.toEqual(beforeSpecId);
  });

  it('does not touch walls even when masked', () => {
    const grid = new SimGrid(5, 5);
    grid.set(2, 2, GLASS_WALL_SPEC_ID, WALL_PHASE);
    grid.stirrerMask[grid.index(2, 2)] = 1;
    const before = grid.specId.slice();

    const rng = mulberry32(2);
    for (let i = 0; i < 10; i++) stepStirrers(grid, rng);

    expect(grid.specId).toEqual(before);
  });

  it('also shuffles masked solid cells alongside liquid/gas ones', () => {
    const palette = buildPalette();
    const iron = findEntry(palette, 'Fe');
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(5, 5);
    grid.set(2, 2, iron.specId, PhaseCode.Solid);
    for (let x = 0; x < 5; x++) {
      if (x !== 2) grid.set(x, 2, water.specId, PhaseCode.Liquid);
      grid.stirrerMask[grid.index(x, 2)] = 1;
    }
    const before = grid.specId.slice();

    const rng = mulberry32(2);
    let moved = false;
    for (let i = 0; i < 10; i++) {
      stepStirrers(grid, rng);
      if (grid.specId[grid.index(2, 2)] !== iron.specId) moved = true;
    }

    expect(moved).toBe(true);
    expect(grid.specId).not.toEqual(before);
  });

  it('pops some liquid cells up into empty headroom above the overlay', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(12, 12);
    for (let x = 0; x < 12; x++) {
      grid.set(x, 8, water.specId, PhaseCode.Liquid);
      for (let y = 0; y < 12; y++) grid.stirrerMask[grid.index(x, y)] = 1;
    }

    const rng = mulberry32(3);
    let poppedAbove = false;
    for (let i = 0; i < 40; i++) {
      stepStirrers(grid, rng);
      for (let y = 5; y < 8; y++) {
        for (let x = 0; x < 12; x++) {
          if (!grid.isEmptyAt(grid.index(x, y))) poppedAbove = true;
        }
      }
    }

    expect(poppedAbove).toBe(true);
  });
});
