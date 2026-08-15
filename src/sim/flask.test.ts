import { beforeEach, describe, expect, it } from 'vitest';
import { flaskShapeFor } from './flask-shapes';
import { compositeEntities } from './entity-composite';
import { moveFlaskInstance, placeFlaskInstance, updateFlaskInstance, type FlaskInstance } from './flask';
import { resetEntityIds } from './entity-id';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { stepMovement } from './movement';
import { mulberry32 } from './rng';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';

const species = new SpeciesTable();

/** A flask's glass and vessel interior are derived state (see
 * entity-composite.ts): the instance says what shape it is, the compositor
 * puts it on the grid. Every assertion here composites first, exactly like
 * worker.ts's mutateEntities does after each message. */
function sync(grid: SimGrid, instances: readonly FlaskInstance[]): void {
  compositeEntities(grid, species, instances);
}

function place(grid: SimGrid, overrides: Partial<Parameters<typeof placeFlaskInstance>[0]> = {}): FlaskInstance {
  const instance = placeFlaskInstance({
    x: 50,
    y: 60,
    facing: 'up',
    sizeScale: 1,
    stirred: false,
    flaskKind: 'erlenmeyer',
    ...overrides,
  });
  sync(grid, [instance]);
  return instance;
}

function wallCells(instance: FlaskInstance): { x: number; y: number }[] {
  return flaskShapeFor(instance.facing, instance.sizeScale, instance.flaskKind).cells.map((c) => ({ x: instance.x + c.dx, y: instance.y + c.dy }));
}

function reservoirCells(instance: FlaskInstance): { x: number; y: number }[] {
  return flaskShapeFor(instance.facing, instance.sizeScale, instance.flaskKind).reservoirCells.map((c) => ({
    x: instance.x + c.dx,
    y: instance.y + c.dy,
  }));
}

beforeEach(() => resetEntityIds());

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
    const instance = place(grid, { stirred: true, flaskKind: 'beaker' });
    for (const { x, y } of reservoirCells(instance)) {
      expect(grid.stirrerMask[grid.index(x, y)]).toBe(0);
    }
  });

  it('hands out a distinct id per placement', () => {
    const grid = new SimGrid(160, 100);
    expect(place(grid).entityId).not.toBe(place(grid, { x: 100 }).entityId);
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
    updateFlaskInstance(instance, { flaskKind: 'beaker' });
    sync(grid, [instance]);
    expect(instance.flaskKind).toBe('beaker');
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

describe('sep funnel stopcock', () => {
  function apertureCells(instance: FlaskInstance): { x: number; y: number }[] {
    return flaskShapeFor(instance.facing, instance.sizeScale, instance.flaskKind).apertureCells.map((c) => ({
      x: instance.x + c.dx,
      y: instance.y + c.dy,
    }));
  }

  it('stamps the aperture as owned glass while closed, and leaves it empty while open', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { flaskKind: 'sepfunnel' });
    const aperture = apertureCells(instance);
    expect(aperture.length).toBe(3);
    for (const { x, y } of aperture) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
      expect(grid.entityOwner[grid.index(x, y)]).toBe(instance.entityId);
    }

    updateFlaskInstance(instance, { open: true });
    sync(grid, [instance]);
    for (const { x, y } of aperture) {
      expect(grid.specId[grid.index(x, y)]).toBe(EMPTY);
    }

    // Closing it again reseals -- the compositor re-derives, no unstamping.
    updateFlaskInstance(instance, { open: false });
    sync(grid, [instance]);
    for (const { x, y } of aperture) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('holds liquid indefinitely while closed, and drains it through the 3px stem once opened', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { flaskKind: 'sepfunnel', x: 50, y: 60 });
    const reservoir = reservoirCells(instance);
    for (const { x, y } of reservoir) grid.set(x, y, SpeciesId.H2O, PhaseCode.Liquid);
    const total = reservoir.length;

    const shape = flaskShapeFor(instance.facing, instance.sizeScale, instance.flaskKind);
    const mouthHalfWidth = Math.max(...shape.cells.map((c) => Math.abs(c.dx)));
    const waterBelowOrOutside = () => {
      let count = 0;
      for (let y = 0; y < 100; y++) {
        for (let x = 0; x < 160; x++) {
          if (grid.specId[grid.index(x, y)] !== SpeciesId.H2O) continue;
          if (y > instance.y || Math.abs(x - instance.x) > mouthHalfWidth) count++;
        }
      }
      return count;
    };

    const rng = mulberry32(7);
    for (let tick = 0; tick < 240; tick++) stepMovement(grid, species, rng, tick);
    // Sealed: nothing below the aperture row, nothing past the cone's sides.
    expect(waterBelowOrOutside()).toBe(0);

    updateFlaskInstance(instance, { open: true });
    sync(grid, [instance]);
    for (let tick = 0; tick < 900; tick++) stepMovement(grid, species, rng, tick);
    // Open: the bulk of the charge has passed through the stem.
    expect(waterBelowOrOutside()).toBeGreaterThan(total / 2);
  });
});
