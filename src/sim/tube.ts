// Conveyor-tube apparatus: a placed instance is tracked state (same reason
// as funnel.ts's FunnelInstance -- see that file's module comment) since it
// needs to remember its knee points, cone size, and species filter across
// ticks, and the transport itself needs a stable ordered path to walk every
// tick rather than re-deriving one from the grid each time.
//
// Unlike the funnel's glass outline, the tube's lumen is NOT stamped as
// matter: only the wall ring (see tube-shapes.ts's lumenWallCells) is real
// glass. The lumen and cone are a pure overlay (grid.tubeMask), and
// whatever real matter happens to sit in a lumen cell IS the tube's cargo --
// movement.ts already knows to leave those cells alone (blocked as both a
// mover and a destination) so only stepTubes below ever touches them.
import { PhaseCode, SimGrid, TubeMaskValue } from './grid';
import {
  coneCells,
  lumenOpenEnds,
  lumenWallCells,
  polylineToLumenPath,
  resolveKneePosition,
  snapOctant,
  tubeBounds,
  type Point,
  type TubeBounds,
} from './tube-shapes';
import { GLASS_WALL_SPEC_ID, isWallSpecId } from './walls';

export const TUBE_LABEL = 'Conveyor Tube';
export const TUBE_COLOR = '#a9d6e8'; // same glass tint as the funnel/plain glass wall

export const DEFAULT_TUBE_CONE_SIZE = 3;

/** Precomputed grid-index form of a tube's geometry -- rebuilt whenever the
 * knee points or cone size change (placeTubeInstance / moveTubeKnee /
 * moveTubeSegment / updateTubeInstance), never touched per-tick otherwise,
 * so stepTubes' hot path is just array walks with no geometry math. */
interface TubeGeometry {
  readonly wallCells: readonly Point[];
  readonly lumenIdx: readonly number[];
  readonly exitOpenIdx: number | null;
  /** Parallel arrays: coneSrcIdx[i] is a cone cell, conePullTargetIdx[i] is
   * the single grid step toward the mouth it gets pulled to -- ordered
   * mouth-outward (row 1 first) so a full cone column advances by exactly
   * one step per tick, mirroring lumenIdx's own exit-first processing
   * order in stepOneTube. Both arrays are pre-filtered to in-bounds pairs
   * only. */
  readonly coneSrcIdx: readonly number[];
  readonly conePullTargetIdx: readonly number[];
  readonly bounds: TubeBounds;
}

export interface TubeInstance {
  readonly id: number;
  points: Point[];
  coneSize: number;
  /** null = accept every species (the default "all" filter). */
  filter: Set<number> | null;
  geometry: TubeGeometry;
}

let nextTubeId = 1;

function idx(grid: SimGrid, p: Point): number | null {
  return grid.inBounds(p.x, p.y) ? grid.index(p.x, p.y) : null;
}

/** One grid step from `from` directly toward `to` (Chebyshev step, not a
 * full octant snap -- `to` is always exactly one row further "in" than
 * `from` by construction of coneCells, so a single sign-step always lands
 * exactly one cell closer). */
function stepToward(from: Point, to: Point): Point {
  return { x: from.x + Math.sign(to.x - from.x), y: from.y + Math.sign(to.y - from.y) };
}

function buildTubeGeometry(grid: SimGrid, points: readonly Point[], coneSize: number): TubeGeometry {
  const lumenCells = polylineToLumenPath(points);
  const wallCells = lumenWallCells(lumenCells);
  const openEnds = lumenOpenEnds(lumenCells);
  const lumenIdx: number[] = [];
  for (const cell of lumenCells) {
    const i = idx(grid, cell);
    if (i !== null) lumenIdx.push(i);
  }
  const exitOpenIdx = openEnds ? idx(grid, openEnds.exitOpenCell) : null;

  const cone = openEnds ? coneCells(openEnds, coneSize) : [];
  const coneSrcIdx: number[] = [];
  const conePullTargetIdx: number[] = [];
  if (openEnds) {
    const mouthCell = openEnds.mouthCell;
    for (const cell of cone) {
      const srcI = idx(grid, cell);
      if (srcI === null) continue;
      const target = stepToward(cell, mouthCell);
      const targetI = idx(grid, target);
      if (targetI === null) continue;
      coneSrcIdx.push(srcI);
      conePullTargetIdx.push(targetI);
    }
  }

  const allCells = [...lumenCells, ...wallCells, ...cone];
  return { wallCells, lumenIdx, exitOpenIdx, coneSrcIdx, conePullTargetIdx, bounds: tubeBounds(allCells) };
}

/** Clears a tube's wall footprint back to empty and resets its overlay mask
 * -- matter sitting in old lumen/cone cells is left exactly where it is,
 * just no longer flagged as tube cargo (see the module comment: this is
 * the "released as ordinary matter" behavior for cells that fall outside a
 * new geometry after an edit). */
