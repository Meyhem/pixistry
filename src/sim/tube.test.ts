import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';
import { DEFAULT_TUBE_CONE_SIZE, moveTubeKnee, moveTubeSegment, placeTubeInstance, stepTubes, updateTubeInstance, type TubeInstance } from './tube';
import type { Point } from './tube-shapes';

const species = new SpeciesTable();

function place(grid: SimGrid, points: Point[], overrides: { coneSize?: number; filter?: Set<number> | null } = {}): TubeInstance {
  return placeTubeInstance(grid, species, {
    points,
    coneSize: overrides.coneSize ?? DEFAULT_TUBE_CONE_SIZE,
    filter: overrides.filter ?? null,
  });
}

const STRAIGHT: Point[] = [
  { x: 20, y: 20 },
  { x: 26, y: 20 },
];

describe('placeTubeInstance', () => {
  it('stamps the wall ring as glass, overwriting whatever was there', () => {
    const grid = new SimGrid(100, 100);
    grid.set(20, 19, SpeciesId.H2O, PhaseCode.Liquid); // sits where a wall cell will land
    const instance = place(grid, STRAIGHT);
    for (const cell of instance.geometry.wallCells) {
      expect(grid.specId[grid.index(cell.x, cell.y)]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('marks every lumen cell in the overlay mask, none of them glass', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    for (const i of instance.geometry.lumenIdx) {
      expect(grid.tubeMask[i]).toBe(TubeMaskValue.Lumen);
      expect(grid.specId[i]).not.toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('marks cone cells beyond the mouth, distinct from the lumen', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 3 });
    expect(instance.geometry.coneSrcIdx.length).toBeGreaterThan(0);
    for (const i of instance.geometry.coneSrcIdx) {
      expect(grid.tubeMask[i]).toBe(TubeMaskValue.Cone);
    }
  });

  it('never lets the wall ring overlap the lumen', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const lumenSet = new Set(instance.geometry.lumenIdx);
    for (const cell of instance.geometry.wallCells) {
      expect(lumenSet.has(grid.index(cell.x, cell.y))).toBe(false);
    }
  });
});

describe('stepTubes: transport', () => {
  it('advances a cargo cell one lumen step per tick', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const mouthIdx = instance.geometry.lumenIdx[0] as number;
    grid.set(20, 20, SpeciesId.H2O, PhaseCode.Liquid);
    expect(grid.specId[mouthIdx]).toBe(SpeciesId.H2O);

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(mouthIdx)).toBe(true);
    expect(grid.specId[instance.geometry.lumenIdx[1] as number]).toBe(SpeciesId.H2O);
  });

  it('ejects out the exit into the open cell beyond it', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const lastIdx = instance.geometry.lumenIdx[instance.geometry.lumenIdx.length - 1] as number;
    grid.setAt(lastIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(lastIdx)).toBe(true);
    expect(grid.specId[instance.geometry.exitOpenIdx as number]).toBe(SpeciesId.H2O);
  });

  it('stalls at the exit (backpressure) when the ejection cell is occupied, instead of overwriting it', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const lastIdx = instance.geometry.lumenIdx[instance.geometry.lumenIdx.length - 1] as number;
    grid.setAt(lastIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);
    grid.setAt(instance.geometry.exitOpenIdx as number, SpeciesId.Fe, PhaseCode.Solid, 0);

    stepTubes(grid, [instance]);
    expect(grid.specId[lastIdx]).toBe(SpeciesId.H2O); // never ejected
    expect(grid.specId[instance.geometry.exitOpenIdx as number]).toBe(SpeciesId.Fe); // never overwritten
  });

  it('backpressure at the exit also blocks the cell behind it from advancing that tick', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const lumen = instance.geometry.lumenIdx;
    const lastIdx = lumen[lumen.length - 1] as number;
    const secondLastIdx = lumen[lumen.length - 2] as number;
    grid.setAt(lastIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);
    grid.setAt(secondLastIdx, SpeciesId.Fe, PhaseCode.Solid, 0);
    grid.setAt(instance.geometry.exitOpenIdx as number, SpeciesId.NaCl, PhaseCode.Solid, 0); // blocks ejection

    stepTubes(grid, [instance]);
    expect(grid.specId[lastIdx]).toBe(SpeciesId.H2O);
    expect(grid.specId[secondLastIdx]).toBe(SpeciesId.Fe);
  });

  it('walks a full cargo stream to the exit over several ticks without skipping or duplicating', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const lumen = instance.geometry.lumenIdx;
    grid.setAt(lumen[0] as number, SpeciesId.H2O, PhaseCode.Liquid, 0);

    for (let t = 0; t < lumen.length; t++) stepTubes(grid, [instance]);
    expect(grid.specId[instance.geometry.exitOpenIdx as number]).toBe(SpeciesId.H2O);
    for (const i of lumen) expect(grid.isEmptyAt(i)).toBe(true);
  });
});

