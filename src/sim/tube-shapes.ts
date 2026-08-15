// Pure geometry for the conveyor-tube apparatus: turning player-placed knee
// points into a cell-by-cell lumen path, the wall ring around that path, and
// the suction cone at the mouth. No SimGrid dependency here (tube.ts is the
// grid-aware layer) so this is unit-testable as plain math.
//
// Every knee point is snapped to one of 8 directions from the *previous*
// knee (see snapOctant) before it's ever turned into a path -- this is what
// makes "walls always perfectly joined in continuation" true by
// construction rather than something placement code has to get right: an
// axis/diagonal-only path lets lumenWallCells use one flat rule (every
// 8-neighbor of a lumen cell that isn't itself lumen) and get a watertight,
// self-sealing tube at every knee for free, with no per-angle special
// casing.
export interface Point {
  readonly x: number;
  readonly y: number;
}

const OCTANT_DIRS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
  { x: -1, y: 1 },
  { x: -1, y: 0 },
  { x: -1, y: -1 },
  { x: 0, y: -1 },
  { x: 1, y: -1 },
];

const NEIGHBORS_8: readonly Point[] = OCTANT_DIRS;

function key(p: Point): string {
  return `${p.x},${p.y}`;
}

/** Snaps `raw` onto the nearest of the 8 grid directions out of `anchor`
 * (whichever octant direction has the largest dot product with the
 * raw delta), at an integer number of steps along that direction --
 * so the result is always exactly reachable by polylineToLumenPath's
 * cell walk, never an off-axis point. Returns `anchor` unchanged if
 * raw === anchor (nothing to snap). */
export function snapOctant(anchor: Point, raw: Point): Point {
  const dx = raw.x - anchor.x;
  const dy = raw.y - anchor.y;
  if (dx === 0 && dy === 0) return anchor;
  let best = OCTANT_DIRS[0] as Point;
  let bestDot = -Infinity;
  for (const dir of OCTANT_DIRS) {
    const dirLen2 = dir.x * dir.x + dir.y * dir.y;
    const dot = (dx * dir.x + dy * dir.y) / Math.sqrt(dirLen2);
    if (dot > bestDot) {
      bestDot = dot;
      best = dir;
    }
  }
  const dirLen2 = best.x * best.x + best.y * best.y;
  const steps = Math.max(0, Math.round((dx * best.x + dy * best.y) / dirLen2));
  return { x: anchor.x + best.x * steps, y: anchor.y + best.y * steps };
}

/** Whether `b` is reachable from `a` by whole steps in one of the 8 octant
 * directions -- the precondition every consecutive pair of tube knees is
 * meant to satisfy (see snapOctant and the module comment). */
export function isOctantAligned(a: Point, b: Point): boolean {
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  return dx === 0 || dy === 0 || dx === dy;
}

/** Walks every cell-by-cell step between consecutive (already octant-
 * snapped) waypoints, inclusive of every waypoint. Each consecutive pair is
 * expected to differ by a whole multiple of a unit octant step -- true for
 * any polyline built from snapOctant results, so this never needs a general
 * Bresenham. Consecutive duplicate waypoints (a click that didn't move)
 * collapse naturally since the inner loop simply doesn't run.
 *
 * The step count is derived up front rather than walked until the cursor
 * happens to land on `b`. Those are the same thing for an aligned pair, but
 * for a misaligned one the "walk until you arrive" form never arrives: it
 * spins forever appending cells, taking the whole worker down with it. A
 * geometry helper shouldn't be able to hang the sim just because a caller
 * handed it a pair it didn't expect. */
export function polylineToLumenPath(points: readonly Point[]): Point[] {
  if (points.length === 0) return [];
  const path: Point[] = [points[0] as Point];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    const stepX = Math.sign(b.x - a.x);
    const stepY = Math.sign(b.y - a.y);
    const steps = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
    let cx = a.x;
    let cy = a.y;
    for (let s = 0; s < steps; s++) {
      if (cx !== b.x) cx += stepX;
      if (cy !== b.y) cy += stepY;
      path.push({ x: cx, y: cy });
    }
  }
  return path;
}

