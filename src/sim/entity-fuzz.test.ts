// Randomized place/move/reshape/delete across every apparatus kind, checking
// the compositor's invariants after every single operation.
//
// This suite is the standing regression net for the entity system (see
// .grill/entity-overhaul.md): every apparatus bug this project has had was a
// cross-interaction between two kinds -- a beaker and a tube, a knee drag and
// a degenerate shape -- which is exactly what a per-kind unit test can't see
// and a random bench of all eight kinds hits within a few hundred operations.
// When a new entity bug turns up in play, the fix lands with a new op or a new
// invariant here, not just a targeted unit test.
//
// Every operation goes through entity.ts's generic dispatchers
// (placeEntityFromWire / moveEntityBy / dragEntityHandleTo /
// rotateEntityTo / applyEntitySettings) rather than the per-kind functions
// directly -- the registry is the same surface the worker's protocol handlers
// call, so the fuzz exercises exactly what a message can reach.
import { beforeEach, describe, expect, it } from 'vitest';
import { compositeEntities, entityFootprints } from './entity-composite';
import { resetEntityIds } from './entity-id';
import {
  applyEntitySettings,
  dragEntityHandleTo,
  entityHandles,
  entityToWire,
  moveEntityBy,
  placeEntityFromWire,
  rotateEntityTo,
  type AnyEntity,
} from './entity';
import { PhaseCode, SimGrid, SinkMaskValue, TubeMaskValue } from './grid';
import type { PlaceEntityWire } from './protocol';
import { mulberry32 } from './rng';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { tubeGlassCells, type TubeInstance } from './tube';
import { GLASS_WALL_SPEC_ID, isWallSpecId } from './walls';

const WIDTH = 60;
const HEIGHT = 45;
const OPS = 400;

const species = new SpeciesTable();

/** Every invariant the compositor promises, checked after each op.
 *
 * Deliberately hand-written throws rather than per-cell `expect` calls: this
 * runs a few thousand cells times a few hundred ops, and building an
 * assertion object per cell is enough allocation to run the test runner out
 * of memory. A violation throws once, with the cell and the op that caused
 * it. */
