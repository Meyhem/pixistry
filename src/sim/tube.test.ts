import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';
import {
  moveTubeInstance,
  moveTubeKnee,
  normalizeTubePoints,
  placeTubeInstance,
  stepTubes,
  updateTubeInstance,
  type TubeInstance,
} from './tube';
import { compositeEntities } from './entity-composite';
import { placeGlassInstance } from './glass';
import type { Point } from './tube-shapes';

const species = new SpeciesTable();

/** A tube's wall ring and lumen/cone overlay are derived state (see
 * entity-composite.ts): the instance holds the knee points, the compositor
 * puts the glass and the mask on the grid. Every assertion against the grid
 * composites the whole bench first, exactly like worker.ts's mutateEntities
 * does after each message. */
function sync(grid: SimGrid, instances: readonly TubeInstance[]): void {
  compositeEntities(grid, species, instances);
}

function place(grid: SimGrid, points: Point[], overrides: { filter?: Set<number> | null } = {}): TubeInstance {
  const instance = placeTubeInstance(grid, { points, filter: overrides.filter ?? null });
  sync(grid, [instance]);
  return instance;
}

const STRAIGHT: Point[] = [
  { x: 20, y: 20 },
  { x: 26, y: 20 },
];

/** The three cells at one end of a placed tube, as grid indices -- what the
 * mouth draws from and the exit discharges into. */
function mouthAperture(instance: TubeInstance): number[] {
  return [...instance.geometry.mouthApertureIdx];
}

function exitAperture(instance: TubeInstance): number[] {
  return [...instance.geometry.exitApertureIdx];
}

/** Cells of the channel at a given distance from the exit -- the natural way
 * to talk about "one step along" now that the channel is 3 wide and cargo
 * follows a distance field rather than a single file. */
function bandAtDistance(instance: TubeInstance, distance: number): number[] {
  const { lumenIdx, exitDistance } = instance.geometry;
  return lumenIdx.filter((_, i) => exitDistance[i] === distance);
}

function occupiedDistances(grid: SimGrid, instance: TubeInstance): number[] {
  const { lumenIdx, exitDistance } = instance.geometry;
  const out: number[] = [];
  lumenIdx.forEach((idx, i) => {
    if (!grid.isEmptyAt(idx)) out.push(exitDistance[i] as number);
  });
  return out.sort((a, b) => a - b);
}

