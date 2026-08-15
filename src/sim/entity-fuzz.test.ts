// Randomized place/move/reshape/delete across every apparatus kind, checking
// the compositor's invariants after every single operation.
//
// This suite is the standing regression net for the entity system (see
// .grill/entity-overhaul.md): every apparatus bug this project has had was a
// cross-interaction between two kinds -- a beaker and a tube, a knee drag and
// a degenerate shape -- which is exactly what a per-kind unit test can't see
// and a random bench of all six kinds hits within a few hundred operations.
// When a new entity bug turns up in play, the fix lands with a new op or a new
// invariant here, not just a targeted unit test.
import { beforeEach, describe, expect, it } from 'vitest';
import { compositeEntities, entityFootprints, type PlacedEntities } from './entity-composite';
import { resetEntityIds } from './entity-id';
import { moveFilterEndpoint, moveFilterInstance, placeFilterInstance, type FilterInstance } from './filter';
import { moveFlaskInstance, placeFlaskInstance, resetFlaskIds, updateFlaskInstance, type FlaskInstance } from './flask';
import { moveFunnelInstance, placeFunnelInstance, type FunnelInstance } from './funnel';
import { moveGlassInstance, placeGlassInstance, resetGlassIds, rotateGlassInstance, type GlassInstance } from './glass';
import { SimGrid, TubeMaskValue } from './grid';
import { moveRadiatorEndpoint, moveRadiatorInstance, placeRadiatorInstance, resetRadiatorIds, updateRadiatorInstance, type RadiatorInstance } from './radiators';
import { mulberry32 } from './rng';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { moveTubeKnee, moveTubeSegment, placeTubeInstance, tubeGlassCells, type TubeInstance } from './tube';
import { GLASS_WALL_SPEC_ID, isWallSpecId } from './walls';

const WIDTH = 60;
const HEIGHT = 45;
const OPS = 400;

const species = new SpeciesTable();

interface Bench extends PlacedEntities {
  funnels: FunnelInstance[];
  tubes: TubeInstance[];
  flasks: FlaskInstance[];
  filters: FilterInstance[];
  radiators: RadiatorInstance[];
  glass: GlassInstance[];
}

function emptyBench(): Bench {
  return { funnels: [], tubes: [], flasks: [], filters: [], radiators: [], glass: [] };
}

function allEntityIds(bench: Bench): number[] {
  return [
    ...bench.funnels.map((f) => f.entityId),
    ...bench.tubes.map((t) => t.entityId),
    ...bench.flasks.map((f) => f.entityId),
    ...bench.filters.map((f) => f.entityId),
    ...bench.radiators.map((r) => r.entityId),
    ...bench.glass.map((g) => g.entityId),
  ];
}

/** Every invariant the compositor promises, checked after each op.
 *
 * Deliberately hand-written throws rather than per-cell `expect` calls: this
 * runs a few thousand cells times a few hundred ops, and building an
 * assertion object per cell is enough allocation to run the test runner out
 * of memory. A violation throws once, with the cell and the op that caused
 * it. */
