import { beforeEach, describe, expect, it } from 'vitest';
import { SimGrid } from './grid';
import {
  moveRadiatorEndpoint,
  moveRadiatorInstance,
  placeRadiatorInstance,
  pruneErasedRadiators,
  RADIATOR_WATTS,
  resetRadiatorIds,
  updateRadiatorInstance,
  type RadiatorInstance,
} from './radiators';

function place(grid: SimGrid, x0: number, y0: number, x1: number, y1: number, radius = 3, targetK = 400): RadiatorInstance {
  return placeRadiatorInstance(grid, { x0, y0, x1, y1, radius, targetK });
}

describe('radiators', () => {
  beforeEach(() => {
    resetRadiatorIds();
  });

  it('exposes a positive radiation magnitude shared by every placed radiator', () => {
    expect(RADIATOR_WATTS).toBeGreaterThan(0);
  });

  it('stamps reach and target onto every cell of its one-cell-wide line, and nothing beside it', () => {
    const grid = new SimGrid(20, 20);
    place(grid, 4, 10, 8, 10);

    for (let x = 4; x <= 8; x++) {
      expect(grid.radiatorRadius[grid.index(x, 10)]).toBe(3);
      expect(grid.radiatorTargetK[grid.index(x, 10)]).toBe(400);
    }
    expect(grid.radiatorRadius[grid.index(6, 11)]).toBe(0);
    expect(grid.radiatorRadius[grid.index(3, 10)]).toBe(0);
  });

  it('moves as a whole: the old cells stop radiating, the new ones start', () => {
    const grid = new SimGrid(20, 20);
    const instance = place(grid, 4, 10, 8, 10);

    moveRadiatorInstance(grid, [instance], instance, 0, 5);

    expect(grid.radiatorRadius[grid.index(6, 10)]).toBe(0);
    expect(grid.radiatorRadius[grid.index(6, 15)]).toBe(3);
    expect(instance.y0).toBe(15);
  });

  it('drags one end without moving the other', () => {
    const grid = new SimGrid(20, 20);
    const instance = place(grid, 4, 10, 8, 10);

    moveRadiatorEndpoint(grid, [instance], instance, 1, 8, 16);

    expect(instance.x0).toBe(4);
    expect(instance.y0).toBe(10);
    expect(instance.y1).toBe(16);
    expect(grid.radiatorRadius[grid.index(4, 10)]).toBe(3);
    expect(grid.radiatorRadius[grid.index(8, 16)]).toBe(3);
    expect(grid.radiatorRadius[grid.index(7, 10)]).toBe(0); // no longer on the line
  });

  it('an edit re-stamps the line in place, live', () => {
    const grid = new SimGrid(20, 20);
    const instance = place(grid, 4, 10, 8, 10);

    updateRadiatorInstance(grid, instance, 7, 250);

    expect(grid.radiatorRadius[grid.index(6, 10)]).toBe(7);
    expect(grid.radiatorTargetK[grid.index(6, 10)]).toBe(250);
  });

  it('moving one line off another leaves the crossing cell radiating', () => {
    const grid = new SimGrid(20, 20);
    const across = place(grid, 2, 10, 18, 10, 3, 400);
    const down = place(grid, 10, 2, 10, 18, 5, 500);
    // The newer line owns the crossing while both are on it.
    expect(grid.radiatorRadius[grid.index(10, 10)]).toBe(5);

    moveRadiatorInstance(grid, [across, down], down, 4, 0);

    expect(grid.radiatorRadius[grid.index(10, 10)]).toBe(3); // handed back to the horizontal line
    expect(grid.radiatorRadius[grid.index(10, 4)]).toBe(0); // the vertical line has left
  });

  it('an instance survives partial erasure and dies with its last cell', () => {
    const grid = new SimGrid(20, 20);
    const instance = place(grid, 4, 10, 8, 10);
    const instances = [instance];

    grid.radiatorRadius[grid.index(6, 10)] = 0;
    expect(pruneErasedRadiators(grid, instances)).toHaveLength(1);

    for (let x = 4; x <= 8; x++) grid.radiatorRadius[grid.index(x, 10)] = 0;
    expect(pruneErasedRadiators(grid, instances)).toHaveLength(0);
  });
});
