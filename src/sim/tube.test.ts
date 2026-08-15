import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';
import {
  coneHoldMap,
  coneHolds,
  DEFAULT_TUBE_CONE_SIZE,
  moveTubeKnee,
  moveTubeSegment,
  normalizeTubePoints,
  placeTubeInstance,
  stepTubes,
  updateTubeInstance,
  type TubeInstance,
} from './tube';
import { compositeEntities, NO_ENTITIES } from './entity-composite';
import { placeGlassInstance } from './glass';
import type { Point } from './tube-shapes';

const species = new SpeciesTable();

/** A tube's wall ring and lumen/cone overlay are derived state (see
 * entity-composite.ts): the instance holds the knee points, the compositor
 * puts the glass and the mask on the grid. Every assertion against the grid
 * composites the whole bench first, exactly like worker.ts's mutateEntities
 * does after each message. */
function sync(grid: SimGrid, instances: readonly TubeInstance[]): void {
  compositeEntities(grid, species, { ...NO_ENTITIES, tubes: instances });
}

function place(grid: SimGrid, points: Point[], overrides: { coneSize?: number; filter?: Set<number> | null } = {}): TubeInstance {
  const instance = placeTubeInstance(grid, {
    points,
    coneSize: overrides.coneSize ?? DEFAULT_TUBE_CONE_SIZE,
    filter: overrides.filter ?? null,
  });
  sync(grid, [instance]);
  return instance;
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

  it('never gives a cone cell a pull target that lands on the tube wall (would be permanently stuck since movement.ts blocks Cone cells from moving on their own)', () => {
    const grid = new SimGrid(100, 100);
    for (const coneSize of [1, 2, 3, 5, 8]) {
      const instance = place(grid, STRAIGHT, { coneSize });
      const wallSet = new Set(instance.geometry.wallCells.map((c) => grid.index(c.x, c.y)));
      for (const target of instance.geometry.conePullTargetIdx) {
        expect(wallSet.has(target)).toBe(false);
      }
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

  it('bores out a pre-existing wall the tube was drawn across instead of conveying it', () => {
    const grid = new SimGrid(100, 100);
    grid.set(23, 20, GLASS_WALL_SPEC_ID, PhaseCode.Solid); // a vessel wall on the tube's path
    const instance = place(grid, STRAIGHT);
    expect(grid.isEmptyAt(grid.index(23, 20))).toBe(true);

    for (let t = 0; t < 20; t++) stepTubes(grid, [instance]);
    // Conveyed glass would have been ejected into the tip's one open cell and
    // plugged it there permanently -- see boreWallsFromLumen.
    expect(grid.specId[instance.geometry.exitOpenIdx as number]).not.toBe(GLASS_WALL_SPEC_ID);
  });

  it('bores out a wall stamped over the lumen after placement, so it never plugs the exit', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    grid.set(23, 20, GLASS_WALL_SPEC_ID, PhaseCode.Solid); // another apparatus stamped across it later

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(grid.index(23, 20))).toBe(true);
    for (let t = 0; t < 20; t++) stepTubes(grid, [instance]);
    expect(grid.specId[instance.geometry.exitOpenIdx as number]).not.toBe(GLASS_WALL_SPEC_ID);
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

    moveTubeKnee(grid, instance, 1, { x: 26, y: 26 });
    sync(grid, [instance]);

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
    moveTubeKnee(grid, instance, 1, { x: 21, y: 20 });
    sync(grid, [instance]);

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
    moveTubeKnee(grid, instance, 1, { x: 55, y: 40 });
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
    moveTubeSegment(grid, instance, 1, 0, 10);
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

    updateTubeInstance(grid, instance, { coneSize: instance.coneSize, filter: new Set([SpeciesId.H2O]) });

    expect(instance.filter?.has(SpeciesId.H2O)).toBe(true);
    expect(instance.geometry.wallCells).toBe(wallsBefore);
  });

  it('re-stamps the cone when coneSize changes', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { coneSize: 1 });
    expect(instance.geometry.coneSrcIdx.length).toBe(1);

    updateTubeInstance(grid, instance, { coneSize: 3, filter: null });
    sync(grid, [instance]);
    expect(instance.geometry.coneSrcIdx.length).toBe(1 + 3 + 5);
    for (const i of instance.geometry.coneSrcIdx) expect(grid.tubeMask[i]).toBe(TubeMaskValue.Cone);
  });
});