describe('placeTubeInstance', () => {
  it('stamps the wall ring as glass, overwriting whatever was there', () => {
    const grid = new SimGrid(100, 100);
    grid.set(20, 17, SpeciesId.H2O, PhaseCode.Liquid); // sits where a wall cell will land
    const instance = place(grid, STRAIGHT);
    for (const cell of instance.geometry.wallCells) {
      expect(grid.specId[grid.index(cell.x, cell.y)]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('marks every channel cell in the overlay mask, none of them glass', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    for (const i of instance.geometry.lumenIdx) {
      expect(grid.tubeMask[i]).toBe(TubeMaskValue.Lumen);
      expect(grid.specId[i]).not.toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('bores a channel three cells wide', () => {
    const grid = new SimGrid(100, 100);
    place(grid, STRAIGHT);
    // STRAIGHT runs along y=20 from x=20 to x=26, so each column of the run
    // should be open across y=19..21.
    for (let x = 20; x <= 26; x++) {
      for (const y of [19, 20, 21]) {
        expect(grid.tubeMask[grid.index(x, y)]).toBe(TubeMaskValue.Lumen);
      }
    }
  });

  it('leaves exactly three cells open at each end', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    expect(mouthAperture(instance)).toHaveLength(3);
    expect(exitAperture(instance)).toHaveLength(3);
    const open = new Set([...mouthAperture(instance), ...exitAperture(instance)]);
    for (const i of open) expect(grid.specId[i]).not.toBe(GLASS_WALL_SPEC_ID);
  });

  it('never lets the wall ring overlap the channel', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const lumenSet = new Set(instance.geometry.lumenIdx);
    for (const cell of instance.geometry.wallCells) {
      expect(lumenSet.has(grid.index(cell.x, cell.y))).toBe(false);
    }
  });
});

describe('stepTubes: transport', () => {
  it('advances cargo exactly one step toward the exit per tick', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const far = bandAtDistance(instance, 6)[0] as number;
    grid.setAt(far, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);
    expect(occupiedDistances(grid, instance)).toEqual([5]);
    stepTubes(grid, [instance]);
    expect(occupiedDistances(grid, instance)).toEqual([4]);
  });

  it('discharges out of the exit aperture', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const atExit = bandAtDistance(instance, 0)[0] as number;
    grid.setAt(atExit, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(atExit)).toBe(true);
    expect(exitAperture(instance).some((i) => grid.specId[i] === SpeciesId.H2O)).toBe(true);
  });

  it('backs up when the exit is blocked, rather than overwriting what is there', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    for (const i of exitAperture(instance)) grid.setAt(i, SpeciesId.Fe, PhaseCode.Solid, 0);
    for (const i of bandAtDistance(instance, 0)) grid.setAt(i, SpeciesId.H2O, PhaseCode.Liquid, 0);
    const queued = bandAtDistance(instance, 1)[0] as number;
    grid.setAt(queued, SpeciesId.NaCl, PhaseCode.Solid, 0);

    stepTubes(grid, [instance]);

    for (const i of bandAtDistance(instance, 0)) expect(grid.specId[i]).toBe(SpeciesId.H2O); // stuck at the exit
    expect(grid.specId[queued]).toBe(SpeciesId.NaCl); // and the queue behind it can't advance either
    for (const i of exitAperture(instance)) expect(grid.specId[i]).toBe(SpeciesId.Fe); // never overwritten
  });

  it('carries a full stream to the exit without skipping or duplicating', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const loaded = bandAtDistance(instance, 5);
    for (const i of loaded) grid.setAt(i, SpeciesId.H2O, PhaseCode.Liquid, 0);

    for (let t = 0; t < 12; t++) stepTubes(grid, [instance]);

    for (const i of instance.geometry.lumenIdx) expect(grid.isEmptyAt(i)).toBe(true);
    let delivered = 0;
    for (let i = 0; i < grid.specId.length; i++) if (grid.specId[i] === SpeciesId.H2O) delivered++;
    expect(delivered).toBe(loaded.length); // conserved: nothing lost, nothing cloned
  });

  it('carries cargo around a knee', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 30 },
    ]);
    const start = bandAtDistance(instance, Math.max(...instance.geometry.exitDistance.filter(Number.isFinite)))[0] as number;
    grid.setAt(start, SpeciesId.H2O, PhaseCode.Liquid, 0);

    for (let t = 0; t < 40; t++) stepTubes(grid, [instance]);

    for (const i of instance.geometry.lumenIdx) expect(grid.isEmptyAt(i)).toBe(true);
    expect(exitAperture(instance).some((i) => grid.specId[i] === SpeciesId.H2O)).toBe(true);
  });

  it('bores out a pre-existing wall the tube was drawn across instead of conveying it', () => {
    const grid = new SimGrid(100, 100);
    grid.set(23, 20, GLASS_WALL_SPEC_ID, PhaseCode.Solid); // a vessel wall on the tube's path
    const instance = place(grid, STRAIGHT);
    expect(grid.isEmptyAt(grid.index(23, 20))).toBe(true);

    for (let t = 0; t < 20; t++) stepTubes(grid, [instance]);
    // Conveyed glass would have ridden to the exit and plugged an aperture
    // there permanently -- see boreWallsFromLumen.
    for (const i of exitAperture(instance)) expect(grid.specId[i]).not.toBe(GLASS_WALL_SPEC_ID);
  });

  it('bores out a wall painted over the channel after placement, so it never plugs the exit', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    grid.set(23, 20, GLASS_WALL_SPEC_ID, PhaseCode.Solid); // painted across it later

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(grid.index(23, 20))).toBe(true);
  });
});

