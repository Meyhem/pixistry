import { describe, expect, it } from 'vitest';
import { grabDrop, grabPickUp } from './grabber';
import { PhaseCode, SimGrid } from './grid';
import { WALL_SPEC_BASE } from './walls';
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

describe('grabPickUp / grabDrop', () => {
  it('removes held cells from the grid on pickup', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(10, 10);
    grid.set(5, 5, water.specId, PhaseCode.Liquid, 42);

    grabPickUp(grid, 5, 5, 1);

    expect(grid.isEmptyAt(grid.index(5, 5))).toBe(true);
  });

  it('drops held cells translated by however the anchor moved', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(10, 10);
    grid.set(5, 5, water.specId, PhaseCode.Liquid, 42);

    const state = grabPickUp(grid, 5, 5, 1);
    state.anchorX = 7;
    state.anchorY = 6;
    grabDrop(grid, state);

    expect(grid.isEmptyAt(grid.index(5, 5))).toBe(true);
    expect(grid.specId[grid.index(7, 6)]).toBe(water.specId);
    expect(grid.u[grid.index(7, 6)]).toBe(42);
  });

  it('holds cells immune to further mutation of the grid while grabbed', () => {
    // Simulates what would otherwise be gas drifting away between grab
    // steps: mutating the grid after pickup (as a tick would) must not
    // affect cells already pulled out into the held state.
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(10, 10);
    grid.set(5, 5, water.specId, PhaseCode.Liquid, 42);

    const state = grabPickUp(grid, 5, 5, 1);
    // grid is now free at (5,5); something else moves in, simulating drift
    grid.set(5, 5, hydrogen.specId, PhaseCode.Gas);

    state.anchorX = 8;
    state.anchorY = 8;
    grabDrop(grid, state);

    expect(grid.specId[grid.index(8, 8)]).toBe(water.specId);
    expect(grid.specId[grid.index(5, 5)]).toBe(hydrogen.specId);
  });

  it('conserves the count of each species across pickup and drop', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(20, 20);
    for (let x = 5; x < 10; x++) grid.set(x, 10, water.specId, PhaseCode.Liquid);
    for (let x = 10; x < 15; x++) grid.set(x, 10, hydrogen.specId, PhaseCode.Gas);
    const before = countBySpec(grid);

    const state = grabPickUp(grid, 10, 10, 6);
    state.anchorX = 13;
    state.anchorY = 8;
    grabDrop(grid, state);

    expect(countBySpec(grid)).toEqual(before);
  });

  it('does not pick up walls', () => {
    const wallSpecId = WALL_SPEC_BASE;
    const grid = new SimGrid(10, 10);
    grid.set(5, 5, wallSpecId, PhaseCode.Solid);

    const state = grabPickUp(grid, 5, 5, 2);

    expect(state.cells).toHaveLength(0);
    expect(grid.specId[grid.index(5, 5)]).toBe(wallSpecId);
  });

  it('drops a cell onto a wall silently instead of overwriting it', () => {
    const palette = buildPalette();
    const water = findEntry(palette, 'H2O');
    const wallSpecId = WALL_SPEC_BASE;

    const grid = new SimGrid(10, 10);
    grid.set(4, 4, water.specId, PhaseCode.Liquid);
    grid.set(6, 4, wallSpecId, PhaseCode.Solid);

    const state = grabPickUp(grid, 4, 4, 0);
    state.anchorX = 6;
    state.anchorY = 4;
    grabDrop(grid, state);

    expect(grid.specId[grid.index(6, 4)]).toBe(wallSpecId);
    expect(countBySpec(grid).get(water.specId)).toBeUndefined();
  });

  it('leaves an empty grid untouched', () => {
    const grid = new SimGrid(6, 6);
    const state = grabPickUp(grid, 3, 3, 3);
    grabDrop(grid, state);
    for (let i = 0; i < grid.width * grid.height; i++) {
      expect(grid.isEmptyAt(i)).toBe(true);
    }
  });
});