export interface TubeOpenEnds {
  /** The mouth's cell (lumenPath[0]). */
  readonly mouthCell: Point;
  /** Unit direction pointing outward from the mouth (away from the tube
   * body) -- where the suction cone extends. */
  readonly mouthDir: Point;
  /** The single lumen-adjacent cell left un-walled at the mouth end, so
   * suction has somewhere to pull matter through. */
  readonly mouthOpenCell: Point;
  /** The exit's cell (last lumenPath entry). */
  readonly exitCell: Point;
  /** Unit direction of travel continuing past the exit. */
  readonly exitDir: Point;
  /** The single lumen-adjacent cell left un-walled at the exit end, where
   * ejected matter lands. */
  readonly exitOpenCell: Point;
}

/** A lumen shorter than 2 cells has no defined direction of travel and thus
 * no open ends -- degenerate, returns null. */
export function lumenOpenEnds(lumenPath: readonly Point[]): TubeOpenEnds | null {
  if (lumenPath.length < 2) return null;
  const first = lumenPath[0] as Point;
  const second = lumenPath[1] as Point;
  const mouthDir = { x: first.x - second.x, y: first.y - second.y };
  const last = lumenPath[lumenPath.length - 1] as Point;
  const secondLast = lumenPath[lumenPath.length - 2] as Point;
  const exitDir = { x: last.x - secondLast.x, y: last.y - secondLast.y };
  return {
    mouthCell: first,
    mouthDir,
    mouthOpenCell: { x: first.x + mouthDir.x, y: first.y + mouthDir.y },
    exitCell: last,
    exitDir,
    exitOpenCell: { x: last.x + exitDir.x, y: last.y + exitDir.y },
  };
}

/** Every 8-neighbor of every lumen cell that is itself neither lumen nor one
 * of the two open end cells -- the "two parallel lines" glass wall,
 * including knee joins, all from this one flat rule (see the module
 * comment for why octant-snapping is what makes that safe). */
export function lumenWallCells(lumenPath: readonly Point[]): Point[] {
  if (lumenPath.length === 0) return [];
  const lumenSet = new Set(lumenPath.map(key));
  const openEnds = lumenOpenEnds(lumenPath);
  const openSet = new Set<string>();
  if (openEnds) {
    openSet.add(key(openEnds.mouthOpenCell));
    openSet.add(key(openEnds.exitOpenCell));
  }
  const wallSet = new Set<string>();
  for (const cell of lumenPath) {
    for (const n of NEIGHBORS_8) {
      const p = { x: cell.x + n.x, y: cell.y + n.y };
      const k = key(p);
      if (lumenSet.has(k) || openSet.has(k) || wallSet.has(k)) continue;
      wallSet.add(k);
    }
  }
  return [...wallSet].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x: x as number, y: y as number };
  });
}

/** Cells the suction cone covers, widening linearly from a single cell at
 * the mouth out to `coneSize` rows -- same "authored once, not physically
 * derived" spirit as apparatus-shapes.ts's funnel taper. `coneSize <= 0`
 * yields no cone (suction only affects the mouth cell itself via stepTubes'
 * own adjacency, not this cone). */
export function coneCells(openEnds: TubeOpenEnds, coneSize: number): Point[] {
  if (coneSize <= 0) return [];
  const { mouthCell, mouthDir } = openEnds;
  const perp = { x: -mouthDir.y, y: mouthDir.x };
  const cells: Point[] = [];
  for (let r = 1; r <= coneSize; r++) {
    const center = { x: mouthCell.x + mouthDir.x * r, y: mouthCell.y + mouthDir.y * r };
    const halfWidth = Math.min(r - 1, coneSize - 1);
    for (let k = -halfWidth; k <= halfWidth; k++) {
      cells.push({ x: center.x + perp.x * k, y: center.y + perp.y * k });
    }
  }
  return cells;
}

/** Resolves where an interior knee should land when dragged, given its two
 * neighbors stay fixed. A single point can't in general sit on an octant
 * ray from `prev` AND an octant ray from `next` at once (that's a
 * 2-unknown, 2-equation system solvable only for specific direction
 * pairs), so this brute-forces all 8x8 octant-direction combinations,
 * solves each pair's ray intersection exactly (rounding to the nearest
 * lattice point along both rays, then verifying they agree), and returns
 * the valid candidate closest to `raw` -- ties broken by fewest total
 * steps, preferring the straightest fit. Every combination is tried
 * (not just one anchor) because always anchoring off just one neighbor
 * would leave the *other* segment free to end up off-axis, breaking the
 * "walls are always perfectly joined" invariant that depends on every
 * segment staying octant-aligned. Never returns null: for any two distinct
 * integer points there's always at least one valid direction pair (this is
 * the same reachability guarantee 8-directional/octile pathfinding relies
 * on), so this falls back to `prev` only in the degenerate case where prev
 * and next already coincide. */