describe('stepTubes: intake', () => {
  it('swallows matter sitting in a mouth aperture cell', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const at = mouthAperture(instance)[1] as number;
    grid.setAt(at, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);

    expect(grid.isEmptyAt(at)).toBe(true);
    expect(occupiedDistances(grid, instance).length).toBe(1);
  });

  it('reaches one cell past its aperture and takes that too, in a single tick', () => {
    // Mouth cell x=20, aperture x=18, so x=17 is the one cell of reach.
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const beyond = grid.index(17, 20);
    grid.setAt(beyond, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);

    // Reach and intake both run this tick: it's already in the channel, not
    // parked in the aperture waiting for the next one.
    expect(grid.isEmptyAt(beyond)).toBe(true);
    expect(occupiedDistances(grid, instance).length).toBe(1);
  });

  it('reaches exactly one cell -- two cells past the aperture is untouched', () => {
    // The reach is a nudge, not the old suction cone: past that, matter
    // obeys ordinary gravity and the tube takes only what arrives.
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const farther = grid.index(16, 20);
    grid.setAt(farther, SpeciesId.H2O, PhaseCode.Liquid, 0);

    for (let t = 0; t < 10; t++) stepTubes(grid, [instance]);

    expect(grid.specId[farther]).toBe(SpeciesId.H2O);
  });

  it('does not reach for a species outside its filter', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { filter: new Set([SpeciesId.NaCl]) });
    const beyond = grid.index(17, 20);
    grid.setAt(beyond, SpeciesId.H2O, PhaseCode.Liquid, 0);

    for (let t = 0; t < 10; t++) stepTubes(grid, [instance]);

    expect(grid.specId[beyond]).toBe(SpeciesId.H2O);
  });

  it('does not take a species outside its filter', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { filter: new Set([SpeciesId.NaCl]) });
    const at = mouthAperture(instance)[1] as number;
    grid.setAt(at, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);

    expect(grid.specId[at]).toBe(SpeciesId.H2O); // left alone entirely
    expect(occupiedDistances(grid, instance)).toEqual([]);
  });

  it('does take a species on its filter', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT, { filter: new Set([SpeciesId.H2O]) });
    const at = mouthAperture(instance)[1] as number;
    grid.setAt(at, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);
    expect(grid.isEmptyAt(at)).toBe(true);
  });

  it('never sucks in a wall', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const at = mouthAperture(instance)[1] as number;
    grid.setAt(at, GLASS_WALL_SPEC_ID, PhaseCode.Solid, 0);

    stepTubes(grid, [instance]);
    expect(grid.specId[at]).toBe(GLASS_WALL_SPEC_ID);
  });

  it('stalls intake while the channel behind the mouth is full', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    for (const i of instance.geometry.lumenIdx) grid.setAt(i, SpeciesId.Fe, PhaseCode.Solid, 0);
    for (const i of exitAperture(instance)) grid.setAt(i, SpeciesId.NaCl, PhaseCode.Solid, 0);
    const at = mouthAperture(instance)[1] as number;
    grid.setAt(at, SpeciesId.H2O, PhaseCode.Liquid, 0);

    stepTubes(grid, [instance]);

    expect(grid.specId[at]).toBe(SpeciesId.H2O); // never pulled in
  });

  it('chains mouth-to-exit: one tube feeds the next', () => {
    const grid = new SimGrid(100, 100);
    const first = place(grid, [
      { x: 20, y: 20 },
      { x: 30, y: 20 },
    ]);
    // The first tube's band ends at x=31 and it discharges into x=32; the
    // second tube's mouth draws from that same column (its own band starts at
    // x=33), so what one ejects the other swallows.
    const second = placeTubeInstance(grid, { points: [{ x: 34, y: 20 }, { x: 44, y: 20 }], filter: null });
    compositeEntities(grid, species, [first, second]);
    for (const i of bandAtDistance(first, 0)) grid.setAt(i, SpeciesId.H2O, PhaseCode.Liquid, 0);
    const carried = bandAtDistance(first, 0).length;

    for (let t = 0; t < 40; t++) stepTubes(grid, [first, second]);

    let delivered = 0;
    for (const i of exitAperture(second)) if (grid.specId[i] === SpeciesId.H2O) delivered++;
    expect(delivered).toBeGreaterThan(0);
    let total = 0;
    for (let i = 0; i < grid.specId.length; i++) if (grid.specId[i] === SpeciesId.H2O) total++;
    expect(total).toBe(carried);
  });
});