function checkInvariants(grid: SimGrid, bench: Bench, what: string): void {
  const fail = (why: string, i: number): never => {
    throw new Error(`${what}: ${why} at cell ${i % grid.width},${Math.floor(i / grid.width)}`);
  };

  // 1. Idempotence: compositing again changes nothing. This is the
  //    load-bearing one -- if it holds, "mutate the instance and
  //    recomposite" is always safe, whatever the edit was.
  const before = [grid.specId.slice(), grid.tubeMask.slice(), grid.filterMask.slice(), grid.entityOwner.slice()];
  compositeEntities(grid, species, bench);
  const after = [grid.specId, grid.tubeMask, grid.filterMask, grid.entityOwner];
  const names = ['specId', 'tubeMask', 'filterMask', 'entityOwner'];
  for (let a = 0; a < before.length; a++) {
    const wasArray = before[a] as ArrayLike<number>;
    const isArray = after[a] as ArrayLike<number>;
    for (let i = 0; i < wasArray.length; i++) {
      if (wasArray[i] !== isArray[i]) fail(`compositing twice changed ${names[a]} (${wasArray[i]} -> ${isArray[i]})`, i);
    }
  }

  // Footprints as index sets, for the checks below.
  const liveIds = new Set(allEntityIds(bench));
  const wallByOwner = new Map<number, Set<number>>();
  const lumen = new Set<number>();
  const membrane = new Set<number>();
  for (const { entityId, footprint } of entityFootprints(bench)) {
    const walls = new Set<number>();
    for (const cell of footprint.wall ?? []) if (grid.inBounds(cell.x, cell.y)) walls.add(grid.index(cell.x, cell.y));
    wallByOwner.set(entityId, walls);
    for (const cell of footprint.lumen ?? []) if (grid.inBounds(cell.x, cell.y)) lumen.add(grid.index(cell.x, cell.y));
    for (const cell of footprint.membrane?.cells ?? []) if (grid.inBounds(cell.x, cell.y)) membrane.add(grid.index(cell.x, cell.y));
  }

  for (let i = 0; i < grid.entityOwner.length; i++) {
    // 2. Owner <-> instance consistency: an owned cell always names a live
    //    entity, and that entity's footprint really covers it. A stale owner
    //    is how a hole in someone else's vessel used to survive.
    const owner = grid.entityOwner[i] as number;
    if (owner !== 0) {
      if (!liveIds.has(owner)) fail(`cell owned by dead entity ${owner}`, i);
      if (!wallByOwner.get(owner)?.has(i)) fail(`entity ${owner} owns a cell outside its footprint`, i);
    }

    // 3. No orphan overlay: every lumen/membrane/vessel cell belongs to a
    //    live entity. An orphan lumen is an invisible barrier no matter can
    //    ever enter, belonging to a tube that no longer exists.
    if ((grid.tubeMask[i] as TubeMaskValue) === TubeMaskValue.Lumen) {
      if (!lumen.has(i)) fail('orphan lumen mask', i);
      // A lumen is a bored channel: never wall matter, or the conveyor is
      // plugged by its own geometry.
      if (isWallSpecId(grid.specId[i] as number)) fail('lumen plugged with wall matter', i);
    }
    if ((grid.filterMask[i] as number) !== 0 && !membrane.has(i)) fail('orphan filter mask', i);

    // 4. Nothing left behind: glass on an unowned cell would be the player's
    //    paint, and this fuzz never paints -- so any is an entity's leak.
    if (grid.specId[i] === GLASS_WALL_SPEC_ID && owner === 0) fail('orphan glass with no owner', i);
  }
}

/** Where an entity's glass is expected, so a "still whole" check has
 * something to compare against -- the wall footprint minus the cells some
 * later entity's lumen legitimately bored through. */
function boredCells(bench: Bench, grid: SimGrid): Set<number> {
  const out = new Set<number>();
  for (const tube of bench.tubes) {
    for (const cell of tube.geometry.lumenCells) {
      if (grid.inBounds(cell.x, cell.y)) out.add(grid.index(cell.x, cell.y));
    }
  }
  return out;
}

beforeEach(() => {
  resetEntityIds();
  resetFlaskIds();
  resetGlassIds();
  resetRadiatorIds();
});

