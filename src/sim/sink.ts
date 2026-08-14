// The Sink apparatus: a player-drawn straight line (grid.sinkMask overlay,
// same "fixed background field, not matter" convention as filterMask/
// stirrerMask/tubeMask -- see grid.ts) that consumes any non-wall matter
// resting on it and tallies it into one global per-species counter. This is
// the counting/objective primitive campaign scenarios will build on (see
// .grill/campaign-mode.md) -- this first pass ships it to sandbox standalone,
// since "how much have I made" is a fun toy on its own with no campaign code
// at all.
import { SinkMaskValue, type SimGrid } from './grid';
import type { GoalHistoryEntry } from './objectives';
import { SPECIES } from './species-data';
import { isWallSpecId } from './walls';

// How often (in ticks) stepSinks' running totals get snapshotted into
// SinkCounter.history, and how many of those snapshots are kept -- 60 ticks
// = 1 real second at the sim's fixed tick rate, 120 entries = ~2 minutes,
// comfortably longer than any 'rate' goal's sustainSeconds window or a
// Run Test burst (see .grill/campaign-mode.md's Phase 1/5). Evaluated
// against by objectives.ts's evaluateRate, which walks this backward from
// the most recent entry.
const HISTORY_INTERVAL_TICKS = 60;
const HISTORY_MAX_ENTRIES = 120;

export const SINK_LABEL = 'Sink';
export const SINK_COLOR = '#e0489e';

// The Vent (see grid.ts's SinkMaskValue): the same drawn-line primitive as a
// Sink, in a colder grey-blue so the two read as different apparatus at a
// glance even though they behave identically on the grid.
export const VENT_LABEL = 'Vent';
export const VENT_COLOR = '#6f8fa8';

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Every grid cell on the straight line from (x0,y0) to (x1,y1), thickened
 * by `width` (same convention as geometry.ts's forEachCellInRadius radius --
 * 0 means the bare 1px line, 1 adds a ring of cells around each line cell,
 * etc.), deduplicated. Plain Bresenham for the core line: unlike
 * tube-shapes.ts's polylineToLumenPath, which only ever walks already-
 * octant-snapped segments, a sink is a single free-form drag at any angle,
 * so this is the one place in src/sim that needs a real Bresenham. */
export function sinkLineCells(x0: number, y0: number, x1: number, y1: number, width: number): Point[] {
  const core: Point[] = [];
  let x = x0;
  let y = y0;
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    core.push({ x, y });
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
  if (width <= 0) return core;

  const r2 = width * width;
  const seen = new Set<string>();
  const out: Point[] = [];
  for (const c of core) {
    for (let oy = -width; oy <= width; oy++) {
      for (let ox = -width; ox <= width; ox++) {
        if (ox * ox + oy * oy > r2) continue;
        const px = c.x + ox;
        const py = c.y + oy;
        const k = `${px},${py}`;
        if (seen.has(k)) continue;
        seen.add(k);
        out.push({ x: px, y: py });
      }
    }
  }
  return out;
}

/** One global counter shared by every sink line on the grid (per the
 * brainstorm's "not per sink, one global counter" spec) -- indexed by
 * specId, sized to the static species table so every real species has a
 * slot. Wall specIds are never tallied (see stepSinks), so they need no
 * slot here. */
export class SinkCounter {
  readonly totals = new Uint32Array(SPECIES.length);
  grandTotal = 0;
  /** Per-second snapshots of `totals`, oldest first -- what 'rate' goals
   * measure a sustained throughput against (see objectives.ts's
   * evaluateRate). Populated by recordSinkHistory, called once per tick from
   * worker.ts's runOneTick (a no-op most ticks -- see
   * HISTORY_INTERVAL_TICKS). */
  history: GoalHistoryEntry[] = [];

  reset(): void {
    this.totals.fill(0);
    this.grandTotal = 0;
    this.history = [];
  }
}

/** Appends a `{tick, totals}` snapshot to `counter.history` every
 * HISTORY_INTERVAL_TICKS ticks, trimming the oldest entry once the ring
 * buffer exceeds HISTORY_MAX_ENTRIES -- called every tick (cheap no-op on
 * ticks that aren't a snapshot boundary) rather than only while a 'rate'
 * goal is active, so history is already warm the moment a scenario adds one
 * and so a Run Test burst (which runs many ticks without posting frames)
 * still gets a real per-second history to evaluate against. */
export function recordSinkHistory(counter: SinkCounter, tick: number): void {
  if (tick % HISTORY_INTERVAL_TICKS !== 0) return;
  counter.history.push({ tick, totals: counter.totals.slice() });
  if (counter.history.length > HISTORY_MAX_ENTRIES) counter.history.shift();
}

/** One tick's worth of sink/vent consumption: every non-empty, non-wall cell
 * sitting on a masked cell is tallied by specId into the counter its port
 * kind feeds (`sinkCounter` for a Sink, `ventCounter` for a Vent -- see
 * grid.ts's SinkMaskValue) and cleared from the grid. Called last in
 * worker.ts's runOneTick, after stepReactions -- a reactant pair that lands
 * on a sink cell gets its normal chance to react there first, so a sink
 * counts whatever's really present at the end of the tick (a collection
 * port) rather than intercepting feedstock the moment it arrives (a drain)
 * -- see .grill/campaign-mode.md's tick-order decision. */
export function stepSinks(grid: SimGrid, sinkCounter: SinkCounter, ventCounter: SinkCounter): void {
  for (let idx = 0; idx < grid.sinkMask.length; idx++) {
    const port = grid.sinkMask[idx] as SinkMaskValue;
    if (port === SinkMaskValue.None) continue;
    if (grid.isEmptyAt(idx)) continue;
    const specId = grid.specId[idx] as number;
    if (isWallSpecId(specId)) continue;
    const counter = port === SinkMaskValue.Vent ? ventCounter : sinkCounter;
    counter.totals[specId] = (counter.totals[specId] as number) + 1;
    counter.grandTotal += 1;
    grid.clearAt(idx);
  }
}