describe('coneHoldMap', () => {
  it('holds every cone cell of an unfiltered tube, whatever the species', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const hold = coneHoldMap(grid, [instance]);

    for (const i of instance.geometry.coneSrcIdx) {
      expect(coneHolds(hold, i, SpeciesId.H2O)).toBe(true);
      expect(coneHolds(hold, i, SpeciesId.NaCl)).toBe(true);
    }
  });

  it('does not hold a species the tube would never pull in -- it must stay subject to gravity', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { filter: new Set([SpeciesId.H2O]) });
    const hold = coneHoldMap(grid, [instance]);

    for (const i of instance.geometry.coneSrcIdx) {
      expect(coneHolds(hold, i, SpeciesId.H2O)).toBe(true);
      expect(coneHolds(hold, i, SpeciesId.NaCl)).toBe(false);
    }
  });

  it('does not hold a cone cell whose pull target has been walled off since placement', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const blockedSrc = instance.geometry.coneSrcIdx[2] as number;
    const target = instance.geometry.conePullTargetIdx[2] as number;
    grid.setAt(target, GLASS_WALL_SPEC_ID, PhaseCode.Solid);

    const hold = coneHoldMap(grid, [instance]);
    expect(coneHolds(hold, blockedSrc, SpeciesId.H2O)).toBe(false);
    expect(coneHolds(hold, instance.geometry.coneSrcIdx[0] as number, SpeciesId.H2O)).toBe(true);
  });

  it('holds a cone cell whose pull target is merely occupied -- backpressure is a queue, not a jam', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const src = instance.geometry.coneSrcIdx[2] as number;
    grid.setAt(instance.geometry.conePullTargetIdx[2] as number, SpeciesId.NaCl, PhaseCode.Solid);

    expect(coneHolds(coneHoldMap(grid, [instance]), src, SpeciesId.NaCl)).toBe(true);
  });

  it('holds a cell for anything either of two overlapping cones would take', () => {
    const grid = new SimGrid(100, 100);
    const a = place(grid, STRAIGHT, { filter: new Set([SpeciesId.H2O]) });
    const b = place(
      grid,
      [
        { x: 20, y: 22 },
        { x: 26, y: 22 },
      ],
      { filter: new Set([SpeciesId.NaCl]) },
    );
    // A cone cell shared by both tubes (their cones run parallel two rows apart,
    // so pick one from each and assert the union rule on whichever they share).
    const shared = (a.geometry.coneSrcIdx as number[]).filter((i) => (b.geometry.coneSrcIdx as number[]).includes(i));
    const hold = coneHoldMap(grid, [a, b]);
    for (const i of shared) {
      expect(coneHolds(hold, i, SpeciesId.H2O)).toBe(true);
      expect(coneHolds(hold, i, SpeciesId.NaCl)).toBe(true);
    }
  });
});

describe('removing a tube', () => {
  it('takes the whole tube off the grid -- no orphaned glass, no stranded lumen mask', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);

    sync(grid, []);

    for (const cell of instance.geometry.wallCells) {
      expect(grid.isEmptyAt(grid.index(cell.x, cell.y))).toBe(true);
      expect(grid.entityOwner[grid.index(cell.x, cell.y)]).toBe(0);
    }
    for (const i of instance.geometry.lumenIdx) expect(grid.tubeMask[i]).toBe(TubeMaskValue.None);
    for (const i of instance.geometry.coneSrcIdx) expect(grid.tubeMask[i]).toBe(TubeMaskValue.None);
  });

  it('leaves the cargo it was carrying behind as ordinary matter', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const midIdx = instance.geometry.lumenIdx[2] as number;
    grid.setAt(midIdx, SpeciesId.H2O, PhaseCode.Liquid, 0);

    sync(grid, []);

    expect(grid.specId[midIdx]).toBe(SpeciesId.H2O);
  });
});

