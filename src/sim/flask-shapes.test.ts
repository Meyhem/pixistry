import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FLASK_SIZE_SCALE,
  FLASK_FACINGS,
  flaskBounds,
  flaskShapeFor,
  nextFlaskFacing,
  type FlaskFacing,
} from './flask-shapes';

const CARDINAL_FACINGS: readonly FlaskFacing[] = ['up', 'right', 'down', 'left'];

describe('flask-shapes', () => {
  it('keeps the same cell count across the 4 cardinal rotations (exact 90-degree rotation, not reshaping)', () => {
    const counts = CARDINAL_FACINGS.map((f) => flaskShapeFor(f, DEFAULT_FLASK_SIZE_SCALE).cells.length);
    expect(new Set(counts).size).toBe(1);
  });

  it('never lets the reservoir interior collide with the outline cells, for every cardinal facing', () => {
    for (const facing of CARDINAL_FACINGS) {
      const shape = flaskShapeFor(facing, DEFAULT_FLASK_SIZE_SCALE);
      const wallKeys = new Set(shape.cells.map((c) => `${c.dx},${c.dy}`));
      for (const cell of shape.reservoirCells) {
        expect(wallKeys.has(`${cell.dx},${cell.dy}`)).toBe(false);
      }
    }
  });

  it('is a closed vessel: the outline has no gap at the base, only at the neck mouth', () => {
    // The base row (dy = 0 in canonical "up") is filled solid (a closed
    // base), unlike the funnel's open spout -- so every dx in [-baseHalf,
    // baseHalf] should appear as a wall cell at dy 0.
    const shape = flaskShapeFor('up', DEFAULT_FLASK_SIZE_SCALE);
    const baseCells = shape.cells.filter((c) => c.dy === 0);
    const dxs = baseCells.map((c) => c.dx).sort((a, b) => a - b);
    for (let i = 1; i < dxs.length; i++) {
      expect((dxs[i] as number) - (dxs[i - 1] as number)).toBe(1); // contiguous, no gap
    }
    expect(dxs.length).toBeGreaterThan(10);
  });

  it('produces roughly the same footprint size across all 8 facings (diagonal rotation is an approximation)', () => {
    const boundsByFacing = FLASK_FACINGS.map((f) => flaskBounds(flaskShapeFor(f, DEFAULT_FLASK_SIZE_SCALE)));
    for (const b of boundsByFacing) {
      const width = b.maxDx - b.minDx;
      const height = b.maxDy - b.minDy;
      // Cardinal facings span exactly (base, body); diagonal facings rotate
      // that same footprint onto both axes, so the largest span roughly
      // doubles -- just sanity-check nothing degenerates to a point or blows
      // up unreasonably.
      expect(Math.max(width, height)).toBeGreaterThan(20);
      expect(Math.max(width, height)).toBeLessThan(80);
    }
  });

  it('cycles through all 8 facings and wraps in both directions', () => {
    let facing: FlaskFacing = 'up';
    for (let i = 0; i < FLASK_FACINGS.length; i++) facing = nextFlaskFacing(facing, 1);
    expect(facing).toBe('up');
    expect(nextFlaskFacing('up', -1)).toBe(FLASK_FACINGS[FLASK_FACINGS.length - 1]);
  });

  it('has a 7px-wide neck (+50% over the original 5px)', () => {
    // The neck is the two straight-run wall cells nearest the mouth, i.e.
    // the smallest dx span among rows sharing the topmost dy.
    const shape = flaskShapeFor('up', DEFAULT_FLASK_SIZE_SCALE);
    let topDy = 0;
    for (const c of shape.cells) if (c.dy < topDy) topDy = c.dy;
    const mouthRowDxs = shape.cells.filter((c) => c.dy === topDy).map((c) => c.dx);
    const width = Math.max(...mouthRowDxs) - Math.min(...mouthRowDxs) + 1;
    expect(width).toBe(7);
  });

  it('scales the footprint up and down with sizeScale', () => {
    const small = flaskBounds(flaskShapeFor('up', 0.5));
    const normal = flaskBounds(flaskShapeFor('up', 1.0));
    const large = flaskBounds(flaskShapeFor('up', 2.0));

    const height = (b: ReturnType<typeof flaskBounds>) => b.maxDy - b.minDy;
    expect(height(small)).toBeLessThan(height(normal));
    expect(height(normal)).toBeLessThan(height(large));
  });
});