export function resolveKneePosition(prev: Point, next: Point, raw: Point): Point {
  if (prev.x === next.x && prev.y === next.y) return prev;
  let best: Point | null = null;
  let bestDist = Infinity;
  let bestSteps = Infinity;
  const consider = (px: number, py: number, steps: number) => {
    const dist = Math.hypot(px - raw.x, py - raw.y);
    if (dist < bestDist - 1e-9 || (Math.abs(dist - bestDist) < 1e-9 && steps < bestSteps)) {
      bestDist = dist;
      bestSteps = steps;
      best = { x: px, y: py };
    }
  };
  // Collinear case (dirB = -dirA, i.e. prev/next/raw sit on one straight
  // octant line): the determinant-based solve below rejects this as
  // "parallel, no unique intersection", but a straight line is exactly the
  // common case when adding a knee to an already-straight run, so it's
  // handled directly -- project raw onto the prev-next segment and clamp to
  // an interior lattice point.
  for (const dirA of OCTANT_DIRS) {
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const nx = dirA.x === 0 ? (dx === 0 ? 0 : NaN) : dx / dirA.x;
    const ny = dirA.y === 0 ? (dy === 0 ? 0 : NaN) : dy / dirA.y;
    const n = dirA.x === 0 ? ny : dirA.y === 0 ? nx : nx === ny ? nx : NaN;
    if (!Number.isInteger(n) || n < 2) continue;
    const rawSteps = ((raw.x - prev.x) * dirA.x + (raw.y - prev.y) * dirA.y) / (dirA.x * dirA.x + dirA.y * dirA.y);
    const s = Math.max(1, Math.min(n - 1, Math.round(rawSteps)));
    consider(prev.x + dirA.x * s, prev.y + dirA.y * s, n);
  }
  for (const dirA of OCTANT_DIRS) {
    for (const dirB of OCTANT_DIRS) {
      // Solve point = prev + dirA*s = next + dirB*t for integer s, t >= 1:
      //   dirA.x*s - dirB.x*t = next.x - prev.x
      //   dirA.y*s - dirB.y*t = next.y - prev.y
      const det = dirA.x * -dirB.y - -dirB.x * dirA.y;
      if (det === 0) continue; // parallel directions -- no unique intersection
      const rhsX = next.x - prev.x;
      const rhsY = next.y - prev.y;
      const s = (rhsX * -dirB.y - -dirB.x * rhsY) / det;
      const t = (dirA.x * rhsY - dirA.y * rhsX) / det;
      const rs = Math.round(s);
      const rt = Math.round(t);
      if (rs < 1 || rt < 1) continue;
      const px = prev.x + dirA.x * rs;
      const py = prev.y + dirA.y * rs;
      if (px !== next.x + dirB.x * rt || py !== next.y + dirB.y * rt) continue; // rounding broke the match
      consider(px, py, rs + rt);
    }
  }
  return best ?? prev;
}

export interface TubeBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function tubeBounds(cells: readonly Point[]): TubeBounds {
  if (cells.length === 0) return { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const { x, y } of cells) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return { minX, maxX, minY, maxY };
}

/** Shortest distance from `p` to the segment a-b, in grid units -- shared by
 * the knee/segment hit-tests below. */
export function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.hypot(p.x - projX, p.y - projY);
}

/** Index of the nearest knee point to `target` within `maxDist`, or null.
 * Checked before nearestSegmentIndex by callers, since a click near a knee
 * should grab the knee, not the segment it terminates. */
export function nearestKneeIndex(points: readonly Point[], target: Point, maxDist: number): number | null {
  let best: number | null = null;
  let bestDist = maxDist;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Point;
    const d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** Index of the segment (points[i] -> points[i+1]) nearest `target` within
 * `maxDist`, or null. */
export function nearestSegmentIndex(points: readonly Point[], target: Point, maxDist: number): number | null {
  let best: number | null = null;
  let bestDist = maxDist;
  for (let i = 0; i < points.length - 1; i++) {
    const d = pointSegmentDistance(target, points[i] as Point, points[i + 1] as Point);
    if (d <= bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