function unstampTubeGeometry(grid: SimGrid, geometry: TubeGeometry): void {
  for (const cell of geometry.wallCells) {
    if (grid.inBounds(cell.x, cell.y)) grid.clear(cell.x, cell.y);
  }
  for (const i of geometry.lumenIdx) {
    if ((grid.tubeMask[i] as TubeMaskValue) === TubeMaskValue.Lumen) grid.tubeMask[i] = TubeMaskValue.None;
  }
  for (const i of geometry.coneSrcIdx) {
    if ((grid.tubeMask[i] as TubeMaskValue) === TubeMaskValue.Cone) grid.tubeMask[i] = TubeMaskValue.None;
  }
}

/** Stamps wall cells as glass (overwriting whatever's there, same
 * "overwrite" convention placeFunnelInstance uses) and marks lumen/cone
 * cells in the overlay mask -- lumen cells' existing contents are left
 * alone (a cell that was already lumen cargo before an edit, and still is
 * after, keeps its contents automatically since nothing here clears it). */
function stampTubeGeometry(grid: SimGrid, geometry: TubeGeometry): void {
  for (const cell of geometry.wallCells) {
    if (grid.inBounds(cell.x, cell.y)) grid.set(cell.x, cell.y, GLASS_WALL_SPEC_ID, PhaseCode.Solid, 0);
  }
  for (const i of geometry.lumenIdx) grid.tubeMask[i] = TubeMaskValue.Lumen;
  for (const i of geometry.coneSrcIdx) {
    if ((grid.tubeMask[i] as TubeMaskValue) !== TubeMaskValue.Lumen) grid.tubeMask[i] = TubeMaskValue.Cone;
  }
}

export interface TubePlacement {
  readonly points: readonly Point[];
  readonly coneSize: number;
  readonly filter: ReadonlySet<number> | null;
}

/** Places a new tube: stamps its walls/overlay and returns the tracked
 * instance. `points` must already be octant-snapped (see tube-shapes.ts's
 * snapOctant) -- the drawing UI is responsible for that, same as the
 * funnel tool owns its own facing before calling placeFunnelInstance. */
export function placeTubeInstance(grid: SimGrid, placement: TubePlacement): TubeInstance {
  const points = placement.points.map((p) => ({ x: p.x, y: p.y }));
  const geometry = buildTubeGeometry(grid, points, placement.coneSize);
  stampTubeGeometry(grid, geometry);
  return {
    id: nextTubeId++,
    points,
    coneSize: placement.coneSize,
    filter: placement.filter ? new Set(placement.filter) : null,
    geometry,
  };
}

/** Re-derives and re-stamps a tube's geometry after its points or cone size
 * changed -- shared by moveTubeKnee/moveTubeSegment (points change) and
 * updateTubeInstance's cone-size edits. */
function rebuildTubeGeometry(grid: SimGrid, instance: TubeInstance, newPoints: Point[], newConeSize: number): void {
  unstampTubeGeometry(grid, instance.geometry);
  const geometry = buildTubeGeometry(grid, newPoints, newConeSize);
  stampTubeGeometry(grid, geometry);
  instance.points = newPoints;
  instance.coneSize = newConeSize;
  instance.geometry = geometry;
}

/** Drags knee `kneeIndex` toward `raw`. An endpoint knee (the tube's mouth
 * or exit, index 0 or the last) has only one fixed neighbor and moves
 * freely along the octant ray from it (see snapOctant); an interior knee
 * has two fixed neighbors and must satisfy both at once, which
 * resolveKneePosition solves for -- see its doc comment for why a single
 * point generally can't land exactly under the cursor in that case. */
export function moveTubeKnee(grid: SimGrid, instance: TubeInstance, kneeIndex: number, raw: Point): void {
  const points = instance.points;
  if (kneeIndex < 0 || kneeIndex >= points.length) return;
  const prev = points[kneeIndex - 1];
  const next = points[kneeIndex + 1];
  let newPoint: Point;
  if (prev && next) {
    newPoint = resolveKneePosition(prev, next, raw);
  } else if (prev) {
    newPoint = snapOctant(prev, raw);
  } else if (next) {
    newPoint = snapOctant(next, raw);
  } else {
    newPoint = raw;
  }
  const newPoints = points.slice();
  newPoints[kneeIndex] = newPoint;
  rebuildTubeGeometry(grid, instance, newPoints, instance.coneSize);
}

