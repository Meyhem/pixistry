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
import { SimGrid, TubeMaskValue } from './grid';
import { clearCells, stampGlass } from './apparatus';
import type { SpeciesTable } from './species';
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
import { isWallSpecId } from './walls';

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
    // A cone cell whose one-step-toward-the-mouth target lands on the
    // tube's own wall would be permanently stuck once stampTubeGeometry
    // flags it Cone (see movement.ts -- a Cone cell can only move via this
    // pull, and a wall cell is never empty, so that pull would never fire).
    // Excluded from coneSrcIdx entirely rather than marked Cone with nowhere
    // to go, so ordinary gravity/spread still governs it and it can settle
    // or drift somewhere the cone *can* reach.
    const wallSet = new Set(wallCells.map((c) => `${c.x},${c.y}`));
    for (const cell of cone) {
      const srcI = idx(grid, cell);
      if (srcI === null) continue;
      const target = stepToward(cell, mouthCell);
      if (wallSet.has(`${target.x},${target.y}`)) continue;
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
  clearCells(grid, geometry.wallCells);
  for (const i of geometry.lumenIdx) {
    if ((grid.tubeMask[i] as TubeMaskValue) === TubeMaskValue.Lumen) grid.tubeMask[i] = TubeMaskValue.None;
  }
  for (const i of geometry.coneSrcIdx) {
    if ((grid.tubeMask[i] as TubeMaskValue) === TubeMaskValue.Cone) grid.tubeMask[i] = TubeMaskValue.None;
  }
}

/** The lumen is a bored hole, never cargo: any wall matter sitting in a
 * lumen cell -- an existing vessel wall the tube was drawn across, or
 * another apparatus stamped over the lumen afterward -- is cleared rather
 * than carried along. Without this the glass pixel rode the conveyor to the
 * exit and was ejected into the tip's single open cell, plugging it
 * permanently: nothing can eject into an occupied cell, and glass never
 * moves on its own once out there. (stepOneTube's intake already refuses to
 * suck walls in through the mouth for the same reason; this is the same rule
 * applied to walls that arrive by being stamped, not sucked.) */
function boreWallsFromLumen(grid: SimGrid, lumenIdx: readonly number[]): void {
  for (const i of lumenIdx) {
    if (isWallSpecId(grid.specId[i] as number)) grid.clearAt(i);
  }
}

function markTubeMask(grid: SimGrid, geometry: TubeGeometry): void {
  for (const i of geometry.lumenIdx) grid.tubeMask[i] = TubeMaskValue.Lumen;
  for (const i of geometry.coneSrcIdx) {
    if ((grid.tubeMask[i] as TubeMaskValue) !== TubeMaskValue.Lumen) grid.tubeMask[i] = TubeMaskValue.Cone;
  }
}

/** Re-marks one tube's overlay without touching its glass, for the two ways
 * a tube's mask gets wiped by something that isn't the tube itself: the
 * eraser zeroes grid.tubeMask under its brush (see worker.ts) while leaving
 * any tube whose knee points it missed alive, and one tube's
 * unstampTubeGeometry clears mask cells a second, overlapping tube also
 * claims. Either way the surviving tube kept its tracked path but silently
 * lost the lumen protection movement.ts reads, so its cargo started leaking
 * out sideways -- a conveyor that "sometimes doesn't work" with nothing
 * visibly wrong with it. Glass is deliberately not re-stamped: the eraser is
 * the one tool allowed to take glassware off the grid. */
export function restampTubeMask(grid: SimGrid, instance: TubeInstance): void {
  markTubeMask(grid, instance.geometry);
}

/** Re-bores every tube's lumen (see boreWallsFromLumen) -- called after any
 * apparatus edit that may have stamped fresh glass across a lumen, so a tube
 * isn't left visibly plugged until the next tick gets around to it. */
export function boreTubeLumens(grid: SimGrid, instances: readonly TubeInstance[]): void {
  for (const instance of instances) boreWallsFromLumen(grid, instance.geometry.lumenIdx);
}

/** Takes a whole tube back off the grid -- glass ring and overlay together --
 * for the eraser, which deletes the tracked instance when its brush catches
 * any knee point. Without this the brush only cleared the handful of cells it
 * physically covered, leaving the rest of the tube behind as orphaned glass
 * and, worse, leaving its lumen mask on the grid: an invisible barrier no
 * matter could ever enter again, belonging to a tube that no longer exists.
 * The flask's eraser path already worked this way (see flask.ts's
 * unstampFlask). */
