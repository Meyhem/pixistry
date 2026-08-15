import { beforeEach, describe, expect, it } from 'vitest';
import { compositeEntities, NO_ENTITIES } from './entity-composite';
import { SimGrid } from './grid';
import { SpeciesTable } from './species';
import {
  moveRadiatorEndpoint,
  moveRadiatorInstance,
  placeRadiatorInstance,
  RADIATOR_WATTS,
  resetRadiatorIds,
  updateRadiatorInstance,
  type RadiatorInstance,
} from './radiators';

const species = new SpeciesTable();

/** radiatorRadius/radiatorTargetK are derived state (see
 * entity-composite.ts): the instance holds the line and its settings, the
 * compositor writes the per-cell fields the physics reads. Every assertion
 * against the grid composites the whole bench first. */
function sync(grid: SimGrid, radiators: readonly RadiatorInstance[]): void {
  compositeEntities(grid, species, { ...NO_ENTITIES, radiators });
}

function place(grid: SimGrid, x0: number, y0: number, x1: number, y1: number, radius = 3, targetK = 400): RadiatorInstance {
  const instance = placeRadiatorInstance({ x0, y0, x1, y1, radius, targetK });
  sync(grid, [instance]);
  return instance;
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

    moveRadiatorInstance(instance, 0, 5);
    sync(grid, [instance]);

    expect(grid.radiatorRadius[grid.index(6, 10)]).toBe(0);
    expect(grid.radiatorRadius[grid.index(6, 15)]).toBe(3);
    expect(instance.y0).toBe(15);
  });

  it('drags one end without moving the other', () => {
    const grid = new SimGrid(20, 20);
    const instance = place(grid, 4, 10, 8, 10);

    moveRadiatorEndpoint(instance, 1, 8, 16);
    sync(grid, [instance]);

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

    updateRadiatorInstance(instance, 7, 250);
    sync(grid, [instance]);

    expect(grid.radiatorRadius[grid.index(6, 10)]).toBe(7);
    expect(grid.radiatorTargetK[grid.index(6, 10)]).toBe(250);
  });

  it('moving one line off another leaves the crossing cell radiating', () => {
    const grid = new SimGrid(20, 20);
    const across = place(grid, 2, 10, 18, 10, 3, 400);
    const down = place(grid, 10, 2, 10, 18, 5, 500);
    sync(grid, [across, down]);
    // The newer line owns the crossing while both are on it.
    expect(grid.radiatorRadius[grid.index(10, 10)]).toBe(5);

    moveRadiatorInstance(down, 4, 0);
    sync(grid, [across, down]);

    expect(grid.radiatorRadius[grid.index(10, 10)]).toBe(3); // handed back to the horizontal line
    expect(grid.radiatorRadius[grid.index(10, 4)]).toBe(0); // the vertical line has left
  });

  it('a removed line stops radiating everywhere', () => {
    const grid = new SimGrid(20, 20);
    place(grid, 4, 10, 8, 10);

    sync(grid, []);

    for (let x = 4; x <= 8; x++) expect(grid.radiatorRadius[grid.index(x, 10)]).toBe(0);
  });

  it("a scenario's disc-shaped heater radiates from every cell of the disc", () => {
    // Scenario radiators are real tracked instances now (see scenario.ts's
    // applyRadiator): a zero-length line whose emitter width is the disc's
    // radius, which is exactly the blob the old untracked stamp painted.
    const grid = new SimGrid(20, 20);
    const disc = placeRadiatorInstance({ x0: 10, y0: 10, x1: 10, y1: 10, radius: 2, targetK: 500, width: 2 });
    sync(grid, [disc]);

    expect(grid.radiatorRadius[grid.index(10, 10)]).toBe(2);
    expect(grid.radiatorRadius[grid.index(10, 12)]).toBe(2);
    expect(grid.radiatorRadius[grid.index(9, 9)]).toBe(2);
    expect(grid.radiatorRadius[grid.index(10, 13)]).toBe(0); // outside the disc
  });
});