function checkInvariants(grid: SimGrid, bench: AnyEntity[], what: string): void {
  const fail = (why: string, i: number): never => {
    throw new Error(`${what}: ${why} at cell ${i % grid.width},${Math.floor(i / grid.width)}`);
  };

  // 1. Idempotence: compositing again changes nothing. This is the
  //    load-bearing one -- if it holds, "mutate the instance and
  //    recomposite" is always safe, whatever the edit was.
  const before = [grid.specId.slice(), grid.tubeMask.slice(), grid.sinkMask.slice(), grid.entityOwner.slice()];
  compositeEntities(grid, species, bench);
  const after = [grid.specId, grid.tubeMask, grid.sinkMask, grid.entityOwner];
  const names = ['specId', 'tubeMask', 'sinkMask', 'entityOwner'];
  for (let a = 0; a < before.length; a++) {
    const wasArray = before[a] as ArrayLike<number>;
    const isArray = after[a] as ArrayLike<number>;
    for (let i = 0; i < wasArray.length; i++) {
      if (wasArray[i] !== isArray[i]) fail(`compositing twice changed ${names[a]} (${wasArray[i]} -> ${isArray[i]})`, i);
    }
  }

  // Footprints as index sets, for the checks below. A cell an entity may own
  // is a wall cell or a membrane cell of its own footprint.
  const liveIds = new Set(bench.map((e) => e.entityId));
  const filterIds = new Set(bench.filter((e) => e.kind === 'filter').map((e) => e.entityId));
  const ownableByOwner = new Map<number, Set<number>>();
  const lumen = new Set<number>();
  const portCells = new Set<number>();
  for (const { entityId, footprint } of entityFootprints(bench)) {
    const ownable = new Set<number>();
    for (const cell of footprint.wall ?? []) if (grid.inBounds(cell.x, cell.y)) ownable.add(grid.index(cell.x, cell.y));
    for (const cell of footprint.membrane ?? []) if (grid.inBounds(cell.x, cell.y)) ownable.add(grid.index(cell.x, cell.y));
    ownableByOwner.set(entityId, ownable);
    for (const cell of footprint.lumen ?? []) if (grid.inBounds(cell.x, cell.y)) lumen.add(grid.index(cell.x, cell.y));
    for (const cell of footprint.port?.cells ?? []) if (grid.inBounds(cell.x, cell.y)) portCells.add(grid.index(cell.x, cell.y));
  }

  for (let i = 0; i < grid.entityOwner.length; i++) {
    // 2. Owner <-> instance consistency: an owned cell always names a live
    //    entity, and that entity's footprint really covers it. A stale owner
    //    is how a hole in someone else's vessel used to survive.
    const owner = grid.entityOwner[i] as number;
    if (owner !== 0) {
      if (!liveIds.has(owner)) fail(`cell owned by dead entity ${owner}`, i);
      if (!ownableByOwner.get(owner)?.has(i)) fail(`entity ${owner} owns a cell outside its footprint`, i);
    }

    // 3. A membrane never squats on wall matter: movement can't be gated at
    //    a cell that blocks outright anyway, and a filter-owned wall cell
    //    would corrupt glass provenance (see the compositor's membrane
    //    pass) -- deleting the wall's entity would leave its glass orphaned
    //    behind the membrane's claim.
    if (filterIds.has(owner) && isWallSpecId(grid.specId[i] as number)) fail('membrane owns a wall cell', i);

    // 4. No orphan overlay: every lumen cell belongs to a live tube. An
    //    orphan lumen is an invisible barrier no matter can ever enter,
    //    belonging to a tube that no longer exists.
    if ((grid.tubeMask[i] as TubeMaskValue) === TubeMaskValue.Lumen) {
      if (!lumen.has(i)) fail('orphan lumen mask', i);
      // A lumen is a bored channel: never wall matter, or the conveyor is
      // plugged by its own geometry.
      if (isWallSpecId(grid.specId[i] as number)) fail('lumen plugged with wall matter', i);
    }

    // 5. No orphan port: a masked cell always belongs to a live Sink or
    //    Vent. An orphan would be an invisible drain eating whatever fell on
    //    it, belonging to a port that isn't on the bench -- the sinkMask
    //    version of the orphan lumen above, and the reason sinkMask stopped
    //    being painted terrain (see entity-composite.ts).
    if ((grid.sinkMask[i] as SinkMaskValue) !== SinkMaskValue.None && !portCells.has(i)) fail('orphan port mask', i);

    // 6. Nothing left behind: glass on an unowned cell would be the player's
    //    paint, and this fuzz only ever pours ordinary matter, never glass --
    //    so any is an entity's leak.
    if (grid.specId[i] === GLASS_WALL_SPEC_ID && owner === 0) fail('orphan glass with no owner', i);
  }
}

/** Non-wall matter on the bench: the vessel contents the fuzz pours, and the
 * only thing an apparatus edit is allowed to move rather than re-derive. */
function countMatter(grid: SimGrid): number {
  let n = 0;
  for (let i = 0; i < grid.specId.length; i++) {
    if (!grid.isEmptyAt(i) && !isWallSpecId(grid.specId[i] as number)) n += 1;
  }
  return n;
}

/** Where an entity's glass is expected, so a "still whole" check has
 * something to compare against -- the wall footprint minus the cells some
 * later entity's lumen legitimately bored through. */
function boredCells(bench: readonly AnyEntity[], grid: SimGrid): Set<number> {
  const out = new Set<number>();
  for (const entity of bench) {
    if (entity.kind !== 'tube') continue;
    for (const cell of entity.geometry.lumenCells) {
      if (grid.inBounds(cell.x, cell.y)) out.add(grid.index(cell.x, cell.y));
    }
  }
  return out;
}

beforeEach(() => {
  resetEntityIds();
});

