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
  placeEntityFromWire,
  type AnyEntity,
} from './entity';
import { resetEntityIds } from './entity-id';
import { SimGrid } from './grid';
import type { EntityWire, PlaceEntityWire } from './protocol';
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
