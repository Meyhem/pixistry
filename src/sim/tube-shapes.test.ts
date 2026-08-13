import { describe, expect, it } from 'vitest';
import {
  coneCells,
  lumenOpenEnds,
  lumenWallCells,
  nearestKneeIndex,
  nearestSegmentIndex,
  pointSegmentDistance,
  polylineToLumenPath,
  resolveKneePosition,
  snapOctant,
  tubeBounds,
  type Point,
} from './tube-shapes';

function key(p: Point): string {
  return `${p.x},${p.y}`;
}

describe('snapOctant', () => {
  it('snaps horizontal drags to a pure horizontal step', () => {
    expect(snapOctant({ x: 0, y: 0 }, { x: 5, y: 1 })).toEqual({ x: 5, y: 0 });
  });

  it('snaps diagonal drags to a pure 45-degree step', () => {
    expect(snapOctant({ x: 0, y: 0 }, { x: 4, y: 4 })).toEqual({ x: 4, y: 4 });
  });

  it('returns the anchor unchanged when raw === anchor', () => {
    expect(snapOctant({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual({ x: 3, y: 3 });
  });

  it('never snaps behind the anchor (negative steps clamp to 0)', () => {
    // A raw point that dot-products negative against every forward octant
    // still resolves to *an* octant (the closest by angle) with steps >= 0.
    const result = snapOctant({ x: 0, y: 0 }, { x: -1, y: 0 });
    expect(result).toEqual({ x: -1, y: 0 });
  });
});

describe('polylineToLumenPath', () => {
  it('walks a straight horizontal segment cell by cell', () => {
    const path = polylineToLumenPath([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('walks a 45-degree segment cell by cell', () => {
    const path = polylineToLumenPath([
      { x: 0, y: 0 },
      { x: 2, y: 2 },
    ]);
    expect(path).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('chains multiple segments without duplicating the shared knee', () => {
    const path = polylineToLumenPath([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
    const keys = path.map(key);
    expect(keys).toEqual(['0,0', '1,0', '2,0', '2,1', '2,2']);
  });

  it('returns just the single point for a one-point polyline', () => {
    expect(polylineToLumenPath([{ x: 5, y: 5 }])).toEqual([{ x: 5, y: 5 }]);
  });
});

describe('lumenOpenEnds', () => {
  it('is null for a lumen shorter than 2 cells', () => {
    expect(lumenOpenEnds([{ x: 0, y: 0 }])).toBeNull();
    expect(lumenOpenEnds([])).toBeNull();
  });

  it('points the mouth dir away from the direction of travel', () => {
    const path = polylineToLumenPath([
      { x: 0, y: 0 },
      { x: 3, y: 0 },
    ]);
    const ends = lumenOpenEnds(path)!;
    expect(ends.mouthDir).toEqual({ x: -1, y: 0 });
    expect(ends.mouthOpenCell).toEqual({ x: -1, y: 0 });
    expect(ends.exitDir).toEqual({ x: 1, y: 0 });
    expect(ends.exitOpenCell).toEqual({ x: 4, y: 0 });
  });

  it('continues the final segment direction past a knee', () => {
    const path = polylineToLumenPath([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
    const ends = lumenOpenEnds(path)!;
    expect(ends.exitDir).toEqual({ x: 0, y: 1 });
    expect(ends.exitOpenCell).toEqual({ x: 2, y: 3 });
  });
});

describe('lumenWallCells', () => {
  it('fully encloses a straight lumen except the two open ends', () => {
    const path = polylineToLumenPath([
      { x: 5, y: 5 },
      { x: 8, y: 5 },
    ]);
    const ends = lumenOpenEnds(path)!;
    const walls = new Set(lumenWallCells(path).map(key));
    expect(walls.has(key(ends.mouthOpenCell))).toBe(false);
    expect(walls.has(key(ends.exitOpenCell))).toBe(false);
    // Every lumen cell's 8 neighbors are either lumen, an open end, or wall.
    const lumenSet = new Set(path.map(key));
    for (const cell of path) {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          if (dx === 0 && dy === 0) continue;
          const n = { x: cell.x + dx, y: cell.y + dy };
          const k = key(n);
          const isOpen = k === key(ends.mouthOpenCell) || k === key(ends.exitOpenCell);
          expect(lumenSet.has(k) || isOpen || walls.has(k)).toBe(true);
        }
      }
    }
  });

  it('seals a knee join with no gaps and no wall overlapping the lumen', () => {
    const path = polylineToLumenPath([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
      { x: 4, y: 4 },
    ]);
    const lumenSet = new Set(path.map(key));
    const walls = lumenWallCells(path);
    for (const w of walls) {
      expect(lumenSet.has(key(w))).toBe(false);
    }
    // No duplicate wall cells.
    expect(new Set(walls.map(key)).size).toBe(walls.length);
  });

  it('is empty for an empty path', () => {
    expect(lumenWallCells([])).toEqual([]);
  });
});

describe('coneCells', () => {
  it('produces a single cell for coneSize 1', () => {
    const path = polylineToLumenPath([
      { x: 5, y: 5 },
      { x: 8, y: 5 },
    ]);
    const ends = lumenOpenEnds(path)!;
    const cone = coneCells(ends, 1);
    expect(cone).toEqual([ends.mouthOpenCell]);
  });

  it('widens with distance from the mouth', () => {
    const path = polylineToLumenPath([
      { x: 5, y: 5 },
      { x: 8, y: 5 },
    ]);
    const ends = lumenOpenEnds(path)!;
    const cone = coneCells(ends, 3);
    // row 1: 1 cell, row 2: 3 cells, row 3: 5 cells
    expect(cone.length).toBe(1 + 3 + 5);
  });

  it('is empty for coneSize 0', () => {
    const path = polylineToLumenPath([
      { x: 5, y: 5 },
      { x: 8, y: 5 },
    ]);
    const ends = lumenOpenEnds(path)!;
    expect(coneCells(ends, 0)).toEqual([]);
  });
});

describe('tubeBounds', () => {
  it('covers every given cell', () => {
    const bounds = tubeBounds([
      { x: 1, y: 5 },
      { x: -2, y: 3 },
      { x: 4, y: -1 },
    ]);
    expect(bounds).toEqual({ minX: -2, maxX: 4, minY: -1, maxY: 5 });
  });

  it('is degenerate but defined for an empty cell list', () => {
    expect(tubeBounds([])).toEqual({ minX: 0, maxX: 0, minY: 0, maxY: 0 });
  });
});

describe('pointSegmentDistance', () => {
  it('is 0 for a point on the segment', () => {
    expect(pointSegmentDistance({ x: 2, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(0);
  });

  it('measures perpendicular distance to a segment interior', () => {
    expect(pointSegmentDistance({ x: 2, y: 3 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(3);
  });

  it('clamps to the nearest endpoint beyond the segment', () => {
    expect(pointSegmentDistance({ x: 10, y: 0 }, { x: 0, y: 0 }, { x: 4, y: 0 })).toBe(6);
  });
});

describe('resolveKneePosition', () => {
  it('lands the drag target itself when both segments are already octant-valid', () => {
    const result = resolveKneePosition({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 5, y: 5 });
    expect(result).toEqual({ x: 5, y: 5 });
  });

  it('always produces octant-aligned segments to both fixed neighbors', () => {
    const prev: Point = { x: 0, y: 0 };
    const next: Point = { x: 6, y: 2 };
    const raw: Point = { x: 3, y: -4 };
    const knee = resolveKneePosition(prev, next, raw);
    const isOctant = (a: Point, b: Point) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      return dx === 0 || dy === 0 || Math.abs(dx) === Math.abs(dy);
    };
    expect(isOctant(prev, knee)).toBe(true);
    expect(isOctant(knee, next)).toBe(true);
    // Never collapses onto either fixed neighbor.
    expect(knee).not.toEqual(prev);
    expect(knee).not.toEqual(next);
  });

  it('returns prev when prev and next coincide', () => {
    const p: Point = { x: 4, y: 4 };
    expect(resolveKneePosition(p, p, { x: 0, y: 0 })).toEqual(p);
  });
});

describe('nearestKneeIndex / nearestSegmentIndex', () => {
  const points: Point[] = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it('finds the closest knee within maxDist', () => {
    expect(nearestKneeIndex(points, { x: 1, y: 1 }, 3)).toBe(0);
    expect(nearestKneeIndex(points, { x: 9, y: 9 }, 3)).toBe(2);
  });

  it('returns null when nothing is within maxDist', () => {
    expect(nearestKneeIndex(points, { x: 50, y: 50 }, 3)).toBeNull();
  });

  it('finds the closest segment within maxDist, preferring segment interiors', () => {
    expect(nearestSegmentIndex(points, { x: 5, y: 1 }, 3)).toBe(0);
    expect(nearestSegmentIndex(points, { x: 10, y: 5 }, 3)).toBe(1);
  });

  it('returns null when nothing is within maxDist', () => {
    expect(nearestSegmentIndex(points, { x: 50, y: 50 }, 3)).toBeNull();
  });
});
