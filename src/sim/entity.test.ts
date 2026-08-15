// The registry's wire-side half: what the Select tool asks it (what did this
// click land on, what cells does this read as, how far round is it) without
// knowing any kind's shape. The per-kind behaviour these dispatch to is
// covered by each kind's own suite; what's here is the generic contract.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  entityBodyCells,
  entityBounds,
  entityHandles,
  entityRotation,
  entityToWire,
  hitTestEntities,
  moveEntityBy,
  placeEntityFromWire,
  type AnyEntity,
} from './entity';
import { compositeEntities } from './entity-composite';
import { resetEntityIds } from './entity-id';
import { flaskFootprint } from './flask';
import { PhaseCode, SimGrid } from './grid';
import type { EntityWire, PlaceEntityWire } from './protocol';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';

const grid = new SimGrid(120, 80);

function place(params: PlaceEntityWire): { entity: AnyEntity; wire: EntityWire } {
  const entity = placeEntityFromWire(grid, params);
  if (!entity) throw new Error('expected the placement to succeed');
  return { entity, wire: entityToWire(entity) };
}

const FLASK: PlaceEntityWire = { kind: 'flask', x: 40, y: 40, facing: 'up', sizeScale: 2, stirred: false, flaskKind: 'beaker' };

beforeEach(() => {
  resetEntityIds();
});

describe('handles', () => {
  it('exposes every knee of a tube, every end of a line, every corner of a polygon', () => {
    const tube = place({ kind: 'tube', points: [{ x: 10, y: 10 }, { x: 20, y: 10 }, { x: 20, y: 20 }], filter: null });
    const filter = place({ kind: 'filter', x0: 5, y0: 60, x1: 15, y1: 60, species: [] });
    const glass = place({ kind: 'glass', points: [{ x: 60, y: 10 }, { x: 70, y: 10 }, { x: 70, y: 20 }] });

    expect(entityHandles(tube.wire).map((h) => [h.handleId, h.x, h.y])).toEqual([
      [0, 10, 10],
      [1, 20, 10],
      [2, 20, 20],
    ]);
    expect(entityHandles(filter.wire).map((h) => [h.x, h.y])).toEqual([
      [5, 60],
      [15, 60],
    ]);
    expect(entityHandles(glass.wire)).toHaveLength(3);
  });

  it('gives the stamp kinds none -- a funnel and a flask move whole, they have nothing to reshape', () => {
    const funnel = place({ kind: 'funnel', x: 30, y: 30, facing: 'down', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null });
    expect(entityHandles(funnel.wire)).toEqual([]);
    expect(entityHandles(place(FLASK).wire)).toEqual([]);
  });
});

describe('hit testing', () => {
  it('prefers a handle to the body it sits on', () => {
    const tube = place({ kind: 'tube', points: [{ x: 10, y: 10 }, { x: 30, y: 10 }], filter: null });

    // Right on the mouth knee: the same click is also inside the channel.
    expect(hit([tube.wire], 10, 10)).toEqual({ entityId: tube.entity.entityId, kind: 'tube', handleId: 0, locked: false });
    // Mid-channel, clear of both knees: the body.
    expect(hit([tube.wire], 20, 10)).toEqual({ entityId: tube.entity.entityId, kind: 'tube', handleId: null, locked: false });
  });

  it('picks the smallest body when two overlap, so small apparatus inside a vessel stays clickable', () => {
    // A funnel standing inside a big beaker, both containing the click.
    const flask = place(FLASK);
    const funnel = place({ kind: 'funnel', x: 40, y: 40, facing: 'down', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null });
    const flaskBox = entityBounds(flask.wire);
    const funnelBox = entityBounds(funnel.wire);
    if (!flaskBox || !funnelBox) throw new Error('expected both to have bounds');
    // The premise: the funnel really is the smaller of two boxes that both
    // cover the click, so this isn't passing for want of an overlap.
    expect(area(funnelBox)).toBeLessThan(area(flaskBox));
    expect(covers(funnelBox, 40, 40) && covers(flaskBox, 40, 40)).toBe(true);

    expect(hit([flask.wire, funnel.wire], 40, 40)?.entityId).toBe(funnel.entity.entityId);
    // Order in the list doesn't decide it -- area does.
    expect(hit([funnel.wire, flask.wire], 40, 40)?.entityId).toBe(funnel.entity.entityId);
  });

  it('misses cleanly when nothing is near', () => {
    const filter = place({ kind: 'filter', x0: 5, y0: 60, x1: 15, y1: 60, species: [] });
    expect(hit([filter.wire], 10, 61)?.handleId).toBe(null); // within the line's grab band
    expect(hit([filter.wire], 10, 70)).toBeNull(); // well clear of it
  });
});

