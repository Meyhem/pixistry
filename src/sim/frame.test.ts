// computeFunnelFill's "cosmetic wash never overwrites real matter" rule (see
// its doc comment in frame.ts) had no test coverage before frame.ts split
// out of worker.ts -- it was only reachable by round-tripping a real message
// through a live Worker. Covered directly here now that it's a pure
// function of grid + funnel-instance state.
import { describe, expect, it } from 'vitest';
import { buildFrame, computeFunnelFill } from './frame';
import type { AnyEntity } from './entity';
import { flaskFootprint, placeFlaskInstance } from './flask';
import type { FunnelInstance } from './funnel';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { SinkCounter } from './sink';
import { SpeciesTable } from './species';

function makeFunnel(overrides: Partial<FunnelInstance> = {}): FunnelInstance {
  return {
    kind: 'funnel',
    entityId: 1,
    anchorX: 5,
    anchorY: 5,
    facing: 'down',
    specId: 3,
    tempK: 300,
    intervalTicks: 60,
    ticksUntilDrip: 0,
    total: null,
    remaining: null,
    enabled: true,
    ...overrides,
  };
}

describe('computeFunnelFill', () => {
  it("washes the funnel's open interior with its species where the grid cell is empty", () => {
    const grid = new SimGrid(20, 40);
    const fill = computeFunnelFill(grid, [makeFunnel()]);
    // Facing 'down' at anchor (5,5): the neck's reservoir cells run straight
    // up from the anchor (dx: 0, dy: -1..-10) -- the cell directly above the
    // anchor is the closest one.
    expect(fill[grid.index(5, 4)]).toBe(3);
  });

  it('leaves a reservoir cell alone when real matter already occupies it', () => {
    const grid = new SimGrid(20, 40);
    grid.set(5, 4, 7, PhaseCode.Solid, 100);
    const fill = computeFunnelFill(grid, [makeFunnel()]);
    expect(fill[grid.index(5, 4)]).toBe(EMPTY);
    // The real matter itself is untouched -- computeFunnelFill is a
    // rendering-only overlay, never a write into the grid.
    expect(grid.specId[grid.index(5, 4)]).toBe(7);
  });

  it('skips a depleted (remaining === 0) funnel entirely', () => {
    const grid = new SimGrid(20, 40);
    const fill = computeFunnelFill(grid, [makeFunnel({ total: 5, remaining: 0 })]);
    expect(fill[grid.index(5, 4)]).toBe(EMPTY);
  });

  it('still fills an infinite-supply funnel (remaining === null)', () => {
    const grid = new SimGrid(20, 40);
    const fill = computeFunnelFill(grid, [makeFunnel({ total: null, remaining: null })]);
    expect(fill[grid.index(5, 4)]).toBe(3);
  });

  it('is a no-op with no placed funnels', () => {
    const grid = new SimGrid(20, 40);
    const fill = computeFunnelFill(grid, []);
    expect(fill.every((v) => v === EMPTY)).toBe(true);
  });
});

describe('buildFrame', () => {
  function frameOf(grid: SimGrid, entities: AnyEntity[]) {
    return buildFrame(grid, new SpeciesTable(), {
      entities,
      grabState: null,
      sinkCounter: new SinkCounter(),
      ventCounter: new SinkCounter(),
      hasSnapshot: false,
      canUndoEntities: false,
      canRedoEntities: false,
      tick: 0,
      objectives: [],
    });
  }

  it("ships a stirred flask's interior in stirrerMask, so the overlay is drawn", () => {
    // The renderer's only input for the stirrer tint is this array, and a
    // stirred flask deliberately never paints itself onto grid.stirrerMask
    // (see stirrer.ts) -- shipping the grid array raw drew no overlay at all
    // for one, while the flask stirred away underneath.
    const grid = new SimGrid(60, 60);
    const flask = placeFlaskInstance({ x: 30, y: 40, facing: 'up', sizeScale: 2, stirred: true, flaskKind: 'beaker' });
    const inside = flaskFootprint(flask).reservoirCells.filter((c) => grid.inBounds(c.x, c.y));

    const frame = frameOf(grid, [flask]);

    expect(inside.length).toBeGreaterThan(4);
    for (const cell of inside) expect(frame.stirrerMask[grid.index(cell.x, cell.y)]).toBe(1);
  });

  it('leaves stirrerMask to the painted overlay alone for an unstirred flask', () => {
    const grid = new SimGrid(60, 60);
    const flask = placeFlaskInstance({ x: 30, y: 40, facing: 'up', sizeScale: 2, stirred: false, flaskKind: 'beaker' });
    grid.stirrerMask[grid.index(2, 2)] = 1;

    const frame = frameOf(grid, [flask]);

    expect(frame.stirrerMask[grid.index(2, 2)]).toBe(1);
    expect(frame.stirrerMask.reduce<number>((n, v) => n + (v > 0 ? 1 : 0), 0)).toBe(1);
  });
});
