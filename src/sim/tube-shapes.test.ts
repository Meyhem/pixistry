import { describe, expect, it } from 'vitest';
import {
  apertureCells,
  distanceToExit,
  lumenBand,
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

/** The whole geometry of one tube, the way buildTubeGeometry assembles it. */
function tubeParts(points: Point[]): { band: Point[]; apertures: Point[]; mouth: Point[]; exit: Point[]; walls: Point[] } {
  const centerPath = polylineToLumenPath(points);
  const band = lumenBand(centerPath);
  const ends = lumenOpenEnds(centerPath);
  if (!ends) throw new Error('expected a tube with two open ends');
  const mouth = apertureCells(ends.mouthCell, ends.mouthDir);
  const exit = apertureCells(ends.exitCell, ends.exitDir);
  const apertures = [...mouth, ...exit];
  return { band, apertures, mouth, exit, walls: lumenWallCells(band, apertures) };
}

describe('lumenBand', () => {
  it('is 3 cells wide across a straight run', () => {
    const { band } = tubeParts([
      { x: 5, y: 5 },
      { x: 9, y: 5 },
    ]);
    for (let x = 5; x <= 9; x++) {
      for (const y of [4, 5, 6]) expect(band.map(key)).toContain(key({ x, y }));
    }
  });

  it('stays 3 cells wide across a diagonal run', () => {
    // The reason the band is Chebyshev rather than Euclidean: a diagonal
    // segment measured any other way pinches to one or two cells across, and
    // a conveyor that narrows at every bend jams there.
    const { band } = tubeParts([
      { x: 5, y: 5 },
      { x: 10, y: 10 },
    ]);
    const bandSet = new Set(band.map(key));
    for (let k = 1; k < 5; k++) {
      const cross = [
        { x: 5 + k - 1, y: 5 + k },
        { x: 5 + k, y: 5 + k },
        { x: 5 + k + 1, y: 5 + k },
      ];
      for (const c of cross) expect(bandSet.has(key(c))).toBe(true);
    }
  });

  it('deduplicates cells shared between consecutive path steps', () => {
    const { band } = tubeParts([
      { x: 0, y: 0 },
      { x: 6, y: 0 },
    ]);
    expect(new Set(band.map(key)).size).toBe(band.length);
  });
});

describe('apertureCells', () => {
  it('opens three cells across the perpendicular, just clear of the band', () => {
    // The band of a (5,5)->(9,5) run spans x=4..10, so the open rows sit at
    // x=3 and x=11 -- one step further out than the centre path's own ends.
    const { mouth, exit, band } = tubeParts([
      { x: 5, y: 5 },
      { x: 9, y: 5 },
    ]);
    expect(mouth.map(key).sort()).toEqual(['3,4', '3,5', '3,6'].sort());
    expect(exit.map(key).sort()).toEqual(['11,4', '11,5', '11,6'].sort());
    // An aperture inside the channel would make intake and discharge no-ops
    // against the tube's own cells.
    const bandSet = new Set(band.map(key));
    for (const cell of [...mouth, ...exit]) expect(bandSet.has(key(cell))).toBe(false);
  });
});

describe('lumenWallCells', () => {
  it('is watertight: every neighbour of the channel is band, aperture or wall', () => {
    const { band, apertures, walls } = tubeParts([
      { x: 5, y: 5 },
      { x: 9, y: 5 },
    ]);
    const bandSet = new Set(band.map(key));
    const openSet = new Set(apertures.map(key));
    const wallSet = new Set(walls.map(key));
    for (const cell of band) {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          if (dx === 0 && dy === 0) continue;
          const k = key({ x: cell.x + dx, y: cell.y + dy });
          expect(bandSet.has(k) || openSet.has(k) || wallSet.has(k)).toBe(true);
        }
      }
    }
  });

  it('leaves the apertures open and never walls over the channel', () => {
    const { band, apertures, walls } = tubeParts([
      { x: 5, y: 5 },
      { x: 9, y: 5 },
    ]);
    const wallSet = new Set(walls.map(key));
    for (const cell of apertures) expect(wallSet.has(key(cell))).toBe(false);
    for (const cell of band) expect(wallSet.has(key(cell))).toBe(false);
    expect(new Set(walls.map(key)).size).toBe(walls.length);
  });

  it('seals a knee join with no gaps', () => {
    const { band, apertures, walls } = tubeParts([
      { x: 5, y: 5 },
      { x: 11, y: 5 },
      { x: 11, y: 11 },
    ]);
    const bandSet = new Set(band.map(key));
    const openSet = new Set(apertures.map(key));
    const wallSet = new Set(walls.map(key));
    for (const cell of band) {
      for (const dx of [-1, 0, 1]) {
        for (const dy of [-1, 0, 1]) {
          const k = key({ x: cell.x + dx, y: cell.y + dy });
          expect(bandSet.has(k) || openSet.has(k) || wallSet.has(k)).toBe(true);
        }
      }
    }
  });

  it('is empty for an empty band', () => {
    expect(lumenWallCells([])).toEqual([]);
  });
});

describe('distanceToExit', () => {
  it('decreases monotonically toward the exit, with a way forward from everywhere', () => {
    const { band, exit } = tubeParts([
      { x: 5, y: 5 },
      { x: 12, y: 5 },
      { x: 12, y: 12 },
    ]);
    const dist = distanceToExit(band, exit);

    // BFS's defining property, and exactly what transport relies on: every
    // reachable cell has a strictly-closer neighbour, so cargo always has
    // somewhere to go and can never circle.
    for (let i = 0; i < band.length; i++) {
      const here = dist[i] as number;
      expect(Number.isFinite(here)).toBe(true);
      if (here === 0) continue;
      const hasDownhill = band.some((other, j) => {
        if (i === j || (dist[j] as number) >= here) return false;
        return Math.abs((band[i] as Point).x - other.x) <= 1 && Math.abs((band[i] as Point).y - other.y) <= 1;
      });
      expect(hasDownhill).toBe(true);
    }
  });

  it('seeds 0 at the cells touching the exit and grows away from it', () => {
    const { band, exit } = tubeParts([
      { x: 5, y: 5 },
      { x: 15, y: 5 },
    ]);
    const dist = distanceToExit(band, exit);
    const at = (x: number, y: number): number => dist[band.findIndex((c) => c.x === x && c.y === y)] as number;
    // The band caps one past the centre path, so x=16 is the last channel
    // column and the one that touches the exit aperture at x=17.
    expect(at(16, 5)).toBe(0);
    expect(at(15, 5)).toBe(1);
    expect(at(11, 5)).toBe(5);
    expect(at(6, 5)).toBeGreaterThan(at(11, 5));
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
