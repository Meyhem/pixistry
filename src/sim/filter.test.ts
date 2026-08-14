import { describe, expect, it } from 'vitest';
import {
  filterAllowMap,
  moveFilterEndpoint,
  moveFilterInstance,
  nearestFilter,
  placeFilterInstance,
  pruneErasedFilters,
  unstampFilter,
  updateFilterInstance,
  type FilterInstance,
} from './filter';
import { PhaseCode, SimGrid } from './grid';
import { stepMovement } from './movement';
import { mulberry32 } from './rng';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID, WALL_PHASE } from './walls';

function place(grid: SimGrid, filters: FilterInstance[], x0: number, y0: number, x1: number, y1: number, species: number[]): FilterInstance {
  const filter = placeFilterInstance(grid, filters, x0, y0, x1, y1, species);
  if (!filter) throw new Error('expected the line to be placed');
  return filter;
}

describe('filter instances', () => {
  it('stamps its own id into filterMask, so the mask says which line owns a cell', () => {
    const grid = new SimGrid(10, 10);
    const filters: FilterInstance[] = [];
    const a = place(grid, filters, 0, 2, 4, 2, [SpeciesId.H2O]);
    const b = place(grid, filters, 0, 5, 4, 5, [SpeciesId.Fe]);

    expect(a.id).toBe(1);
    expect(b.id).toBe(2);
    expect(grid.filterMask[grid.index(2, 2)]).toBe(a.id);
    expect(grid.filterMask[grid.index(2, 5)]).toBe(b.id);
    expect(grid.filterMask[grid.index(2, 3)]).toBe(0);
  });

  it('reuses the id of an erased line rather than counting up forever', () => {
    const grid = new SimGrid(10, 10);
    const filters: FilterInstance[] = [];
    const first = place(grid, filters, 0, 2, 4, 2, []);
    unstampFilter(grid, first);
    filters.length = 0;

    expect(place(grid, filters, 0, 6, 4, 6, []).id).toBe(first.id);
  });

  it('two lines pass different species -- each cell obeys its own line', () => {
    const species = new SpeciesTable();
    const rng = mulberry32(7);
    // Two 1-wide columns with a glass wall between them (so blocked water
    // can't just spread sideways instead), each with its own membrane one
    // cell down: the left line lets water through, the right one blocks it.
    const grid = new SimGrid(3, 3);
    for (let y = 0; y < 3; y++) grid.set(1, y, GLASS_WALL_SPEC_ID, WALL_PHASE);
    const filters: FilterInstance[] = [];
    const passes = place(grid, filters, 0, 1, 0, 1, [SpeciesId.H2O]);
    place(grid, filters, 2, 1, 2, 1, [SpeciesId.Fe]);

    grid.set(0, 0, SpeciesId.H2O, PhaseCode.Liquid);
    grid.set(2, 0, SpeciesId.H2O, PhaseCode.Liquid);

    stepMovement(grid, species, rng, 0, filterAllowMap(filters));

    expect(grid.specId[grid.index(0, 1)]).toBe(SpeciesId.H2O); // through the permissive line
    expect(grid.specId[grid.index(2, 0)]).toBe(SpeciesId.H2O); // held up by the strict one
    expect(passes.species.has(SpeciesId.H2O)).toBe(true);
  });

  it('editing one line\'s allow-list leaves every other line alone', () => {
    const grid = new SimGrid(10, 10);
    const filters: FilterInstance[] = [];
    const a = place(grid, filters, 0, 2, 4, 2, [SpeciesId.H2O]);
    const b = place(grid, filters, 0, 5, 4, 5, [SpeciesId.H2O]);

    updateFilterInstance(a, [SpeciesId.Fe]);

    const allow = filterAllowMap(filters);
    expect([...(allow.get(a.id) ?? [])]).toEqual([SpeciesId.Fe]);
    expect([...(allow.get(b.id) ?? [])]).toEqual([SpeciesId.H2O]);
  });

  it('moving a line takes its mask cells with it', () => {
    const grid = new SimGrid(10, 10);
    const filters: FilterInstance[] = [];
    const filter = place(grid, filters, 1, 2, 4, 2, []);

    moveFilterInstance(grid, filter, 0, 3);

    expect(grid.filterMask[grid.index(2, 2)]).toBe(0);
    expect(grid.filterMask[grid.index(2, 5)]).toBe(filter.id);
    expect(filter.y0).toBe(5);
    expect(filter.y1).toBe(5);
  });

  it('unstamping a line leaves a newer line that crosses it intact', () => {
    const grid = new SimGrid(10, 10);
    const filters: FilterInstance[] = [];
    const horizontal = place(grid, filters, 0, 4, 8, 4, []);
    const vertical = place(grid, filters, 4, 0, 4, 8, []);
    // The crossing cell belongs to whichever line was drawn last.
    expect(grid.filterMask[grid.index(4, 4)]).toBe(vertical.id);

    unstampFilter(grid, horizontal);

    expect(grid.filterMask[grid.index(4, 4)]).toBe(vertical.id);
    expect(grid.filterMask[grid.index(2, 4)]).toBe(0);
  });

  it('an instance survives a partial erase and dies only with its last cell', () => {
    const grid = new SimGrid(10, 10);
    const filters: FilterInstance[] = [];
    const filter = place(grid, filters, 0, 2, 4, 2, []);

    grid.filterMask[grid.index(2, 2)] = 0; // eraser took one cell out of the middle
    expect(pruneErasedFilters(grid, filters)).toHaveLength(1);

    for (let x = 0; x <= 4; x++) grid.filterMask[grid.index(x, 2)] = 0;
    expect(pruneErasedFilters(grid, filters)).toHaveLength(0);
    expect(filter.id).toBe(1);
  });

  it('drags one end without moving the other', () => {
    const grid = new SimGrid(20, 20);
    const filters: FilterInstance[] = [];
    const filter = place(grid, filters, 4, 10, 8, 10, []);

    moveFilterEndpoint(grid, filter, 1, 8, 16);

    expect([filter.x0, filter.y0]).toEqual([4, 10]);
    expect([filter.x1, filter.y1]).toEqual([8, 16]);
    expect(grid.filterMask[grid.index(4, 10)]).toBe(filter.id);
    expect(grid.filterMask[grid.index(8, 16)]).toBe(filter.id);
    expect(grid.filterMask[grid.index(7, 10)]).toBe(0); // no longer on the line
  });

  it('hit-tests the nearest line within the radius, and nothing beyond it', () => {
    const grid = new SimGrid(20, 20);
    const filters: FilterInstance[] = [];
    const near = place(grid, filters, 0, 5, 10, 5, []);
    place(grid, filters, 0, 15, 10, 15, []);

    expect(nearestFilter(filters, 5, 6, 2)?.id).toBe(near.id);
    expect(nearestFilter(filters, 5, 10, 2)).toBeNull();
  });

  it('a filtered cell whose owning instance is gone blocks everything', () => {
    const species = new SpeciesTable();
    const rng = mulberry32(3);
    const grid = new SimGrid(1, 2);
    grid.set(0, 0, SpeciesId.Fe, PhaseCode.Solid);
    grid.filterMask[grid.index(0, 1)] = 9; // id with no instance behind it

    stepMovement(grid, species, rng, 0, filterAllowMap([]));

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.Fe);
  });
});
