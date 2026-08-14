import { describe, expect, it } from 'vitest';
import { editApparatus, refreshTubeOverlays, type PlacedApparatus } from './apparatus-repair';
import { moveFlaskInstance, placeFlaskInstance, resetFlaskIds } from './flask';
import { moveFunnelInstance, placeFunnelInstance } from './funnel';
import { moveGlassInstance, placeGlassInstance, resetGlassIds } from './glass';
import { PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { moveTubeSegment, placeTubeInstance } from './tube';
import type { Point } from './tube-shapes';
import { GLASS_WALL_SPEC_ID } from './walls';

const species = new SpeciesTable();

const EMPTY_BENCH: PlacedApparatus = { funnels: [], tubes: [], flasks: [], glass: [] };

function bench(overrides: Partial<PlacedApparatus>): () => PlacedApparatus {
  return () => ({ ...EMPTY_BENCH, ...overrides });
}

function isGlass(grid: SimGrid, x: number, y: number): boolean {
  return grid.specId[grid.index(x, y)] === GLASS_WALL_SPEC_ID;
}

/** A vertical hand-drawn wall at x=50, the thing every "does the other
 * apparatus survive this edit" case below is drawn across. */
function wallColumn(grid: SimGrid) {
  return placeGlassInstance(grid, species, [
    { x: 50, y: 40 },
    { x: 50, y: 70 },
  ]);
}

const ACROSS_THE_WALL: Point[] = [
  { x: 40, y: 60 },
  { x: 60, y: 60 },
];

describe('editApparatus', () => {
  it('leaves another apparatus\'s glass intact when a tube is dragged off it', () => {
    resetGlassIds();
    const grid = new SimGrid(100, 100);
    const glass = wallColumn(grid);
    const tube = placeTubeInstance(grid, species, { points: ACROSS_THE_WALL, coneSize: 3, filter: null });
    const placed = bench({ glass: [glass], tubes: [tube] });
    // The tube's wall ring sits on the column at y=59/61; its lumen bores y=60.
    expect(isGlass(grid, 50, 59)).toBe(true);
    expect(isGlass(grid, 50, 61)).toBe(true);

    editApparatus(grid, species, placed, { kind: 'tube', id: tube.id }, () => moveTubeSegment(grid, species, tube, 0, 0, 6));

    // Every cell the tube vacated is glass again -- including the one its
    // lumen had bored, which is only ever a hole while a lumen is on it.
    for (let y = 40; y <= 70; y++) {
      if (y >= 65 && y <= 67) continue; // where the tube is now
      expect(isGlass(grid, 50, y)).toBe(true);
    }
  });

  it('leaves a tube\'s glass intact when a flask is dragged across and off it', () => {
    resetFlaskIds();
    const grid = new SimGrid(100, 100);
    const tube = placeTubeInstance(grid, species, { points: ACROSS_THE_WALL, coneSize: 3, filter: null });
    const flask = placeFlaskInstance(grid, species, { x: 50, y: 62, facing: 'up', sizeScale: 1, stirred: false, kind: 'beaker' });
    const placed = bench({ tubes: [tube], flasks: [flask] });
    const ringBefore = tube.geometry.wallCells.map((c) => ({ ...c }));

    editApparatus(grid, species, placed, { kind: 'flask', id: flask.id }, () => moveFlaskInstance(grid, species, flask, 90, 90));

    for (const cell of ringBefore) expect(isGlass(grid, cell.x, cell.y)).toBe(true);
  });

  it('re-bores the lumen the repair just filled back in, so the tube is never left plugged', () => {
    resetGlassIds();
    const grid = new SimGrid(100, 100);
    const glass = wallColumn(grid);
    const tube = placeTubeInstance(grid, species, { points: ACROSS_THE_WALL, coneSize: 3, filter: null });
    const placed = bench({ glass: [glass], tubes: [tube] });

    editApparatus(grid, species, placed, { kind: 'tube', id: tube.id }, () => moveTubeSegment(grid, species, tube, 0, 0, 6));

    // The tube now crosses the column at y=66 -- that one cell stays bored.
    expect(grid.isEmptyAt(grid.index(50, 66))).toBe(true);
    expect(grid.tubeMask[grid.index(50, 66)]).toBe(TubeMaskValue.Lumen);
  });

  it('does not heal a hole the player erased earlier', () => {
    resetGlassIds();
    const grid = new SimGrid(100, 100);
    const glass = wallColumn(grid);
    const funnel = placeFunnelInstance(grid, species, {
      x: 20,
      y: 20,
      facing: 'down',
      specId: SpeciesId.H2O,
      tempC: 20,
      ratePerMinute: 60,
      total: null,
    });
    grid.clear(50, 55); // the eraser, some time before this edit
    const placed = bench({ glass: [glass], funnels: [funnel] });

    editApparatus(grid, species, placed, { kind: 'funnel', id: funnel.id }, () => moveFunnelInstance(grid, species, funnel, 30, 30));

    expect(grid.isEmptyAt(grid.index(50, 55))).toBe(true);
  });

  it('still lets an edit stamp over a neighbour -- only cells that went empty come back', () => {
    resetGlassIds();
    const grid = new SimGrid(100, 100);
    const glass = wallColumn(grid);
    grid.set(50, 50, SpeciesId.H2O, PhaseCode.Liquid); // matter the player put on the wall's cell
    const moved = placeGlassInstance(grid, species, [
      { x: 20, y: 50 },
      { x: 30, y: 50 },
    ]);
    const placed = bench({ glass: [glass, moved] });

    editApparatus(grid, species, placed, { kind: 'glass', id: moved.id }, () => moveGlassInstance(grid, species, [glass, moved], moved, 25, 0));

    // The moved polygon now runs along y=50 through x=45..55, stamping glass
    // over that H2O cell rather than being blocked by it.
    expect(isGlass(grid, 50, 50)).toBe(true);
  });

  it('excludes the edited apparatus itself, so its old footprint really is vacated', () => {
    resetGlassIds();
    const grid = new SimGrid(100, 100);
    const moved = placeGlassInstance(grid, species, [
      { x: 20, y: 50 },
      { x: 30, y: 50 },
    ]);
    const placed = bench({ glass: [moved] });

    editApparatus(grid, species, placed, { kind: 'glass', id: moved.id }, () => moveGlassInstance(grid, species, [moved], moved, 0, 10));

    for (let x = 20; x <= 30; x++) expect(grid.isEmptyAt(grid.index(x, 50))).toBe(true);
    for (let x = 20; x <= 30; x++) expect(isGlass(grid, x, 60)).toBe(true);
  });
});

describe('refreshTubeOverlays', () => {
  it('restores the lumen mask the eraser wiped out from under a tube it did not delete', () => {
    const grid = new SimGrid(100, 100);
    const tube = placeTubeInstance(grid, species, { points: ACROSS_THE_WALL, coneSize: 3, filter: null });
    // What the eraser's brush does to every overlay under it.
    for (const i of tube.geometry.lumenIdx) grid.tubeMask[i] = TubeMaskValue.None;

    refreshTubeOverlays(grid, [tube]);

    for (const i of tube.geometry.lumenIdx) expect(grid.tubeMask[i]).toBe(TubeMaskValue.Lumen);
  });
});

describe('editApparatus: a tube dragged across a vessel', () => {
  it('leaves one open port under the lumen and no trail of holes behind it', () => {
    resetGlassIds();
    const grid = new SimGrid(100, 100);
    const glass = wallColumn(grid);
    const tube = placeTubeInstance(grid, species, { points: ACROSS_THE_WALL, coneSize: 3, filter: null });
    const placed = bench({ glass: [glass], tubes: [tube] });

    // A real drag arrives as a stream of one-cell steps, each its own edit.
    for (let step = 0; step < 8; step++) {
      editApparatus(grid, species, placed, { kind: 'tube', id: tube.id }, () => moveTubeSegment(grid, species, tube, 0, 0, 1));
    }

    const open: number[] = [];
    for (let y = 40; y <= 70; y++) if (!isGlass(grid, 50, y)) open.push(y);
    expect(open).toEqual([68]); // exactly the cell the lumen is standing on
  });
});
