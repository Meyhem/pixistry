import { beforeEach, describe, expect, it } from 'vitest';
import { flaskShapeFor } from './flask-shapes';
import { moveFlaskInstance, placeFlaskInstance, resetFlaskIds, unstampFlask, updateFlaskInstance, type FlaskInstance } from './flask';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';

const species = new SpeciesTable();

function place(grid: SimGrid, overrides: Partial<Parameters<typeof placeFlaskInstance>[2]> = {}): FlaskInstance {
  return placeFlaskInstance(grid, species, {
    x: 50,
    y: 60,
    facing: 'up',
    sizeScale: 1,
    stirred: false,
    kind: 'erlenmeyer',
    ...overrides,
  });
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
  it('stamps the outline as glass and marks the interior as vessel', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
    }
    for (const { x, y } of reservoirCells(instance)) {
      expect(grid.vesselMask[grid.index(x, y)]).toBe(1);
      expect(grid.stirrerMask[grid.index(x, y)]).toBe(0);
    }
  });

  it('stamps the stirrer over the interior only for the stirred variant', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { stirred: true, kind: 'beaker' });
    for (const { x, y } of reservoirCells(instance)) {
      expect(grid.stirrerMask[grid.index(x, y)]).toBe(1);
    }
  });

  it('hands out a distinct id per placement', () => {
    const grid = new SimGrid(160, 100);
    expect(place(grid).id).not.toBe(place(grid, { x: 100 }).id);
  });
});

describe('unstampFlask', () => {
  it('clears the glass and both masks, leaving the contents alone', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { stirred: true });
    const inside = reservoirCells(instance)[0] as { x: number; y: number };
    grid.set(inside.x, inside.y, SpeciesId.H2O, PhaseCode.Liquid);

    unstampFlask(grid, instance);

    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(EMPTY);
    }
    for (const { x, y } of reservoirCells(instance)) {
      expect(grid.vesselMask[grid.index(x, y)]).toBe(0);
      expect(grid.stirrerMask[grid.index(x, y)]).toBe(0);
    }
    // The contents are not the vessel -- unstamping erases glass, not matter.
    expect(grid.specId[grid.index(inside.x, inside.y)]).toBe(SpeciesId.H2O);
  });
});

describe('updateFlaskInstance', () => {
  it('leaves no orphaned glass from the previous footprint when the size shrinks', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid, { sizeScale: 2 });
    const before = wallCells(instance);

    updateFlaskInstance(grid, species, instance, { sizeScale: 0.5 });

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
    updateFlaskInstance(grid, species, instance, { kind: 'beaker' });
    expect(instance.kind).toBe('beaker');
    for (const { x, y } of wallCells(instance)) {
      expect(grid.specId[grid.index(x, y)]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('adds and removes the stirrer overlay when the stirred setting is toggled', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    const sample = reservoirCells(instance)[0] as { x: number; y: number };

    updateFlaskInstance(grid, species, instance, { stirred: true });
    expect(grid.stirrerMask[grid.index(sample.x, sample.y)]).toBe(1);

    updateFlaskInstance(grid, species, instance, { stirred: false });
    expect(grid.stirrerMask[grid.index(sample.x, sample.y)]).toBe(0);
  });
});

describe('moveFlaskInstance', () => {
  it('re-stamps at the new anchor and clears the old footprint', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    const before = wallCells(instance);

    moveFlaskInstance(grid, species, instance, 100, 60);

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

  it('is a no-op when the anchor has not changed', () => {
    const grid = new SimGrid(160, 100);
    const instance = place(grid);
    const inside = reservoirCells(instance)[0] as { x: number; y: number };
    grid.set(inside.x, inside.y, SpeciesId.H2O, PhaseCode.Liquid);

    moveFlaskInstance(grid, species, instance, instance.x, instance.y);

    expect(grid.specId[grid.index(inside.x, inside.y)]).toBe(SpeciesId.H2O);
  });
});
