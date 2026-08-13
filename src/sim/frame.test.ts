// computeFunnelFill's "cosmetic wash never overwrites real matter" rule (see
// its doc comment in frame.ts) had no test coverage before frame.ts split
// out of worker.ts -- it was only reachable by round-tripping a real message
// through a live Worker. Covered directly here now that it's a pure
// function of grid + funnel-instance state.
import { describe, expect, it } from 'vitest';
import { computeFunnelFill } from './frame';
import type { FunnelInstance } from './funnel';
import { EMPTY, PhaseCode, SimGrid } from './grid';

function makeFunnel(overrides: Partial<FunnelInstance> = {}): FunnelInstance {
  return {
    id: 1,
    anchorX: 5,
    anchorY: 5,
    facing: 'down',
    specId: 3,
    tempK: 300,
    intervalTicks: 60,
    ticksUntilDrip: 0,
    total: null,
    remaining: null,
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