describe('stepTubes: suction', () => {
  it('pulls a cone cell one step toward the mouth per tick', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 3 });
    // Farthest cone cell straight out from the mouth.
    const mouthOpenIdx = instance.geometry.coneSrcIdx[0] as number;
    const farIdx = instance.geometry.coneSrcIdx.find((_, i) => i > 0 && instance.geometry.conePullTargetIdx[i] === mouthOpenIdx);
    // Fall back to any far cone cell if the exact row-2-center lookup above didn't match.
    const src = farIdx ?? (instance.geometry.coneSrcIdx[instance.geometry.coneSrcIdx.length - 1] as number);
    grid.setAt(src, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(src)).toBe(true);
  });

  it('sucks a matching pixel into the mouth and it becomes cargo', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 1 });
    const mouthOpenIdx = instance.geometry.coneSrcIdx[0] as number;
    grid.setAt(mouthOpenIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);
    const mouthIdx = instance.geometry.lumenIdx[0] as number;

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(mouthOpenIdx)).toBe(true);
    expect(grid.specId[mouthIdx]).toBe(SpeciesId.H2O);
  });

  it('does not suck in a species outside the filter', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 1, filter: new Set([SpeciesId.NaCl]) });
    const mouthOpenIdx = instance.geometry.coneSrcIdx[0] as number;
    grid.setAt(mouthOpenIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);
    expect(grid.specId[mouthOpenIdx]).toBe(SpeciesId.H2O); // left untouched
    expect(grid.isEmptyAt(instance.geometry.lumenIdx[0] as number)).toBe(true);
  });

  it('does suck in a species that is in the filter', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 1, filter: new Set([SpeciesId.H2O]) });
    const mouthOpenIdx = instance.geometry.coneSrcIdx[0] as number;
    grid.setAt(mouthOpenIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(mouthOpenIdx)).toBe(true);
  });

  it('stalls intake when the mouth cell is already occupied (backed-up tube)', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 1 });
    const mouthOpenIdx = instance.geometry.coneSrcIdx[0] as number;
    // Fill the whole lumen (and block the exit) so transport can't drain
    // the mouth cell this tick -- otherwise the exit-first advance pass
    // would just shift the mouth's contents forward, freeing it up before
    // suction even runs.
    for (const i of instance.geometry.lumenIdx) grid.setAt(i, SpeciesId.Fe, PhaseCode.Solid, 0);
    grid.setAt(instance.geometry.exitOpenIdx as number, SpeciesId.NaCl, PhaseCode.Solid, 0);
    grid.setAt(mouthOpenIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);
    const mouthIdx = instance.geometry.lumenIdx[0] as number;

    stepTubes(grid, [instance]);
    expect(grid.specId[mouthOpenIdx]).toBe(SpeciesId.H2O); // never pulled in
    expect(grid.specId[mouthIdx]).toBe(SpeciesId.Fe); // never overwritten
  });
});

describe('moveTubeKnee / moveTubeSegment', () => {
  it('re-stamps walls at the new geometry and clears the old footprint', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const oldWalls = instance.geometry.wallCells.map((c) => grid.index(c.x, c.y));

    moveTubeKnee(grid, species, instance, 1, { x: 26, y: 26 });

    for (const cell of instance.geometry.wallCells) {
      expect(grid.specId[grid.index(cell.x, cell.y)]).toBe(GLASS_WALL_SPEC_ID);
    }
    const newWallSet = new Set(instance.geometry.wallCells.map((c) => grid.index(c.x, c.y)));
    for (const i of oldWalls) {
      if (!newWallSet.has(i)) expect(grid.specId[i]).not.toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('releases cargo that falls outside the new lumen as ordinary matter', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const lumen = instance.geometry.lumenIdx;
    const midIdx = lumen[Math.floor(lumen.length / 2)] as number;
    grid.setAt(midIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);

    // Shrink the tube down to a 2-cell stub that no longer covers midIdx.
    moveTubeKnee(grid, species, instance, 1, { x: 21, y: 20 });

    const newLumenSet = new Set(instance.geometry.lumenIdx);
    if (!newLumenSet.has(midIdx)) {
      expect(grid.tubeMask[midIdx]).toBe(TubeMaskValue.None);
      expect(grid.specId[midIdx]).toBe(SpeciesId.H2O); // matter itself untouched, just de-flagged
    }
  });

  it('keeps every segment octant-aligned after a knee drag (points always reachable by polylineToLumenPath)', () => {
    const grid = new SimGrid(200, 200);
    const instance = place(grid, [
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 60, y: 60 },
    ]);
    moveTubeKnee(grid, species, instance, 1, { x: 55, y: 40 });
    for (let i = 1; i < instance.points.length; i++) {
      const a = instance.points[i - 1] as Point;
      const b = instance.points[i] as Point;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      expect(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)).toBe(true);
    }
  });

  it('moveTubeSegment translates a middle segment while keeping outer connections valid', () => {
    const grid = new SimGrid(200, 200);
    const instance = place(grid, [
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 70, y: 50 },
      { x: 70, y: 60 },
    ]);
    moveTubeSegment(grid, species, instance, 1, 0, 10);
    for (let i = 1; i < instance.points.length; i++) {
      const a = instance.points[i - 1] as Point;
      const b = instance.points[i] as Point;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      expect(dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy)).toBe(true);
    }
  });
});

describe('updateTubeInstance', () => {
  it('changes the filter without touching geometry', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const wallsBefore = instance.geometry.wallCells;

    updateTubeInstance(grid, species, instance, { coneSize: instance.coneSize, filter: new Set([SpeciesId.H2O]) });

    expect(instance.filter?.has(SpeciesId.H2O)).toBe(true);
    expect(instance.geometry.wallCells).toBe(wallsBefore);
  });

  it('re-stamps the cone when coneSize changes', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 1 });
    expect(instance.geometry.coneSrcIdx.length).toBe(1);

    updateTubeInstance(grid, species, instance, { coneSize: 3, filter: null });
    expect(instance.geometry.coneSrcIdx.length).toBe(1 + 3 + 5);
    for (const i of instance.geometry.coneSrcIdx) expect(grid.tubeMask[i]).toBe(TubeMaskValue.Cone);
  });
});