describe('collection ports', () => {
  it('makes the whole visible width of a port clickable, not just its centre line', () => {
    // A port is the one line kind that's drawn thick, so a hit test that only
    // knew about the centre line would leave the part you can see -- and
    // aimed at -- unclickable.
    const { wire } = place({ kind: 'sink', x0: 20, y0: 70, x1: 40, y1: 70, width: 3 });

    expect(hitTestEntities([wire], 30, 73, 2.5)?.entityId).toBe(wire.entityId);
    expect(hitTestEntities([wire], 30, 90, 2.5)).toBeNull();
  });
});

describe('body cells and bounds', () => {
  it("reads a tube as its channel -- what you see and aim at, not its wall ring", () => {
    const tube = place({ kind: 'tube', points: [{ x: 10, y: 10 }, { x: 30, y: 10 }], filter: null });
    const cells = entityBodyCells(tube.wire);
    // The 3-wide band centred on the drawn line, so the centre and both
    // lanes are body; the wall ring a cell further out is not.
    expect(cells).toContainEqual({ x: 20, y: 10 });
    expect(cells).toContainEqual({ x: 20, y: 9 });
    expect(cells).toContainEqual({ x: 20, y: 11 });
    expect(cells).not.toContainEqual({ x: 20, y: 12 });
  });

  it('bounds a line by its two ends, whichever way round they were drawn', () => {
    const forward = place({ kind: 'radiator', x0: 10, y0: 20, x1: 40, y1: 50, radiationRadius: 3, targetTempC: 100 });
    const backward = place({ kind: 'radiator', x0: 40, y0: 50, x1: 10, y1: 20, radiationRadius: 3, targetTempC: 100 });
    expect(entityBounds(forward.wire)).toEqual({ minX: 10, maxX: 40, minY: 20, maxY: 50 });
    expect(entityBounds(backward.wire)).toEqual(entityBounds(forward.wire));
  });
});

describe('rotation', () => {
  it('reports the current step for the kinds that turn, and null for the ones that do not', () => {
    const funnel = place({ kind: 'funnel', x: 30, y: 30, facing: 'left', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null });
    const flask = place({ kind: 'flask', x: 40, y: 40, facing: 'right', sizeScale: 1, stirred: false, flaskKind: 'beaker' });
    const filter = place({ kind: 'filter', x0: 5, y0: 60, x1: 15, y1: 60, species: [] });

    // The index into each kind's own facing cycle, which is what a wheel
    // notch adds 1 to.
    expect(entityRotation(funnel.wire)).toBe(1); // FUNNEL_FACINGS: down, left, up, right
    expect(entityRotation(flask.wire)).toBe(2); // FLASK_FACINGS: up, up-right, right, ...
    expect(entityRotation(filter.wire)).toBeNull(); // a line has no facing
  });
});

function hit(entities: EntityWire[], x: number, y: number) {
  return hitTestEntities(entities, x, y, 2.5);
}

function area(b: { minX: number; maxX: number; minY: number; maxY: number }): number {
  return (b.maxX - b.minX + 1) * (b.maxY - b.minY + 1);
}

