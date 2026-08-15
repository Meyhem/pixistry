import { describe, expect, it } from 'vitest';
import { compositeEntities } from './entity-composite';
import { glassCells, glassPoints, moveGlassInstance, placeGlassInstance, rotateGlassInstance, type GlassInstance } from './glass';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';

const species = new SpeciesTable();

/** A right-angle corner: (10,10) -> (16,10) -> (16,16). Big enough that a
 * quarter turn about its centroid lands somewhere its original cells aren't. */
const CORNER = [
  { x: 10, y: 10 },
  { x: 16, y: 10 },
  { x: 16, y: 16 },
];

/** A polygon's wall cells are derived state (see entity-composite.ts): the
 * instance holds the corner chain, the compositor rasterizes it onto the
 * grid. Every assertion here composites the whole bench first, exactly like
 * worker.ts's mutateEntities does after each message. */
function sync(grid: SimGrid, instances: readonly GlassInstance[]): void {
  compositeEntities(grid, species, instances);
}

function isGlassAt(grid: SimGrid, x: number, y: number): boolean {
  return grid.specId[grid.index(x, y)] === GLASS_WALL_SPEC_ID;
}

describe('glass polygon instances', () => {
  it('stamps every rasterized cell of the drawn chain as glass', () => {
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);

    expect(instance.entityId).toBeGreaterThan(0);
    expect(isGlassAt(grid, 10, 10)).toBe(true);
    expect(isGlassAt(grid, 13, 10)).toBe(true); // mid-segment
    expect(isGlassAt(grid, 16, 16)).toBe(true);
    expect(isGlassAt(grid, 13, 13)).toBe(false); // inside the corner, not on it
  });

  it('moves as a whole: old cells go back to empty, new ones become glass', () => {
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);

    moveGlassInstance(instance, 5, 3);
    sync(grid, [instance]);

    expect(grid.specId[grid.index(10, 10)]).toBe(EMPTY);
    expect(isGlassAt(grid, 15, 13)).toBe(true);
    expect(glassPoints(instance)[0]).toEqual({ x: 15, y: 13 });
  });

  it('leaves whatever the vessel was holding exactly where it was', () => {
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);
    grid.set(13, 13, SpeciesId.H2O, PhaseCode.Liquid, 5);

    moveGlassInstance(instance, 5, 0);
    sync(grid, [instance]);

    expect(grid.specId[grid.index(13, 13)]).toBe(SpeciesId.H2O);
  });

  it('a full turn of 8 steps returns the exact cells it was drawn with', () => {
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);
    const drawn = glassCells(instance).map((c) => `${c.x},${c.y}`).sort();

    for (let step = 1; step <= 8; step++) {
      rotateGlassInstance(instance, step);
      sync(grid, [instance]);
    }

    expect(instance.rotation).toBe(0);
    expect(glassCells(instance).map((c) => `${c.x},${c.y}`).sort()).toEqual(drawn);
    for (const cell of glassCells(instance)) expect(isGlassAt(grid, cell.x, cell.y)).toBe(true);
  });

  it('a quarter turn leaves no glass behind at the old outline', () => {
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);

    rotateGlassInstance(instance, 2);
    sync(grid, [instance]);

    const now = new Set(glassCells(instance).map((c) => `${c.x},${c.y}`));
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (isGlassAt(grid, x, y)) expect(now.has(`${x},${y}`)).toBe(true);
      }
    }
  });

  it('normalizes a rotation past either end of the 8 steps', () => {
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);

    rotateGlassInstance(instance, -1);
    expect(instance.rotation).toBe(7);
    rotateGlassInstance(instance, 8);
    expect(instance.rotation).toBe(0);
  });

  it('moving one polygon off another leaves the crossing cell glass', () => {
    const grid = new SimGrid(40, 40);
    const across = placeGlassInstance([
      { x: 5, y: 10 },
      { x: 25, y: 10 },
    ]);
    const down = placeGlassInstance([
      { x: 15, y: 5 },
      { x: 15, y: 20 },
    ]);
    sync(grid, [across, down]);
    expect(isGlassAt(grid, 15, 10)).toBe(true); // the crossing

    moveGlassInstance(down, 0, 8);
    sync(grid, [across, down]);

    expect(isGlassAt(grid, 15, 10)).toBe(true); // still the horizontal line's cell
    expect(isGlassAt(grid, 15, 6)).toBe(false); // the vertical line has left
  });

  it('heals a hole punched in it: the next composite re-derives every cell', () => {
    // A polygon is indestructible now. Nothing partially erases one (the
    // eraser skips owned glass outright), and even if something clears a cell
    // behind the compositor's back, the wall is derived from the instance --
    // so it comes straight back rather than leaving the vessel with a
    // permanent gap that has to be re-drawn corner by corner.
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);

    grid.clear(13, 10);
    sync(grid, [instance]);

    expect(isGlassAt(grid, 13, 10)).toBe(true);
  });

  it('a removed polygon takes its glass with it and leaves nothing owned', () => {
    const grid = new SimGrid(40, 40);
    const instance = placeGlassInstance(CORNER);
    sync(grid, [instance]);
    const drawn = glassCells(instance);

    sync(grid, []);

    for (const cell of drawn) {
      expect(grid.specId[grid.index(cell.x, cell.y)]).toBe(EMPTY);
      expect(grid.entityOwner[grid.index(cell.x, cell.y)]).toBe(0);
    }
  });
});