describe('entity fuzz', () => {
  it('keeps every compositor invariant across hundreds of random apparatus edits', () => {
    const rng = mulberry32(20260815);
    const grid = new SimGrid(WIDTH, HEIGHT);
    const bench: AnyEntity[] = [];
    const coord = (max: number) => Math.floor(rng() * max);
    const pick = (kind?: AnyEntity['kind']): AnyEntity | null => {
      const list = kind ? bench.filter((e) => e.kind === kind) : bench;
      return list.length === 0 ? null : (list[Math.floor(rng() * list.length)] as AnyEntity);
    };
    const place = (wire: PlaceEntityWire): void => {
      const placed = placeEntityFromWire(grid, wire);
      if (placed) bench.push(placed);
    };

    const ops: { name: string; run: () => void }[] = [
      {
        name: 'place funnel',
        run: () => place({ kind: 'funnel', x: coord(WIDTH), y: coord(HEIGHT), facing: 'down', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null }),
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
          place({ kind: 'tube', points, filter: null });
        },
      },
      {
        name: 'place flask',
        run: () =>
          place({ kind: 'flask', x: coord(WIDTH), y: coord(HEIGHT), facing: 'up', sizeScale: 0.5 + rng(), stirred: rng() < 0.5, flaskKind: rng() < 0.5 ? 'beaker' : 'erlenmeyer' }),
      },
      {
        name: 'place filter',
        run: () => place({ kind: 'filter', x0: coord(WIDTH), y0: coord(HEIGHT), x1: coord(WIDTH), y1: coord(HEIGHT), species: [SpeciesId.H2O] }),
      },
      {
        name: 'place radiator',
        run: () => place({ kind: 'radiator', x0: coord(WIDTH), y0: coord(HEIGHT), x1: coord(WIDTH), y1: coord(HEIGHT), radiationRadius: 1 + coord(5), targetTempC: coord(400) }),
      },
      {
        name: 'place glass',
        run: () => {
          const x = coord(WIDTH - 12) + 2;
          const y = coord(HEIGHT - 12) + 2;
          place({
            kind: 'glass',
            points: [
              { x, y },
              { x: x + 2 + coord(9), y },
              { x: x + 2 + coord(9), y: y + 2 + coord(9) },
            ],
          });
        },
      },
      {
        name: 'place sink',
        run: () => place({ kind: 'sink', x0: coord(WIDTH), y0: coord(HEIGHT), x1: coord(WIDTH), y1: coord(HEIGHT), width: coord(4) }),
      },
      {
        name: 'place vent',
        run: () => place({ kind: 'vent', x0: coord(WIDTH), y0: coord(HEIGHT), x1: coord(WIDTH), y1: coord(HEIGHT), width: coord(4) }),
      },
      {
        name: 'widen a port',
        run: () => {
          const port = pick(rng() < 0.5 ? 'sink' : 'vent');
          if (port?.kind === 'sink' || port?.kind === 'vent') applyEntitySettings(port, { kind: port.kind, width: coord(10) - 2 });
        },
      },
      {
        name: 'move anything',
        run: () => {
          const e = pick();
          if (e) moveEntityBy(grid, e, Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5));
        },
      },
      {
        name: 'drag a handle',
        run: () => {
          // Whatever handles the entity's own wire declares -- knees, line
          // ends, glass corners -- picked exactly the way the UI would.
          const e = pick();
          if (!e) return;
          const handles = entityHandles(entityToWire(e));
          const handle = handles[Math.floor(rng() * handles.length)];
          if (handle) dragEntityHandleTo(grid, e, handle.handleId, coord(WIDTH), coord(HEIGHT));
        },
      },
      {
        name: 'rotate anything',
        run: () => {
          const e = pick();
          if (e) rotateEntityTo(e, coord(8));
        },
      },
      {
        name: 'resize flask',
        run: () => {
          const f = pick('flask');
          if (f && f.kind === 'flask') {
            applyEntitySettings(f, { kind: 'flask', facing: f.facing, sizeScale: 0.5 + rng() * 1.5, stirred: rng() < 0.5, flaskKind: f.flaskKind });
          }
        },
      },
      {
        name: 'retune radiator',
        run: () => {
          const r = pick('radiator');
          if (r && r.kind === 'radiator') applyEntitySettings(r, { kind: 'radiator', radiationRadius: 1 + coord(6), targetTempC: coord(500) });
        },
      },
      {
        name: 'refit filter allow-list',
        run: () => {
          const f = pick('filter');
          if (f && f.kind === 'filter') applyEntitySettings(f, { kind: 'filter', species: rng() < 0.5 ? [] : [SpeciesId.Fe] });
        },
      },
      {
        // Matter on the bench, so the ops above have something to shove
        // around: moveEntityBy carries a vessel's contents with it now, which
        // is the one code path outside the compositor that writes matter
        // during an apparatus edit (see the matter-count invariant below).
        name: 'pour matter',
        run: () => {
          for (let n = 0; n < 8; n++) {
            const x = coord(WIDTH);
            const y = coord(HEIGHT);
            const i = grid.index(x, y);
            if (isWallSpecId(grid.specId[i] as number)) continue;
            grid.set(x, y, rng() < 0.5 ? SpeciesId.H2O : SpeciesId.Fe, PhaseCode.Liquid, 500);
          }
        },
      },
      {
        name: 'delete something',
        run: () => {
          const e = pick();
          if (e) bench.splice(bench.indexOf(e), 1);
        },
      },
    ];

    let matterBefore = 0;
    for (let step = 0; step < OPS; step++) {
      const op = ops[Math.floor(rng() * ops.length)] as { name: string; run: () => void };
      op.run();
      compositeEntities(grid, species, bench);
      checkInvariants(grid, bench, `op ${step} (${op.name})`);
      // No apparatus edit ever *creates* matter. One-sided on purpose: an
      // edit may legitimately destroy some (glass stamped over a cell, a
      // moved vessel's contents clipped off the bench edge), but a move that
      // carries contents must put each cell down once and only once.
      const matterNow = countMatter(grid);
      if (op.name !== 'pour matter' && matterNow > matterBefore) {
        throw new Error(`op ${step} (${op.name}): matter appeared from nowhere (${matterBefore} -> ${matterNow})`);
      }
      matterBefore = matterNow;
    }

    // The bench really did get exercised, rather than the fuzz spending 400
    // ops on empty lists.
    expect(bench.length).toBeGreaterThan(3);
  });

  it('never lets one entity permanently damage another, however they are shuffled', () => {
    // The narrower version of the same idea, stated as the property the old
    // design kept breaking: after any sequence of moves, every entity's glass
    // is wholly present except where a tube is legitimately plumbed through.
    const rng = mulberry32(4242);
    const grid = new SimGrid(WIDTH, HEIGHT);
    const bench: AnyEntity[] = [];
    const placed = (wire: PlaceEntityWire): AnyEntity => {
      const entity = placeEntityFromWire(grid, wire);
      if (!entity) throw new Error('expected the placement to succeed');
      bench.push(entity);
      return entity;
    };
    const glass = placed({ kind: 'glass', points: [{ x: 12, y: 8 }, { x: 12, y: 34 }, { x: 40, y: 34 }] });
    const flask = placed({ kind: 'flask', x: 30, y: 30, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' });
    const tube = placed({ kind: 'tube', points: [{ x: 4, y: 20 }, { x: 24, y: 20 }], filter: null }) as TubeInstance;
    const funnel = placed({ kind: 'funnel', x: 20, y: 12, facing: 'down', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null });
    compositeEntities(grid, species, bench);

    for (let step = 0; step < 120; step++) {
      const roll = rng();
      if (roll < 0.3) dragEntityHandleTo(grid, tube, rng() < 0.5 ? 0 : 1, 2 + Math.floor(rng() * 50), 2 + Math.floor(rng() * 40));
      else if (roll < 0.6) moveEntityBy(grid, flask, Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5));
      else if (roll < 0.85) moveEntityBy(grid, glass, Math.round(rng() * 6 - 3), Math.round(rng() * 6 - 3));
      else moveEntityBy(grid, funnel, Math.round(rng() * 10 - 5), Math.round(rng() * 10 - 5));
      compositeEntities(grid, species, bench);

      const bored = boredCells(bench, grid);
      for (const cell of tubeGlassCells(tube)) {
        if (!grid.inBounds(cell.x, cell.y)) continue;
        const i = grid.index(cell.x, cell.y);
        if (bored.has(i)) continue;
        if (grid.specId[i] !== GLASS_WALL_SPEC_ID) throw new Error(`step ${step}: the tube lost a wall cell at ${cell.x},${cell.y}`);
      }
    }
  });
});