function covers(b: { minX: number; maxX: number; minY: number; maxY: number }, x: number, y: number): boolean {
  return x >= b.minX && x <= b.maxX && y >= b.minY && y <= b.maxY;
}

describe('moving', () => {
  /** What worker.ts's mutateEntities does: mutate the instance, then let the
   * compositor re-derive every apparatus cell from the entity list. */
  function moveAndComposite(grid: SimGrid, entities: AnyEntity[], entity: AnyEntity, dx: number, dy: number): void {
    moveEntityBy(grid, entity, dx, dy);
    compositeEntities(grid, new SpeciesTable(), entities);
  }

  it('carries a vessel\'s contents with it, a cell at a time, without clipping any away', () => {
    // Dragging a beaker of water upward used to leave the water behind and
    // then composite the glass straight on top of it, deleting a row of it
    // per cell of travel -- the contents "moved" nowhere and quietly
    // vanished instead.
    const bench = new SimGrid(120, 80);
    const species = new SpeciesTable();
    const flask = placeEntityFromWire(bench, { kind: 'flask', x: 60, y: 50, facing: 'up', sizeScale: 2, stirred: false, flaskKind: 'beaker' });
    if (!flask || flask.kind !== 'flask') throw new Error('expected a flask');
    const entities = [flask];
    compositeEntities(bench, species, entities);

    const filled = flaskFootprint(flask).reservoirCells.filter((c) => bench.inBounds(c.x, c.y));
    for (const cell of filled) bench.set(cell.x, cell.y, SpeciesId.H2O, PhaseCode.Liquid, 1000);
    expect(filled.length).toBeGreaterThan(4);

    // One cell per step, recompositing each time: a drag is a stream of
    // single-cell moves, and the old bug only bit on the composite that
    // followed each one.
    for (let i = 0; i < 5; i++) moveAndComposite(bench, entities, flask, 0, -1);

    let water = 0;
    for (let i = 0; i < bench.specId.length; i++) if (bench.specId[i] === SpeciesId.H2O) water += 1;
    expect(water).toBe(filled.length);
    for (const cell of filled) {
      expect(bench.specId[bench.index(cell.x, cell.y - 5)]).toBe(SpeciesId.H2O);
      expect(bench.u[bench.index(cell.x, cell.y - 5)]).toBe(1000);
    }
  });

  it('leaves matter outside the vessel where it is', () => {
    const bench = new SimGrid(120, 80);
    const species = new SpeciesTable();
    const flask = placeEntityFromWire(bench, { kind: 'flask', x: 60, y: 50, facing: 'up', sizeScale: 2, stirred: false, flaskKind: 'beaker' });
    if (!flask || flask.kind !== 'flask') throw new Error('expected a flask');
    const entities = [flask];
    compositeEntities(bench, species, entities);
    // Well clear of the vessel, in the direction it's about to move.
    bench.set(20, 20, SpeciesId.Fe, PhaseCode.Solid, 500);

    moveAndComposite(bench, entities, flask, -30, -20);

    expect(bench.specId[bench.index(20, 20)]).toBe(SpeciesId.Fe);
  });

  it('is a no-op for a kind that holds nothing', () => {
    const bench = new SimGrid(120, 80);
    const species = new SpeciesTable();
    const radiator = placeEntityFromWire(bench, { kind: 'radiator', x0: 10, y0: 20, x1: 40, y1: 20, radiationRadius: 3, targetTempC: 100 });
    if (!radiator) throw new Error('expected a radiator');
    const entities = [radiator];
    compositeEntities(bench, species, entities);
    bench.set(20, 20, SpeciesId.Fe, PhaseCode.Solid, 500);

    moveAndComposite(bench, entities, radiator, 0, 10);

    expect(bench.specId[bench.index(20, 20)]).toBe(SpeciesId.Fe);
  });
});
