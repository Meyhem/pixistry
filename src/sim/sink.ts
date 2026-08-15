// The Sink apparatus: a placed straight line (grid.sinkMask overlay, same
// "fixed background field, not matter" convention as stirrerMask/tubeMask --
// see grid.ts) that consumes any non-wall matter resting on it and tallies it
// into one global per-species counter. This is the counting/objective
// primitive campaign scenarios build on (see .grill/campaign-mode.md).
//
// A Sink and a Vent are two entity kinds over one instance shape (see
// PortInstance): identical geometry and identical consumption, differing only
// in which tally they feed. They were painted terrain until phase 6e of
// .grill/entity-overhaul.md -- a brush stroke straight into grid.sinkMask,
// with no way to move, re-aim or remove one short of the eraser. They're
// entities now, so sinkMask is compositor-derived like every other apparatus
// array and a drawn port can be picked up with the Select tool.
import { nextEntityId } from './entity-id';
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

/** How wide a port line can be drawn or stretched to, in the same "0 = the
 * bare 1px line" sense as sinkLineCells' width (and radiators.ts's). The
 * ceiling is the brush-width ceiling the drawing tool already had -- this
 * just gives the edit panel the same range. */
export const MIN_PORT_WIDTH = 0;
export const MAX_PORT_WIDTH = 8;

/** What a Sink and a Vent both are: a line with a width. The two kinds carry
 * no different fields at all -- they diverge only at portMaskValue, i.e. in
 * which tally stepSinks feeds -- but they stay separate `kind`s rather than
 * one kind with a `port` field so that everything generic about entities (the
 * registry row, the tool that places one, the label on the HUD chip) can tell
 * them apart the way it tells any two kinds apart. */
interface PortFields {
  /** Set on apparatus a scenario placed as fixed bench furniture -- see
   * FilterInstance's own `locked`. */
  readonly locked?: boolean;
  /** Placement order across every apparatus kind -- see entity-id.ts. */
  readonly entityId: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Thickness, as sinkLineCells' `width` (0 = one cell wide). */
  width: number;
}

export interface SinkInstance extends PortFields {
  readonly kind: 'sink';
}

export interface VentInstance extends PortFields {
  readonly kind: 'vent';
}

export type PortInstance = SinkInstance | VentInstance;

/** Which SinkMaskValue a kind stamps -- the entire behavioural difference
 * between the two kinds, in one function. */
export function portMaskValue(kind: PortInstance['kind']): SinkMaskValue.Sink | SinkMaskValue.Vent {
  return kind === 'vent' ? SinkMaskValue.Vent : SinkMaskValue.Sink;
}

/** The cells a port covers -- its own line, thickened by its own width. What
 * the compositor stamps into sinkMask, and what the UI draws as its body. */
export function portLineCells(port: PortInstance): Point[] {
  return sinkLineCells(port.x0, port.y0, port.x1, port.y1, port.width);
}

export function placePortInstance<K extends PortInstance['kind']>(
  kind: K,
  params: { x0: number; y0: number; x1: number; y1: number; width: number },
): Extract<PortInstance, { kind: K }> {
  return {
    kind,
    entityId: nextEntityId(),
    x0: params.x0,
    y0: params.y0,
    x1: params.x1,
    y1: params.y1,
    width: clampPortWidth(params.width),
  } as Extract<PortInstance, { kind: K }>;
}

export function movePortInstance(port: PortInstance, dx: number, dy: number): void {
  port.x0 += dx;
  port.y0 += dy;
  port.x1 += dx;
  port.y1 += dy;
}

/** Drags one end of the line, leaving the other where it is -- the same
 * reshaping a filter or radiator line has (see moveFilterEndpoint). */
export function movePortEndpoint(port: PortInstance, endIndex: 0 | 1, x: number, y: number): void {
  if (endIndex === 0) {
    port.x0 = x;
    port.y0 = y;
  } else {
    port.x1 = x;
    port.y1 = y;
  }
}

export function updatePortInstance(port: PortInstance, width: number): void {
  port.width = clampPortWidth(width);
}

/** Guards the one field a port has against a hostile or stale message: a
 * negative width would make sinkLineCells' thickening loop stamp nothing (so
 * a port that eats nothing), and an unbounded one would stamp a disc the size
 * of the bench. */
function clampPortWidth(width: number): number {
  return Math.max(MIN_PORT_WIDTH, Math.min(MAX_PORT_WIDTH, Math.round(width)));
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