export function unstampTube(grid: SimGrid, instance: TubeInstance): void {
  unstampTubeGeometry(grid, instance.geometry);
}

/** Stamps wall cells as glass (see apparatus.ts's stampGlass -- same
 * "overwrite, seed at ambient" convention placeFunnelInstance uses) and
 * marks lumen/cone cells in the overlay mask -- lumen cells' existing
 * contents are left alone (a cell that was already lumen cargo before an
 * edit, and still is after, keeps its contents automatically since nothing
 * here clears it). */
function stampTubeGeometry(grid: SimGrid, species: SpeciesTable, geometry: TubeGeometry): void {
  stampGlass(grid, species, geometry.wallCells);
  boreWallsFromLumen(grid, geometry.lumenIdx);
  markTubeMask(grid, geometry);
}

export interface TubePlacement {
  readonly points: readonly Point[];
  readonly coneSize: number;
  readonly filter: ReadonlySet<number> | null;
}

/** Drops consecutive duplicate knees, which the draw tool produces whenever
 * two clicks land on the same cell (snapOctant returns the anchor unchanged
 * for a zero delta). A duplicate is a zero-length segment, and a tube built
 * entirely out of them has no direction of travel at all -- see
 * hasDegenerateSegment for what a collapsed tube behaves like. Callers should
 * refuse to place the result if fewer than 2 knees survive. */
export function normalizeTubePoints(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && last.x === p.x && last.y === p.y) continue;
    out.push({ x: p.x, y: p.y });
  }
  return out;
}

/** Places a new tube: stamps its walls/overlay and returns the tracked
 * instance. `points` must already be octant-snapped (see tube-shapes.ts's
 * snapOctant) -- the drawing UI is responsible for that, same as the
 * funnel tool owns its own facing before calling placeFunnelInstance. */
export function placeTubeInstance(grid: SimGrid, species: SpeciesTable, placement: TubePlacement): TubeInstance {
  const points = normalizeTubePoints(placement.points);
  const geometry = buildTubeGeometry(grid, points, placement.coneSize);
  stampTubeGeometry(grid, species, geometry);
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
function rebuildTubeGeometry(grid: SimGrid, species: SpeciesTable, instance: TubeInstance, newPoints: Point[], newConeSize: number): void {
  unstampTubeGeometry(grid, instance.geometry);
  const geometry = buildTubeGeometry(grid, newPoints, newConeSize);
  stampTubeGeometry(grid, species, geometry);
  instance.points = newPoints;
  instance.coneSize = newConeSize;
  instance.geometry = geometry;
}

/** Whether any two consecutive knees land on the same cell, which would
 * shorten the tube by a whole segment -- and, for a two-knee tube, collapse
 * it outright.
 *
 * A collapsed tube is a dead tube: polylineToLumenPath yields a single cell,
 * so lumenOpenEnds returns null and the thing has no mouth, no exit and no
 * cone. It's still selectable and still takes settings, they just can't do
 * anything, which reads as "the conveyor stopped working and won't respond
 * to anything" with nothing on screen to explain it. It was easy to hit by
 * accident: snapOctant rounds its step count and floors it at 0, so dragging
 * a knee within about half a cell of its neighbour -- a short drag on a short
 * tube -- landed it exactly on top of that neighbour. Rejecting the drag step
 * instead just means a knee won't push through its neighbour. */
function hasDegenerateSegment(points: readonly Point[]): boolean {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1] as Point;
    const b = points[i] as Point;
    if (a.x === b.x && a.y === b.y) return true;
  }
  return false;
}

/** Drags knee `kneeIndex` toward `raw`. An endpoint knee (the tube's mouth
 * or exit, index 0 or the last) has only one fixed neighbor and moves
 * freely along the octant ray from it (see snapOctant); an interior knee
 * has two fixed neighbors and must satisfy both at once, which
 * resolveKneePosition solves for -- see its doc comment for why a single
 * point generally can't land exactly under the cursor in that case. */