describe('moveTubeKnee / moveTubeInstance', () => {
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

    // Asserted rather than guarded on: an `if` here would pass vacuously the
    // day the geometry changes shape and the cell stays inside the channel.
    expect(new Set(instance.geometry.lumenIdx).has(midIdx)).toBe(false);
    expect(new Set(instance.geometry.wallCells.map((c) => grid.index(c.x, c.y))).has(midIdx)).toBe(false);
    expect(grid.tubeMask[midIdx]).toBe(TubeMaskValue.None);
    expect(grid.specId[midIdx]).toBe(SpeciesId.H2O); // matter itself untouched, just de-flagged
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

  it('moveTubeInstance slides every knee together, preserving the shape exactly', () => {
    const grid = new SimGrid(200, 200);
    const instance = place(grid, [
      { x: 50, y: 50 },
      { x: 60, y: 50 },
      { x: 70, y: 50 },
      { x: 70, y: 60 },
    ]);
    const before = instance.points.map((p) => ({ ...p }));
    moveTubeInstance(grid, instance, 3, -7);
    expect(instance.points).toEqual(before.map((p) => ({ x: p.x + 3, y: p.y - 7 })));
  });
});

describe('updateTubeInstance', () => {
  it('changes the filter without touching geometry', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);
    const wallsBefore = instance.geometry.wallCells;

    updateTubeInstance(instance, { filter: new Set([SpeciesId.H2O]) });

    expect(instance.filter?.has(SpeciesId.H2O)).toBe(true);
    expect(instance.geometry.wallCells).toBe(wallsBefore);
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
    const tube = placeTubeInstance(grid, { points: STRAIGHT, filter: null });
    const bench = [tube, beaker];
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
    // no mouth and no exit, and nothing can ever bring it back.
    moveTubeKnee(grid, instance, 0, { x: 26, y: 20 });

    expect(instance.points).toEqual(pointsBefore);
    expect(instance.geometry.wallCells.length).toBe(wallsBefore);
    expect(instance.geometry.exitApertureIdx.length).toBe(3);
  });

  it('still allows a knee drag that keeps the segment at least one cell long', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, STRAIGHT);

    moveTubeKnee(grid, instance, 0, { x: 25, y: 20 });

    expect(instance.points[0]).toEqual({ x: 25, y: 20 });
  });

  it('never lets an interior knee drag leave the tube collapsed, however far it is shoved', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, [
      { x: 20, y: 20 },
      { x: 26, y: 20 },
      { x: 32, y: 20 },
    ]);

    // Shove the middle knee hard in every direction, including exactly onto
    // its neighbours -- resolveKneePosition keeps each knee at least a step
    // clear, and the degenerate-segment guard catches anything it doesn't.
    for (const raw of [
      { x: 20, y: 20 },
      { x: 32, y: 20 },
      { x: 26, y: 40 },
      { x: 0, y: 0 },
      { x: 90, y: 90 },
    ]) {
      moveTubeKnee(grid, instance, 1, raw);
      for (let i = 1; i < instance.points.length; i++) {
        expect(instance.points[i]).not.toEqual(instance.points[i - 1]);
      }
      expect(instance.geometry.exitApertureIdx.length).toBe(3);
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
    expect(instance.geometry.exitApertureIdx.length).toBe(3);
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
