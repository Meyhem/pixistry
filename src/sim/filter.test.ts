import { beforeEach, describe, expect, it } from 'vitest';
import { compositeEntities } from './entity-composite';
import { resetEntityIds } from './entity-id';
import type { AnyEntity } from './entity';
import { filterAllowMap, moveFilterEndpoint, moveFilterInstance, nearestFilter, placeFilterInstance, updateFilterInstance } from './filter';
import { PhaseCode, SimGrid } from './grid';
import { stepMovement } from './movement';
import { placeGlassInstance } from './glass';
import { mulberry32 } from './rng';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID, WALL_PHASE } from './walls';

const speciesTable = new SpeciesTable();

/** A membrane's grid presence is derived state (see entity-composite.ts):
 * the instance holds the line, the compositor claims its cells in
 * grid.entityOwner. Every assertion against the grid composites the whole
 * bench first, exactly like worker.ts's mutateEntities does after each
 * message. */
function sync(grid: SimGrid, entities: readonly AnyEntity[]): void {
  compositeEntities(grid, speciesTable, entities);
}

beforeEach(() => {
  resetEntityIds();
});

describe('filter instances', () => {
  it('claims its cells in entityOwner, so movement can look each line up by owner', () => {
    const grid = new SimGrid(10, 10);
    const a = placeFilterInstance(0, 2, 4, 2, [SpeciesId.H2O]);
    const b = placeFilterInstance(0, 5, 4, 5, [SpeciesId.Fe]);
    sync(grid, [a, b]);

    expect(grid.entityOwner[grid.index(2, 2)]).toBe(a.entityId);
    expect(grid.entityOwner[grid.index(2, 5)]).toBe(b.entityId);
    expect(grid.entityOwner[grid.index(2, 3)]).toBe(0);
  });

  it('never reuses a deleted line\'s id -- a stale message can\'t hit a newer line', () => {
    const grid = new SimGrid(10, 10);
    const first = placeFilterInstance(0, 2, 4, 2, []);
    sync(grid, []);

    const second = placeFilterInstance(0, 6, 4, 6, []);
    expect(second.entityId).toBeGreaterThan(first.entityId);
  });

  it('two lines pass different species -- each cell obeys its own line', () => {
    const species = new SpeciesTable();
    const rng = mulberry32(7);
    // Two 1-wide columns with a glass wall between them (so blocked water
    // can't just spread sideways instead), each with its own membrane one
    // cell down: the left line lets water through, the right one blocks it.
    const grid = new SimGrid(3, 3);
    for (let y = 0; y < 3; y++) grid.set(1, y, GLASS_WALL_SPEC_ID, WALL_PHASE);
    const passes = placeFilterInstance(0, 1, 0, 1, [SpeciesId.H2O]);
    const blocks = placeFilterInstance(2, 1, 2, 1, [SpeciesId.Fe]);
    const filters = [passes, blocks];
    sync(grid, filters);

    grid.set(0, 0, SpeciesId.H2O, PhaseCode.Liquid);
    grid.set(2, 0, SpeciesId.H2O, PhaseCode.Liquid);

    stepMovement(grid, species, rng, 0, filterAllowMap(filters));

    expect(grid.specId[grid.index(0, 1)]).toBe(SpeciesId.H2O); // through the permissive line
    expect(grid.specId[grid.index(2, 0)]).toBe(SpeciesId.H2O); // held up by the strict one
    expect(passes.species.has(SpeciesId.H2O)).toBe(true);
  });

  it("editing one line's allow-list leaves every other line alone", () => {
    const a = placeFilterInstance(0, 2, 4, 2, [SpeciesId.H2O]);
    const b = placeFilterInstance(0, 5, 4, 5, [SpeciesId.H2O]);

    updateFilterInstance(a, [SpeciesId.Fe]);

    const allow = filterAllowMap([a, b]);
    expect([...(allow.get(a.entityId) ?? [])]).toEqual([SpeciesId.Fe]);
    expect([...(allow.get(b.entityId) ?? [])]).toEqual([SpeciesId.H2O]);
  });

  it('moving a line takes its owned cells with it', () => {
    const grid = new SimGrid(10, 10);
    const filter = placeFilterInstance(1, 2, 4, 2, []);
    sync(grid, [filter]);

    moveFilterInstance(filter, 0, 3);
    sync(grid, [filter]);

    expect(grid.entityOwner[grid.index(2, 2)]).toBe(0);
    expect(grid.entityOwner[grid.index(2, 5)]).toBe(filter.entityId);
    expect(filter.y0).toBe(5);
    expect(filter.y1).toBe(5);
  });

  it('removing a line leaves a newer line that crosses it intact', () => {
    const grid = new SimGrid(10, 10);
    const horizontal = placeFilterInstance(0, 4, 8, 4, []);
    const vertical = placeFilterInstance(4, 0, 4, 8, []);
    sync(grid, [horizontal, vertical]);
    // The crossing cell belongs to whichever line was placed later (higher
    // entityId = later in the compositor's z-order).
    expect(grid.entityOwner[grid.index(4, 4)]).toBe(vertical.entityId);

    sync(grid, [vertical]);

    expect(grid.entityOwner[grid.index(4, 4)]).toBe(vertical.entityId);
    expect(grid.entityOwner[grid.index(2, 4)]).toBe(0);
  });

  it('drags one end without moving the other', () => {
    const grid = new SimGrid(20, 20);
    const filter = placeFilterInstance(4, 10, 8, 10, []);
    sync(grid, [filter]);

    moveFilterEndpoint(filter, 1, 8, 16);
    sync(grid, [filter]);

    expect([filter.x0, filter.y0]).toEqual([4, 10]);
    expect([filter.x1, filter.y1]).toEqual([8, 16]);
    expect(grid.entityOwner[grid.index(4, 10)]).toBe(filter.entityId);
    expect(grid.entityOwner[grid.index(8, 16)]).toBe(filter.entityId);
    expect(grid.entityOwner[grid.index(7, 10)]).toBe(0); // no longer on the line
  });

  it('hit-tests the nearest line within the radius, and nothing beyond it', () => {
    const near = placeFilterInstance(0, 5, 10, 5, []);
    const far = placeFilterInstance(0, 15, 10, 15, []);

    expect(nearestFilter([near, far], 5, 6, 2)?.entityId).toBe(near.entityId);
    expect(nearestFilter([near, far], 5, 10, 2)).toBeNull();
  });

  it('leaves wall cells to the wall that stamped them -- a membrane only claims bare cells', () => {
    const grid = new SimGrid(10, 10);
    // A vertical glass wall the membrane line crosses at (4, 4).
    const glass = placeGlassInstance([
      { x: 4, y: 2 },
      { x: 4, y: 6 },
    ]);
    const filter = placeFilterInstance(0, 4, 8, 4, []);
    sync(grid, [glass, filter]);

    // The crossing cell is glass and stays the vessel's: an owned wall cell
    // is eraser-proof and provenance-tracked through its owner (see the
    // compositor's membrane pass), so the membrane must not take it over.
    expect(grid.specId[grid.index(4, 4)]).toBe(GLASS_WALL_SPEC_ID);
    expect(grid.entityOwner[grid.index(4, 4)]).toBe(glass.entityId);
    // The bare cells either side are the membrane's.
    expect(grid.entityOwner[grid.index(3, 4)]).toBe(filter.entityId);
    expect(grid.entityOwner[grid.index(5, 4)]).toBe(filter.entityId);

    // Deleting the vessel hands the vacated cell to the membrane on the next
    // composite -- the line has no permanent hole where the wall stood.
    sync(grid, [filter]);
    expect(grid.specId[grid.index(4, 4)]).not.toBe(GLASS_WALL_SPEC_ID);
    expect(grid.entityOwner[grid.index(4, 4)]).toBe(filter.entityId);
  });
});
