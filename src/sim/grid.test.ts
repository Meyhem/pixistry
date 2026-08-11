import { describe, expect, it } from 'vitest';
import { EMPTY, PhaseCode, SimGrid } from './grid';

describe('SimGrid', () => {
  it('starts fully empty', () => {
    const grid = new SimGrid(4, 3);
    for (let i = 0; i < grid.width * grid.height; i++) {
      expect(grid.specId[i]).toBe(EMPTY);
      expect(grid.isEmptyAt(i)).toBe(true);
    }
  });

  it('indexes row-major', () => {
    const grid = new SimGrid(4, 3);
    expect(grid.index(0, 0)).toBe(0);
    expect(grid.index(3, 0)).toBe(3);
    expect(grid.index(0, 1)).toBe(4);
    expect(grid.index(2, 2)).toBe(10);
  });

  it('reports bounds correctly', () => {
    const grid = new SimGrid(4, 3);
    expect(grid.inBounds(0, 0)).toBe(true);
    expect(grid.inBounds(3, 2)).toBe(true);
    expect(grid.inBounds(-1, 0)).toBe(false);
    expect(grid.inBounds(4, 0)).toBe(false);
    expect(grid.inBounds(0, 3)).toBe(false);
  });

  it('set then clear round-trips to empty', () => {
    const grid = new SimGrid(2, 2);
    grid.set(1, 1, 7, PhaseCode.Solid);
    const idx = grid.index(1, 1);
    expect(grid.specId[idx]).toBe(7);
    expect(grid.phase[idx]).toBe(PhaseCode.Solid);

    grid.clear(1, 1);
    expect(grid.isEmptyAt(idx)).toBe(true);
    expect(grid.phase[idx]).toBe(PhaseCode.Empty);
  });

  it('swap exchanges every field between two cells', () => {
    const grid = new SimGrid(2, 1);
    grid.set(0, 0, 3, PhaseCode.Gas);
    grid.u[0] = 42;
    grid.n[0] = 5;

    grid.swap(0, 1);

    expect(grid.specId[1]).toBe(3);
    expect(grid.phase[1]).toBe(PhaseCode.Gas);
    expect(grid.u[1]).toBe(42);
    expect(grid.n[1]).toBe(5);
    expect(grid.isEmptyAt(0)).toBe(true);
  });
});
