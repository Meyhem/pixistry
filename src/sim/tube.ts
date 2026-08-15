// Conveyor-tube apparatus: a placed instance is tracked state (same reason
// as funnel.ts's FunnelInstance -- see that file's module comment) since it
// needs to remember its knee points, cone size, and species filter across
// ticks, and the transport itself needs a stable ordered path to walk every
// tick rather than re-deriving one from the grid each time.
//
// Unlike the funnel's glass outline, the tube's channel is NOT matter: only
// the wall ring (see tube-shapes.ts's lumenWallCells) is real glass. The
// channel is a pure overlay (grid.tubeMask), and whatever real matter happens
// to sit in one of its cells IS the tube's cargo -- movement.ts already knows
// to leave those cells alone (blocked as both a mover and a destination) so
// only stepTubes below ever touches them. Both halves of that footprint reach
// the grid through the compositor (entity-composite.ts); nothing here stamps
// or unstamps anything.
//
// The channel is 3 cells wide and the tube's only openings are the three
// cells straight out from each end (see tube-shapes.ts's apertureCells).
// This replaced a single-file channel plus a widening suction cone in front
// of the mouth that reached out several cells and pulled matter in from a
// distance. The cone had to suppress ordinary gravity for everything standing
// in it, or matter would fall past before the tube's turn came -- and
// anything the tube would never actually take (wrong species, or a pull
// target that some later-placed apparatus had walled off) was then frozen in
// mid-air forever, an invisible obstacle with nothing on screen to explain
// it. A mouth that only takes what arrives at it needs no hold at all, so
// that entire bug class is gone rather than patched.
import { SimGrid, TubeMaskValue } from './grid';
import { nextEntityId } from './entity-id';
import {
  apertureCells,
  distanceToExit,
  isOctantAligned,
  lumenBand,
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

/** Precomputed grid-index form of a tube's geometry -- rebuilt whenever the
 * knee points change (placeTubeInstance / moveTubeKnee / moveTubeSegment),
 * never touched per-tick otherwise, so stepTubes' hot path is just array
 * walks with no geometry math. */
interface TubeGeometry {
  readonly wallCells: readonly Point[];
  /** The 3-wide channel, as cells (the compositor's footprint) and as grid
   * indices (stepOneTube's hot path) -- the same band in both forms, since
   * one declares the tube's shape and the other is what transport walks.
   * Both are ordered identically, so index i means the same cell in each. */
  readonly lumenCells: readonly Point[];
  readonly lumenIdx: readonly number[];
  /** 8-connected steps from each band cell to the way out, parallel to
   * lumenIdx (see tube-shapes.ts's distanceToExit). */
  readonly exitDistance: readonly number[];
  /** Band cell indices, sorted by ascending exitDistance -- the order
   * stepOneTube advances them in, precomputed so a tick is one pass. */
  readonly advanceOrder: readonly number[];
  /** Neighbours strictly closer to the exit, parallel to lumenIdx: cargo at
   * band cell i may move to any of downhillIdx[i]. */
  readonly downhillIdx: readonly (readonly number[])[];
  /** The three cells matter is taken in through, and the three it leaves
   * through -- the tube's only openings (see tube-shapes.ts's
   * apertureCells). Pre-filtered to in-bounds cells. */
  readonly mouthApertureIdx: readonly number[];
  readonly exitApertureIdx: readonly number[];
  /** Band cells adjacent to an exit aperture, paired with the aperture cells
   * each can discharge into. */
  readonly dischargeIdx: readonly number[];
  readonly dischargeTargets: readonly (readonly number[])[];
  /** Band cells adjacent to a mouth aperture, paired with the aperture cells
   * each can draw from -- the whole of the suction model. */
  readonly intakeIdx: readonly number[];
  readonly intakeSources: readonly (readonly number[])[];
  readonly bounds: TubeBounds;
}

export interface TubeInstance {
  readonly kind: 'tube';
  /** Placement order across every apparatus kind -- see entity-id.ts. */
  readonly entityId: number;
  points: Point[];
  /** null = accept every species (the default "all" filter). */
  filter: Set<number> | null;
  geometry: TubeGeometry;
}

function idx(grid: SimGrid, p: Point): number | null {
  return grid.inBounds(p.x, p.y) ? grid.index(p.x, p.y) : null;
}

const EMPTY_GEOMETRY_BOUNDS = { minX: 0, maxX: 0, minY: 0, maxY: 0 };

/** Chebyshev adjacency, which is what the band, the distance field and every
 * transport step all use -- a diagonal neighbour is a neighbour. */
function isAdjacent(a: Point, b: Point): boolean {
  const dx = Math.abs(a.x - b.x);
  const dy = Math.abs(a.y - b.y);
  return (dx | dy) !== 0 && dx <= 1 && dy <= 1;
}

function buildTubeGeometry(grid: SimGrid, points: readonly Point[]): TubeGeometry {
  const centerPath = polylineToLumenPath(points);
  const band = lumenBand(centerPath);
  const openEnds = lumenOpenEnds(centerPath);
  const mouthAperture = openEnds ? apertureCells(openEnds.mouthCell, openEnds.mouthDir) : [];
  const exitAperture = openEnds ? apertureCells(openEnds.exitCell, openEnds.exitDir) : [];
  const wallCells = lumenWallCells(band, [...mouthAperture, ...exitAperture]);

  // The band is kept whole (the compositor stamps every cell of it, in or out
  // of bounds is its problem), but transport only ever walks the in-bounds
  // part -- hence one filtered view with its own index space.
  const lumenCells: Point[] = [];
  const lumenIdx: number[] = [];
  for (const cell of band) {
    const i = idx(grid, cell);
    if (i === null) continue;
    lumenCells.push(cell);
    lumenIdx.push(i);
  }

  const exitDistance = distanceToExit(lumenCells, exitAperture);
  const advanceOrder = lumenCells.map((_, i) => i).filter((i) => Number.isFinite(exitDistance[i] as number));
  advanceOrder.sort((a, b) => (exitDistance[a] as number) - (exitDistance[b] as number));

  const downhillIdx: number[][] = lumenCells.map(() => []);
  for (let i = 0; i < lumenCells.length; i++) {
    const here = exitDistance[i] as number;
    if (!Number.isFinite(here)) continue;
    for (let j = 0; j < lumenCells.length; j++) {
      if (i === j || (exitDistance[j] as number) >= here) continue;
      if (isAdjacent(lumenCells[i] as Point, lumenCells[j] as Point)) (downhillIdx[i] as number[]).push(j);
    }
  }

  const apertureIndices = (cells: readonly Point[]): number[] => cells.flatMap((c) => { const i = idx(grid, c); return i === null ? [] : [i]; });
  const mouthApertureIdx = apertureIndices(mouthAperture);
  const exitApertureIdx = apertureIndices(exitAperture);

  /** Band cells touching `aperture`, each paired with the aperture cells it
   * touches -- the mouth's intake pairs and the exit's discharge pairs are
   * the same adjacency computed from opposite ends. */
  function pairWithAperture(aperture: readonly Point[]): { bandIdx: number[]; partners: number[][] } {
    const bandIdx: number[] = [];
    const partners: number[][] = [];
    for (let i = 0; i < lumenCells.length; i++) {
      const touching: number[] = [];
      for (const cell of aperture) {
        if (!isAdjacent(lumenCells[i] as Point, cell)) continue;
        const j = idx(grid, cell);
        if (j !== null) touching.push(j);
      }
      if (touching.length === 0) continue;
      bandIdx.push(i);
      partners.push(touching);
    }
    return { bandIdx, partners };
  }
  const discharge = pairWithAperture(exitAperture);
  const intake = pairWithAperture(mouthAperture);

  const allCells = [...band, ...wallCells, ...mouthAperture, ...exitAperture];
  return {
    wallCells,
    lumenCells,
    lumenIdx,
    exitDistance,
    advanceOrder,
    downhillIdx,
    mouthApertureIdx,
    exitApertureIdx,
    dischargeIdx: discharge.bandIdx,
    dischargeTargets: discharge.partners,
    intakeIdx: intake.bandIdx,
    intakeSources: intake.partners,
    bounds: allCells.length > 0 ? tubeBounds(allCells) : EMPTY_GEOMETRY_BOUNDS,
  };
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

export interface TubePlacement {
  readonly points: readonly Point[];
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

/** Places a new tube and returns the tracked instance (its walls and overlay
 * reach the grid when the caller composites the bench). `points` must already
 * be octant-snapped (see tube-shapes.ts's snapOctant) -- the drawing UI is
 * responsible for that, same as the funnel tool owns its own facing before
 * calling placeFunnelInstance. */
export function placeTubeInstance(grid: SimGrid, placement: TubePlacement): TubeInstance {
  const points = normalizeTubePoints(placement.points);
  return {
    kind: 'tube',
    entityId: nextEntityId(),
    points,
    filter: placement.filter ? new Set(placement.filter) : null,
    geometry: buildTubeGeometry(grid, points),
  };
}

/** Re-derives a tube's cached geometry after its points changed -- shared by
 * moveTubeKnee and moveTubeSegment. */
function rebuildTubeGeometry(grid: SimGrid, instance: TubeInstance, newPoints: Point[]): void {
  instance.points = newPoints;
  instance.geometry = buildTubeGeometry(grid, newPoints);
}

/** Whether any two consecutive knees land on the same cell, which would
 * shorten the tube by a whole segment -- and, for a two-knee tube, collapse
 * it outright.
 *
 * A collapsed tube is a dead tube: polylineToLumenPath yields a single cell,
 * so lumenOpenEnds returns null and the thing has no mouth and no exit. It's
 * still selectable and still takes settings, they just can't do
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
    // Off-axis pairs are meant to be impossible (every knee is octant-snapped
    // against its neighbour), but a resolve that can't satisfy both of an
    // interior knee's neighbours at once falls back to a point that satisfies
    // neither. A tube built from one has walls that don't join, so refuse the
    // drag step the same way a collapsed one is refused.
    if (!isOctantAligned(a, b)) return true;
  }
  return false;
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
  if (hasDegenerateSegment(newPoints)) return;
  rebuildTubeGeometry(grid, instance, newPoints);
}

/** Slides the whole tube by (dx, dy) -- every knee translates together, so
 * the shape is preserved exactly and no re-snap is needed. Distinct from
 * moveTubeSegment, which drags one segment and lets its outer neighbours pull
 * the adjoining knees back onto valid octant rays. */
export function moveTubeInstance(grid: SimGrid, instance: TubeInstance, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  rebuildTubeGeometry(
    grid,
    instance,
    instance.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
  );
}

export interface TubeConfig {
  readonly filter: ReadonlySet<number> | null;
}

/** Live-edits a placed tube's species filter (the select-apparatus tool's
 * edit panel). Geometry only ever changes via moveTubeKnee/moveTubeSegment,
 * never here, so there's nothing to rebuild. */
export function updateTubeInstance(instance: TubeInstance, config: TubeConfig): void {
  instance.filter = config.filter ? new Set(config.filter) : null;
}

/** Whether the tube will carry `specId` at all. Walls are never cargo (see
 * boreWallsFromLumen for what happens to one that lands in the channel), and
 * a filtered tube takes only what's on its own list. */
function accepts(instance: TubeInstance, specId: number): boolean {
  if (isWallSpecId(specId)) return false;
  return instance.filter === null || instance.filter.has(specId);
}

/** One tick's worth of transport for a single tube, in three passes:
 *
 * 1. *Discharge.* Band cells touching an exit aperture push their contents
 *    out into an empty aperture cell. A blocked exit means they stay, which
 *    backs the whole channel up behind them for free -- pass 2 can only move
 *    cargo into cells that are empty *now*.
 * 2. *Advance.* Every occupied band cell steps to an 8-adjacent band cell
 *    strictly closer to the exit (see tube-shapes.ts's distanceToExit).
 *    Walked in ascending distance -- nearest the exit first -- so each cell
 *    moves at most one step per tick: the shift-register property a conveyor
 *    needs, since processing back-to-front would let one cell cascade the
 *    whole length of the tube in a single tick. Following the distance field
 *    rather than a stored path order is what lets a 3-wide channel turn a
 *    corner: the three lanes fan around the inside of a bend at different
 *    rates and re-converge, with no per-segment bookkeeping.
 * 3. *Intake.* Anything sitting in a mouth aperture cell is drawn into an
 *    empty band cell behind it. That is the entire suction model -- the tube
 *    takes what arrives at its mouth and reaches for nothing. Matter it
 *    won't accept simply falls past, because nothing is holding it there.
 */
function stepOneTube(grid: SimGrid, instance: TubeInstance): void {
  const { lumenIdx, advanceOrder, downhillIdx, dischargeIdx, dischargeTargets, intakeIdx, intakeSources } = instance.geometry;
  if (lumenIdx.length === 0) return;
  // Re-checked every tick, not just at placement: a wall painted across the
  // channel (or a scenario's own walls, which the compositor doesn't own)
  // would otherwise plug it -- see boreWallsFromLumen.
  boreWallsFromLumen(grid, lumenIdx);

  for (let k = 0; k < dischargeIdx.length; k++) {
    const from = lumenIdx[dischargeIdx[k] as number] as number;
    if (grid.isEmptyAt(from)) continue;
    for (const to of dischargeTargets[k] as readonly number[]) {
      // Never discharge into another tube's channel: that would bypass its
      // mouth and its filter entirely.
      if (!grid.isEmptyAt(to) || (grid.tubeMask[to] as TubeMaskValue) !== TubeMaskValue.None) continue;
      grid.swap(from, to);
      break;
    }
  }

  for (const i of advanceOrder) {
    const from = lumenIdx[i] as number;
    if (grid.isEmptyAt(from)) continue;
    for (const j of downhillIdx[i] as readonly number[]) {
      const to = lumenIdx[j] as number;
      if (!grid.isEmptyAt(to)) continue;
      grid.swap(from, to);
      break;
    }
  }

  for (let k = 0; k < intakeIdx.length; k++) {
    const to = lumenIdx[intakeIdx[k] as number] as number;
    if (!grid.isEmptyAt(to)) continue; // channel backed up -- intake stalls
    for (const from of intakeSources[k] as readonly number[]) {
      if (grid.isEmptyAt(from)) continue;
      if ((grid.tubeMask[from] as TubeMaskValue) !== TubeMaskValue.None) continue; // don't steal another tube's cargo
      if (!accepts(instance, grid.specId[from] as number)) continue;
      grid.swap(from, to);
      break;
    }
  }
}

export function stepTubes(grid: SimGrid, instances: readonly TubeInstance[]): void {
  for (const instance of instances) stepOneTube(grid, instance);
}

/** A tube's glass footprint -- the wall ring, not the lumen (which is a bored
 * hole, never matter). */
export function tubeGlassCells(instance: TubeInstance): readonly Point[] {
  return instance.geometry.wallCells;
}

/** A tube's channel footprint -- the 3-wide bore its cargo rides in. */
export function tubeLumenCells(instance: TubeInstance): readonly Point[] {
  return instance.geometry.lumenCells;
}
