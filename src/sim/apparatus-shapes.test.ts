import { describe, expect, it } from 'vitest';
import { FUNNEL_FACINGS, funnelBounds, funnelShapeFor, funnelSpawnOffset, nextFunnelFacing, type FunnelFacing } from './apparatus-shapes';

describe('apparatus-shapes', () => {
  it('has a spout-adjacent spawn offset facing away from the body for every facing', () => {
    for (const facing of FUNNEL_FACINGS) {
      const shape = funnelShapeFor(facing);
      const bounds = funnelBounds(shape);
      // The spawn cell must sit just outside the shape's own bounding box,
      // on the side the funnel points -- otherwise a drip would land inside
      // (or overlapping) the funnel's own glass.
      const spawnX = shape.spawnOffset.dx;
      const spawnY = shape.spawnOffset.dy;
      expect(spawnX < bounds.minDx || spawnX > bounds.maxDx || spawnY < bounds.minDy || spawnY > bounds.maxDy).toBe(true);
    }
  });

  it('produces a distinct spawn offset per facing, each a single orthogonal step', () => {
    const offsets = FUNNEL_FACINGS.map((f) => funnelSpawnOffset(f));
    for (const o of offsets) {
      expect(Math.abs(o.dx) + Math.abs(o.dy)).toBe(1);
    }
    const unique = new Set(offsets.map((o) => `${o.dx},${o.dy}`));
    expect(unique.size).toBe(FUNNEL_FACINGS.length);
  });

  it('keeps the same cell count across every rotation (rotation, not reshaping)', () => {
    const counts = FUNNEL_FACINGS.map((f) => funnelShapeFor(f).cells.length);
    expect(new Set(counts).size).toBe(1);
  });

  it('is roughly 10x30px, matching the requested size', () => {
    const bounds = funnelBounds(funnelShapeFor('down'));
    expect(bounds.maxDx - bounds.minDx).toBeGreaterThanOrEqual(8);
    expect(bounds.maxDx - bounds.minDx).toBeLessThanOrEqual(12);
    expect(bounds.maxDy - bounds.minDy).toBeGreaterThanOrEqual(28);
    expect(bounds.maxDy - bounds.minDy).toBeLessThanOrEqual(32);
  });

  it('cycles through all 4 facings and wraps in both directions', () => {
    let facing: FunnelFacing = 'down';
    for (let i = 0; i < FUNNEL_FACINGS.length; i++) facing = nextFunnelFacing(facing, 1);
    expect(facing).toBe('down');
    expect(nextFunnelFacing('down', -1)).toBe(FUNNEL_FACINGS[FUNNEL_FACINGS.length - 1]);
  });

  it('never lets the reservoir interior collide with the outline cells', () => {
    for (const facing of FUNNEL_FACINGS) {
      const shape = funnelShapeFor(facing);
      const wallKeys = new Set(shape.cells.map((c) => `${c.dx},${c.dy}`));
      for (const cell of shape.reservoirCells) {
        expect(wallKeys.has(`${cell.dx},${cell.dy}`)).toBe(false);
      }
    }
  });
});