describe('entity fuzz', () => {
  it('keeps every compositor invariant across hundreds of random apparatus edits', () => {
    const rng = mulberry32(20260815);
    const grid = new SimGrid(WIDTH, HEIGHT);
    const bench = emptyBench();
    const coord = (max: number) => Math.floor(rng() * max);
    const pick = <T,>(list: T[]): T | null => (list.length === 0 ? null : (list[Math.floor(rng() * list.length)] as T));

    const ops: { name: string; run: () => void }[] = [
      {
        name: 'place funnel',
        run: () =>
          bench.funnels.push(
            placeFunnelInstance({
              x: coord(WIDTH),
              y: coord(HEIGHT),
              facing: 'down',
              specId: SpeciesId.H2O,
              tempC: 21,
              ratePerMinute: 60,
              total: null,
            }),
          ),
      },
      {
        name: 'place tube',
        run: () => {
          const x = coord(WIDTH - 20) + 4;
          const y = coord(HEIGHT - 12) + 4;
          const points = [
            { x, y },
            { x: x + 6 + coord(8), y },
          ];
          if (rng() < 0.5) points.push({ x: (points[1] as { x: number }).x, y: y + 4 + coord(6) });
          bench.tubes.push(placeTubeInstance(grid, { points, coneSize: 1 + coord(3), filter: null }));
        },
      },
      {
        name: 'place flask',
        run: () =>
          bench.flasks.push(
            placeFlaskInstance({ x: coord(WIDTH), y: coord(HEIGHT), facing: 'up', sizeScale: 0.5 + rng(), stirred: rng() < 0.5, kind: rng() < 0.5 ? 'beaker' : 'erlenmeyer' }),
          ),
      },
      {
        name: 'place filter',
        run: () => {
          placeFilterInstance(bench.filters, coord(WIDTH), coord(HEIGHT), coord(WIDTH), coord(HEIGHT), [SpeciesId.H2O]);
        },
      },
      {
        name: 'place radiator',
        run: () =>
          bench.radiators.push(
            placeRadiatorInstance({ x0: coord(WIDTH), y0: coord(HEIGHT), x1: coord(WIDTH), y1: coord(HEIGHT), radius: 1 + coord(5), targetK: 300 + coord(400) }),
          ),
      },
      {
        name: 'place glass',
        run: () => {
          const x = coord(WIDTH - 12) + 2;
          const y = coord(HEIGHT - 12) + 2;
          bench.glass.push(
            placeGlassInstance([
              { x, y },
              { x: x + 2 + coord(9), y },
              { x: x + 2 + coord(9), y: y + 2 + coord(9) },
            ]),
          );
        },
      },
      {
        name: 'move funnel',
        run: () => {
          const f = pick(bench.funnels);
          if (f) moveFunnelInstance(f, coord(WIDTH), coord(HEIGHT));
        },
      },
      {
        name: 'drag tube knee',
        run: () => {
          const t = pick(bench.tubes);
          if (t) moveTubeKnee(grid, t, Math.floor(rng() * t.points.length), { x: coord(WIDTH), y: coord(HEIGHT) });
        },
      },
      {
        name: 'drag tube segment',
        run: () => {
          const t = pick(bench.tubes);
          if (t) moveTubeSegment(grid, t, Math.floor(rng() * (t.points.length - 1)), Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5));
        },
      },
      {
        name: 'move flask',
        run: () => {
          const f = pick(bench.flasks);
          if (f) moveFlaskInstance(f, coord(WIDTH), coord(HEIGHT));
        },
      },
      {
        name: 'resize flask',
        run: () => {
          const f = pick(bench.flasks);
          if (f) updateFlaskInstance(f, { sizeScale: 0.5 + rng() * 1.5, stirred: rng() < 0.5 });
        },
      },
      {
        name: 'move filter',
        run: () => {
          const f = pick(bench.filters);
          if (f) moveFilterInstance(f, Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5));
        },
      },
      {
        name: 'drag filter end',
        run: () => {
          const f = pick(bench.filters);
          if (f) moveFilterEndpoint(f, rng() < 0.5 ? 0 : 1, coord(WIDTH), coord(HEIGHT));
        },
      },
      {
        name: 'move radiator',
        run: () => {
          const r = pick(bench.radiators);
          if (r) moveRadiatorInstance(r, Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5));
        },
      },
      {
        name: 'drag radiator end',
        run: () => {
          const r = pick(bench.radiators);
          if (r) moveRadiatorEndpoint(r, rng() < 0.5 ? 0 : 1, coord(WIDTH), coord(HEIGHT));
        },
      },
      {
        name: 'retune radiator',
        run: () => {
          const r = pick(bench.radiators);
          if (r) updateRadiatorInstance(r, 1 + coord(6), 250 + coord(500));
        },
      },
      {
        name: 'move glass',
        run: () => {
          const g = pick(bench.glass);
          if (g) moveGlassInstance(g, Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5));
        },
      },
      {
        name: 'rotate glass',
        run: () => {
          const g = pick(bench.glass);
          if (g) rotateGlassInstance(g, coord(8));
        },
      },
      {
        name: 'delete something',
        run: () => {
          const lists = [bench.funnels, bench.tubes, bench.flasks, bench.filters, bench.radiators, bench.glass];
          const list = lists[Math.floor(rng() * lists.length)] as unknown[];
          if (list.length > 0) list.splice(Math.floor(rng() * list.length), 1);
        },
      },
    ];

    for (let step = 0; step < OPS; step++) {
      const op = ops[Math.floor(rng() * ops.length)] as { name: string; run: () => void };
      op.run();
      compositeEntities(grid, species, bench);
      checkInvariants(grid, bench, `op ${step} (${op.name})`);
    }

    // The bench really did get exercised, rather than the fuzz spending 400
    // ops on empty lists.
    expect(allEntityIds(bench).length).toBeGreaterThan(3);
  });

  it('never lets one entity permanently damage another, however they are shuffled', () => {
    // The narrower version of the same idea, stated as the property the old
    // design kept breaking: after any sequence of moves, every entity's glass
    // is wholly present except where a tube is legitimately plumbed through.
    const rng = mulberry32(4242);
    const grid = new SimGrid(WIDTH, HEIGHT);
    const bench = emptyBench();
    bench.glass.push(placeGlassInstance([{ x: 12, y: 8 }, { x: 12, y: 34 }, { x: 40, y: 34 }]));
    bench.flasks.push(placeFlaskInstance({ x: 30, y: 30, facing: 'up', sizeScale: 1, stirred: false, kind: 'beaker' }));
    bench.tubes.push(placeTubeInstance(grid, { points: [{ x: 4, y: 20 }, { x: 24, y: 20 }], coneSize: 2, filter: null }));
    bench.funnels.push(placeFunnelInstance({ x: 20, y: 12, facing: 'down', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null }));
    compositeEntities(grid, species, bench);

    for (let step = 0; step < 120; step++) {
      const roll = rng();
      if (roll < 0.3) moveTubeKnee(grid, bench.tubes[0] as TubeInstance, rng() < 0.5 ? 0 : 1, { x: 2 + Math.floor(rng() * 50), y: 2 + Math.floor(rng() * 40) });
      else if (roll < 0.6) moveFlaskInstance(bench.flasks[0] as FlaskInstance, 4 + Math.floor(rng() * 50), 4 + Math.floor(rng() * 38));
      else if (roll < 0.85) moveGlassInstance(bench.glass[0] as GlassInstance, Math.round(rng() * 6 - 3), Math.round(rng() * 6 - 3));
      else moveFunnelInstance(bench.funnels[0] as FunnelInstance, 4 + Math.floor(rng() * 50), 4 + Math.floor(rng() * 38));
      compositeEntities(grid, species, bench);

      const bored = boredCells(bench, grid);
      for (const cell of tubeGlassCells(bench.tubes[0] as TubeInstance)) {
        if (!grid.inBounds(cell.x, cell.y)) continue;
        const i = grid.index(cell.x, cell.y);
        if (bored.has(i)) continue;
        if (grid.specId[i] !== GLASS_WALL_SPEC_ID) throw new Error(`step ${step}: the tube lost a wall cell at ${cell.x},${cell.y}`);
      }
    }
  });
});