/** Drags segment (segIndex, segIndex+1) by (dx, dy): both its points
 * translate together (preserving the segment's own direction/length
 * exactly, so no re-snap is needed for the dragged segment itself), while
 * each outer neighbor (segIndex-1 / segIndex+2, if any) stays fixed and
 * pulls its adjoining point back onto a valid octant connection via
 * resolveKneePosition -- the same "connected points move, their other
 * points don't" rule moveTubeKnee applies to a single knee, applied to both
 * ends of the dragged segment in sequence (segIndex first, so segIndex+1
 * resolves against segIndex's already-updated position). */
export function moveTubeSegment(grid: SimGrid, instance: TubeInstance, segIndex: number, dx: number, dy: number): void {
  const points = instance.points;
  const i = segIndex;
  const j = segIndex + 1;
  if (i < 0 || j >= points.length) return;
  const rawI = { x: (points[i] as Point).x + dx, y: (points[i] as Point).y + dy };
  const rawJ = { x: (points[j] as Point).x + dx, y: (points[j] as Point).y + dy };
  const outerPrev = points[i - 1];
  const newI = outerPrev ? resolveKneePosition(outerPrev, points[j] as Point, rawI) : rawI;
  const outerNext = points[j + 1];
  const newJ = outerNext ? resolveKneePosition(newI, outerNext, rawJ) : rawJ;
  const newPoints = points.slice();
  newPoints[i] = newI;
  newPoints[j] = newJ;
  rebuildTubeGeometry(grid, instance, newPoints, instance.coneSize);
}

export interface TubeConfig {
  readonly coneSize: number;
  readonly filter: ReadonlySet<number> | null;
}

/** Live-edits a placed tube's cone size / species filter (the select-
 * apparatus tool's edit panel) -- geometry (points) only ever changes via
 * moveTubeKnee/moveTubeSegment, never here, so a cone-size change is the
 * only case that needs a re-stamp. */
export function updateTubeInstance(grid: SimGrid, instance: TubeInstance, config: TubeConfig): void {
  instance.filter = config.filter ? new Set(config.filter) : null;
  if (config.coneSize !== instance.coneSize) {
    rebuildTubeGeometry(grid, instance, instance.points, config.coneSize);
  }
}

/** One tick's worth of transport + suction for a single tube:
 *
 * 1. Exit-first advance: walked from the exit backward so each lumen cell
 *    shifts forward by at most one step this tick (the same shift-register
 *    trick a conveyor belt needs -- processing front-to-back within one
 *    pass would let a cell cascade multiple steps in a single tick).
 *    Ejection at the exit only succeeds into an empty, non-wall,
 *    non-lumen cell; if it's blocked, the last lumen cell simply stays put
 *    (backpressure), which in turn blocks every cell behind it from
 *    advancing that tick too, entirely for free from the same backward
 *    scan.
 * 2. Suction: cone cells are pulled one step toward the mouth, nearest-to-
 *    mouth first (same ordering rationale as step 1, mirrored). The mouth's
 *    own pull target is the tube's first lumen cell -- when that's already
 *    occupied (the tube is backed up), intake simply stalls there, which is
 *    the same backpressure behavior extended out through the cone.
 */
function stepOneTube(grid: SimGrid, instance: TubeInstance): void {
  const { lumenIdx, exitOpenIdx, coneSrcIdx, conePullTargetIdx } = instance.geometry;
  const n = lumenIdx.length;
  if (n === 0) return;

  const lastIdx = lumenIdx[n - 1] as number;
  if (!grid.isEmptyAt(lastIdx)) {
    if (exitOpenIdx !== null && grid.isEmptyAt(exitOpenIdx) && (grid.tubeMask[exitOpenIdx] as TubeMaskValue) === TubeMaskValue.None) {
      grid.swap(lastIdx, exitOpenIdx);
    }
  }
  for (let i = n - 2; i >= 0; i--) {
    const cur = lumenIdx[i] as number;
    const next = lumenIdx[i + 1] as number;
    if (!grid.isEmptyAt(cur) && grid.isEmptyAt(next)) {
      grid.swap(cur, next);
    }
  }

  const mouthIdx = lumenIdx[0] as number;
  for (let i = 0; i < coneSrcIdx.length; i++) {
    const src = coneSrcIdx[i] as number;
    if (grid.isEmptyAt(src)) continue;
    const specId = grid.specId[src] as number;
    if (isWallSpecId(specId)) continue;
    if (instance.filter && !instance.filter.has(specId)) continue;
    const target = conePullTargetIdx[i] as number;
    if (target === mouthIdx) {
      if (!grid.isEmptyAt(target)) continue; // tube backed up -- intake stalls
    } else {
      if (!grid.isEmptyAt(target)) continue;
      if ((grid.tubeMask[target] as TubeMaskValue) === TubeMaskValue.Lumen) continue; // never siphon into another tube's lumen
    }
    grid.swap(src, target);
  }
}

export function stepTubes(grid: SimGrid, instances: readonly TubeInstance[]): void {
  for (const instance of instances) stepOneTube(grid, instance);
}
