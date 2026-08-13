import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid } from './grid';
import { stepStirrers } from './stirrer';
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

  it('does not touch solids or walls even when masked', () => {
    const palette = buildPalette();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(5, 5);
    grid.set(2, 2, iron.specId, PhaseCode.Solid);
    grid.stirrerMask[grid.index(2, 2)] = 1;
    const before = grid.specId.slice();

    const rng = mulberry32(2);
    for (let i = 0; i < 10; i++) stepStirrers(grid, rng);

    expect(grid.specId).toEqual(before);
  });
});
