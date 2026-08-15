import { beforeEach, describe, expect, it } from 'vitest';
import { flaskShapeFor } from './flask-shapes';
import { compositeEntities, NO_ENTITIES } from './entity-composite';
import { moveFlaskInstance, placeFlaskInstance, resetFlaskIds, updateFlaskInstance, type FlaskInstance } from './flask';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';

const species = new SpeciesTable();

/** A flask's glass and vessel interior are derived state (see
 * entity-composite.ts): the instance says what shape it is, the compositor
 * puts it on the grid. Every assertion here composites first, exactly like
 * worker.ts's mutateEntities does after each message. */
function sync(grid: SimGrid, instances: readonly FlaskInstance[]): void {
  compositeEntities(grid, species, { ...NO_ENTITIES, flasks: instances });
}

function place(grid: SimGrid, overrides: Partial<Parameters<typeof placeFlaskInstance>[0]> = {}): FlaskInstance {
  const instance = placeFlaskInstance({
    x: 50,
    y: 60,
    facing: 'up',
    sizeScale: 1,
    stirred: false,
    kind: 'erlenmeyer',
    ...overrides,
  });
  sync(grid, [instance]);
  return instance;
}

function wallCells(instance: FlaskInstance): { x: number; y: number }[] {
  return flaskShapeFor(instance.facing, instance.sizeScale, instance.kind).cells.map((c) => ({ x: instance.x + c.dx, y: instance.y + c.dy }));
}

function reservoirCells(instance: FlaskInstance): { x: number; y: number }[] {
  return flaskShapeFor(instance.facing, instance.sizeScale, instance.kind).reservoirCells.map((c) => ({
    x: instance.x + c.dx,
    y: instance.y + c.dy,
  }));
}

beforeEach(() => resetFlaskIds());

describe('placeFlaskInstance', () => {
  it('stamps the outline as glass and leaves the interior open', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
    }
    // The interior is plain empty space -- what keeps matter from hopping
    // diagonally through the glass is movement.ts's corner rule, not a mask
    // over the vessel (which only ever protected stamped flasks).
    for (const { x, y } of reservoirCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).not.toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('claims its glass cells for itself in the owner mask, but not its interior', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    for (const { x, y } of wallCells(instance)) {
      expect(grid.entityOwner[grid.index(x, y)]).toBe(instance.entityId);
    }
    // The interior is open space the vessel merely surrounds -- claiming it
    // would make the eraser refuse to clear the vessel's own contents.
    for (const { x, y } of reservoirCells(instance)) {
      expect(grid.entityOwner[grid.index(x, y)]).toBe(0);
    }
  });

  it('never writes the stirrer overlay, stirred or not', () => {
    // stirrerMask is painted terrain the compositor deliberately doesn't own
    // (see entity-composite.ts); a stirred flask is stirred because
    // stepStirrers unions its interior in, not because it marked the grid.
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { stirred: true, kind: 'beaker' });
    for (const { x, y } of reservoirCells(instance)) {
      expect(grid.stirrerMask[grid.index(x, y)]).toBe(0);
    }
  });

  it('hands out a distinct id per placement', () => {
    const grid = new SimGrid(160, 100);
    expect(place(grid).id).not.toBe(place(grid, { x: 100 }).id);
  });
});

describe('deleting a flask', () => {
  it('clears the glass, leaving the contents alone', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { stirred: true });
    const inside = reservoirCells(instance)[0] as { x: number; y: number };
    grid.set(inside.x, inside.y, SpeciesId.H2O, PhaseCode.Liquid);

    sync(grid, []); // the vessel is gone from the bench

    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(EMPTY);
      expect(grid.entityOwner[grid.index(x, y)]).toBe(0);
    }
    // The contents are not the vessel -- removing it takes glass, not matter.
    expect(grid.specId[grid.index(inside.x, inside.y)]).toBe(SpeciesId.H2O);
  });
});

describe('updateFlaskInstance', () => {
  it('leaves no orphaned glass from the previous footprint when the size shrinks', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { sizeScale: 2 });
    const before = wallCells(instance);

    updateFlaskInstance(instance, { sizeScale: 0.5 });
    sync(grid, [instance]);

    const after = new Set(wallCells(instance).map((c) => `${c.x},${c.y}`));
    for (const { x, y } of before) {
      if (after.has(`${x},${y}`)) continue;
      expect(grid.specId[grid.index(x, y)]).toBe(EMPTY);
    }
    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('swaps the shape in place, re-stamping the new outline', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    updateFlaskInstance(instance, { kind: 'beaker' });
    sync(grid, [instance]);
    expect(instance.kind).toBe('beaker');
    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('records the stirred setting without touching the grid', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    const sample = reservoirCells(instance)[0] as { x: number; y: number };

    updateFlaskInstance(instance, { stirred: true });
    sync(grid, [instance]);
    expect(instance.stirred).toBe(true);
    expect(grid.stirrerMask[grid.index(sample.x, sample.y)]).toBe(0);
  });
});

describe('moveFlaskInstance', () => {
  it('re-stamps at the new anchor and clears the old footprint', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    const before = wallCells(instance);

    moveFlaskInstance(instance, 100, 60);
    sync(grid, [instance]);

    expect(instance.x).toBe(100);
    const after = new Set(wallCells(instance).map((c) => `${c.x},${c.y}`));
    for (const { x, y } of before) {
      if (after.has(`${x},${y}`)) continue;
      expect(grid.specId[grid.index(x, y)]).toBe(EMPTY);
    }
    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('leaves the contents where they are when the anchor has not changed', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    const inside = reservoirCells(instance)[0] as { x: number; y: number };
    grid.set(inside.x, inside.y, SpeciesId.H2O, PhaseCode.Liquid);

    moveFlaskInstance(instance, instance.x, instance.y);
    sync(grid, [instance]);

    expect(grid.specId[grid.index(inside.x, inside.y)]).toBe(SpeciesId.H2O);
  });
});