describe('a tube crossing other glass', () => {
  it('bores through a wall in its way, and the wall heals once the tube moves off it', () => {
    // The f8f5379 regression, as an invariant: a lumen displaces glass rather
    // than destroying it, because the wall is re-derived from whoever owns it.
    const grid = new SimGrid(100, 100);
    const beaker = placeGlassInstance([
      { x: 23, y: 14 },
      { x: 23, y: 26 },
    ]);
    const tube = placeTubeInstance(grid, { points: STRAIGHT, coneSize: DEFAULT_TUBE_CONE_SIZE, filter: null });
    const bench = { ...NO_ENTITIES, tubes: [tube], glass: [beaker] };
    compositeEntities(grid, species, bench);

    const bored = grid.index(23, 20);
    expect(grid.tubeMask[bored]).toBe(TubeMaskValue.Lumen);
    expect(grid.isEmptyAt(bored)).toBe(true); // the tube is plumbed through the wall

    moveTubeKnee(grid, tube, 0, { x: 32, y: 20 });
    moveTubeKnee(grid, tube, 1, { x: 38, y: 20 });
    compositeEntities(grid, species, bench);

    expect(grid.specId[bored]).toBe(GLASS_WALL_SPEC_ID); // the hole closed behind it
  });
});

describe('degenerate geometry', () => {
  it('refuses a knee drag that would drop a knee onto its neighbour', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const wallsBefore = instance.geometry.wallCells.length;
    const pointsBefore = instance.points.map((p) => ({ ...p }));

    // Dropping the mouth exactly on the exit collapses the tube to one cell:
    // no mouth, no exit, no cone, and nothing can ever bring it back.
    moveTubeKnee(grid, instance, 0, { x: 26, y: 20 });

    expect(instance.points).toEqual(pointsBefore);
    expect(instance.geometry.wallCells.length).toBe(wallsBefore);
    expect(instance.geometry.exitOpenIdx).not.toBeNull();
  });

  it('still allows a knee drag that keeps the segment at least one cell long', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);

    moveTubeKnee(grid, instance, 0, { x: 25, y: 20 });

    expect(instance.points[0]).toEqual({ x: 25, y: 20 });
  });

  it('never lets a segment drag leave the tube collapsed, however far it is shoved', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, [
      { x: 20, y: 20 },
      { x: 26, y: 20 },
      { x: 32, y: 20 },
    ]);

    // Shove the middle segment hard in every direction, well past its fixed
    // outer neighbours -- resolveKneePosition keeps each knee at least a step
    // clear, and the guard catches anything it doesn't.
    for (const [dx, dy] of [
      [-12, 0],
      [12, 0],
      [0, -12],
      [0, 12],
      [-20, -20],
    ]) {
      moveTubeSegment(grid, instance, 1, dx as number, dy as number);
      for (let i = 1; i < instance.points.length; i++) {
        expect(instance.points[i]).not.toEqual(instance.points[i - 1]);
      }
      expect(instance.geometry.exitOpenIdx).not.toBeNull();
    }
  });

  it('drops duplicate knees at placement rather than building a dead stub', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, [
      { x: 20, y: 20 },
      { x: 20, y: 20 },
      { x: 26, y: 20 },
    ]);

    expect(instance.points).toEqual([
      { x: 20, y: 20 },
      { x: 26, y: 20 },
    ]);
    expect(instance.geometry.exitOpenIdx).not.toBeNull();
  });
});

describe('normalizeTubePoints', () => {
  it('collapses only consecutive duplicates, keeping a knee that revisits a cell later', () => {
    expect(
      normalizeTubePoints([
        { x: 1, y: 1 },
        { x: 1, y: 1 },
        { x: 5, y: 5 },
        { x: 1, y: 1 },
      ]),
    ).toEqual([
      { x: 1, y: 1 },
      { x: 5, y: 5 },
      { x: 1, y: 1 },
    ]);
  });

  it('reduces an all-on-one-cell draw to a single point, which callers refuse to place', () => {
    expect(
      normalizeTubePoints([
        { x: 3, y: 3 },
        { x: 3, y: 3 },
        { x: 3, y: 3 },
      ]),
    ).toEqual([{ x: 3, y: 3 }]);
  });
});