export function moveTubeKnee(grid: SimGrid, species: SpeciesTable, instance: TubeInstance, kneeIndex: number, raw: Point): void {
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
  if (hasDegenerateSegment(newPoints)) return;
  rebuildTubeGeometry(grid, species, instance, newPoints, instance.coneSize);
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
export function moveTubeSegment(grid: SimGrid, species: SpeciesTable, instance: TubeInstance, segIndex: number, dx: number, dy: number): void {
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
  if (hasDegenerateSegment(newPoints)) return;
  rebuildTubeGeometry(grid, species, instance, newPoints, instance.coneSize);
}

export interface TubeConfig {
  readonly coneSize: number;
  readonly filter: ReadonlySet<number> | null;
}

/** Live-edits a placed tube's cone size / species filter (the select-
 * apparatus tool's edit panel) -- geometry (points) only ever changes via
 * moveTubeKnee/moveTubeSegment, never here, so a cone-size change is the
 * only case that needs a re-stamp. */
export function updateTubeInstance(grid: SimGrid, species: SpeciesTable, instance: TubeInstance, config: TubeConfig): void {
  instance.filter = config.filter ? new Set(config.filter) : null;
  if (config.coneSize !== instance.coneSize) {
    rebuildTubeGeometry(grid, species, instance, instance.points, config.coneSize);
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
  // Re-checked every tick, not just at placement: a flask/funnel/glass line
  // (or another tube's wall ring) stamped over this lumen later would
  // otherwise plug the exit on its way out -- see boreWallsFromLumen.
  boreWallsFromLumen(grid, lumenIdx);

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

/** The cone cells that are actually holding something this tick, mapped to
 * what each one accepts (null = every species). movement.ts suppresses
 * ordinary gravity/spread for a cell sitting in a suction cone so the tube
 * gets to walk it inward before it falls back out -- but that hold has to be
 * conditional, because a held cell the tube will never actually pull is
 * frozen in mid-air forever: it can't fall, can't spread, and nothing else
 * moves it, so it just hangs there as an invisible obstacle. Two ways that
 * happened:
 *
 * - the cell's species isn't on the tube's own filter list, so stepOneTube
 *   skips it every tick (drop a grain of anything else into a filtered
 *   tube's cone and it stuck there permanently);
 * - the cell's one-step-toward-the-mouth target is a wall -- another
 *   apparatus stamped over the cone after placement -- so the pull can never
 *   fire. (Targets landing on the tube's *own* wall are already excluded at
 *   build time, see buildTubeGeometry; this covers walls that arrive later.)
 *
 * A cone cell whose target is merely occupied still holds: that's the tube
 * being backed up, and the queue waiting at its mouth is the intended
 * backpressure, not a stuck cell.
 */
export type ConeHold = ReadonlyMap<number, ReadonlySet<number> | null>;

export const NO_CONE_HOLD: ConeHold = new Map();

export function coneHoldMap(grid: SimGrid, instances: readonly TubeInstance[]): ConeHold {
  const map = new Map<number, Set<number> | null>();
  for (const instance of instances) {
    const { coneSrcIdx, conePullTargetIdx } = instance.geometry;
    for (let i = 0; i < coneSrcIdx.length; i++) {
      if (isWallSpecId(grid.specId[conePullTargetIdx[i] as number] as number)) continue;
      const src = coneSrcIdx[i] as number;
      if (instance.filter === null) {
        map.set(src, null); // accepts everything -- outranks any filter already recorded here
        continue;
      }
      if (!map.has(src)) {
        map.set(src, new Set(instance.filter));
        continue;
      }
      // Overlapping cones: the cell is held for anything *either* tube would
      // take, since either one pulling it out is a real move.
      const existing = map.get(src);
      if (existing) for (const specId of instance.filter) existing.add(specId);
    }
  }
  return map;
}

/** Whether `specId` sitting at cone cell `idx` is held by the tube that owns
 * it -- see ConeHold. False for any cell no cone claims, so a stale mask
 * (erased, or left behind by a tube that's gone) never freezes anything. */
export function coneHolds(hold: ConeHold, idx: number, specId: number): boolean {
  const filter = hold.get(idx);
  if (filter === undefined) return false;
  return filter === null || filter.has(specId);
}

/** A tube's glass footprint -- the wall ring, not the lumen (which is a bored
 * hole, never matter). Exposed for worker.ts's cross-apparatus glass repair. */
export function tubeGlassCells(instance: TubeInstance): readonly Point[] {
  return instance.geometry.wallCells;
}
