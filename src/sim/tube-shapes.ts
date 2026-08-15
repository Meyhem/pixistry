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

/** The channel itself: every cell within Chebyshev distance 1 of the center
 * path, so the bore is 3 cells wide on straight runs *and* on diagonals (a
 * Euclidean or Manhattan band would pinch to 1-2 cells across a 45-degree
 * segment, and a conveyor that narrows at every bend jams there). Ordered by
 * the path index that first reached each cell, which is what makes the
 * distance field below monotone along the tube. */
export function lumenBand(centerPath: readonly Point[]): Point[] {
  const seen = new Set<string>();
  const band: Point[] = [];
  for (const cell of centerPath) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const p = { x: cell.x + dx, y: cell.y + dy };
        const k = key(p);
        if (seen.has(k)) continue;
        seen.add(k);
        band.push(p);
      }
    }
  }
  return band;
}

/** The open row just beyond one end of the band: three cells across the
 * perpendicular. That's the tube's whole interface with the outside world --
 * matter is taken in through the mouth's three and discharged through the
 * exit's three, and everything else around the band is wall. Three rather
 * than one so a 3-wide channel isn't fed (or drained) through a single-cell
 * bottleneck.
 *
 * Two steps out from `end`, not one: the band is a Chebyshev-1 dilation of
 * the centre path, so it already caps one cell past the last centre cell. One
 * step would put the aperture *inside* the channel, which reads as a tube
 * whose mouth is its own first cell -- intake and discharge would both be
 * no-ops against themselves. */
export function apertureCells(end: Point, dir: Point): Point[] {
  const perp = { x: -dir.y, y: dir.x };
  const center = { x: end.x + dir.x * 2, y: end.y + dir.y * 2 };
  return [-1, 0, 1].map((k) => ({ x: center.x + perp.x * k, y: center.y + perp.y * k }));
}

/** Every 8-neighbor of the band that is neither band nor aperture -- the
 * glass wall, including knee joins, all from this one flat rule (see the
 * module comment for why octant-snapping is what makes that safe). The rule
 * is unchanged from the single-file lumen it replaced; only what counts as
 * "inside" grew. */
export function lumenWallCells(band: readonly Point[], apertures: readonly Point[] = []): Point[] {
  if (band.length === 0) return [];
  const inside = new Set(band.map(key));
  const openSet = new Set(apertures.map(key));
  const wallSet = new Set<string>();
  for (const cell of band) {
    for (const n of NEIGHBORS_8) {
      const p = { x: cell.x + n.x, y: cell.y + n.y };
      const k = key(p);
      if (inside.has(k) || openSet.has(k) || wallSet.has(k)) continue;
      wallSet.add(k);
    }
  }
  return [...wallSet].map((k) => {
    const [x, y] = k.split(',').map(Number);
    return { x: x as number, y: y as number };
  });
}

/** How many 8-connected steps each band cell is from leaving through the
 * exit, by BFS seeded at the band cells touching an exit aperture. Transport
 * walks this downhill (see tube.ts's stepOneTube), which is what carries
 * cargo around a bend without any per-segment direction bookkeeping: BFS
 * guarantees every reachable cell has a strictly-smaller-distance neighbour,
 * so there is always a way forward and never a loop.
 *
 * Returned as a map keyed the same way the band is indexed -- position i in
 * the returned array is the distance for `band[i]`. Unreachable cells (a band
 * that got severed, which shouldn't happen for a well-formed tube) get
 * Infinity and are simply never advanced. */
export function distanceToExit(band: readonly Point[], exitApertures: readonly Point[]): number[] {
  const indexByKey = new Map<string, number>();
  band.forEach((cell, i) => indexByKey.set(key(cell), i));
  const dist = new Array<number>(band.length).fill(Infinity);
  const queue: number[] = [];
  // Seed: band cells orthogonally or diagonally touching the way out.
  for (const aperture of exitApertures) {
    for (const n of NEIGHBORS_8) {
      const i = indexByKey.get(key({ x: aperture.x + n.x, y: aperture.y + n.y }));
      if (i === undefined || dist[i] === 0) continue;
      dist[i] = 0;
      queue.push(i);
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head] as number;
    const cell = band[i] as Point;
    const next = (dist[i] as number) + 1;
    for (const n of NEIGHBORS_8) {
      const j = indexByKey.get(key({ x: cell.x + n.x, y: cell.y + n.y }));
      if (j === undefined || (dist[j] as number) <= next) continue;
      dist[j] = next;
      queue.push(j);
    }
  }
  return dist;
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
