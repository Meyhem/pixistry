// The Filter apparatus: a one-cell-wide membrane line that only lets the
// species on *its own* allow-list move into its cells -- everything else is
// blocked exactly like a wall (see movement.ts's canEnterFiltered). There's
// no per-tick step function: the gating happens inline in movement.ts, so
// this module is just the instance model, the mask stamping, and the
// id -> allow-list lookup movement reads.
//
// Every filter line used to share one global allow-list, and drawn lines
// weren't tracked at all -- grid.filterMask was a plain 0/1 flag, so once a
// line was on the grid there was nothing left to select, re-configure or
// move. A line is a tracked instance now, the same way funnels/tubes/flasks
// are, and filterMask carries the *owning instance's id* instead of a flag
// (0 still means "no filter here", so movement's fast path is unchanged).
// That's what makes two membranes on one bench able to pass different
// species -- the whole point of a filter you can place more than one of.
//
// Ids are 1-based and capped at MAX_FILTER_ID because the mask is a
// Uint8Array; freed ids are reused (see allocateFilterId), so a session that
// draws and erases filters all day never runs out.
//
// Nothing here writes grid.filterMask: the membrane cells a line declares are
// its footprint, and the compositor (entity-composite.ts) is what puts them
// on the grid.
import { nextEntityId } from './entity-id';
import { sinkLineCells } from './sink';
import { pointSegmentDistance } from './tube-shapes';

export const FILTER_LABEL = 'Filter';
export const FILTER_COLOR = '#8ce096';

/** Uint8Array mask, and 0 is "no filter" -- so 254 lines can coexist. */
export const MAX_FILTER_ID = 255;

export interface FilterInstance {
  readonly id: number;
  /** Placement order across every apparatus kind -- see entity-id.ts. Note
   * this is not `id`: `id` is what grid.filterMask carries per cell (a
   * Uint8Array, hence the 255 cap and the reuse), and is retired in favor of
   * entityOwner in a later phase. */
  readonly entityId: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Species allowed through this line. Empty means "blocks everything" --
   * the opposite default from the tube's null-means-accept-all, since an
   * unconfigured Filter should read as "I just drew an impermeable line"
   * rather than as a no-op. */
  species: Set<number>;
}

/** What movement.ts consults per filtered cell: mask value (instance id) ->
 * that instance's allow-list. Built once per tick from the live instance
 * list (see worker.ts), so movement never has to search an array. */
export type FilterAllow = ReadonlyMap<number, ReadonlySet<number>>;

export const NO_FILTERS: FilterAllow = new Map();

export function filterAllowMap(filters: readonly FilterInstance[]): FilterAllow {
  const map = new Map<number, ReadonlySet<number>>();
  for (const filter of filters) map.set(filter.id, filter.species);
  return map;
}

/** Lowest id not currently in use, or null when all 255 are taken (at which
 * point drawing another line is refused rather than silently stealing an
 * existing line's cells). */
function allocateFilterId(filters: readonly FilterInstance[]): number | null {
  const used = new Set(filters.map((f) => f.id));
  for (let id = 1; id <= MAX_FILTER_ID; id++) {
    if (!used.has(id)) return id;
  }
  return null;
}

/** The cells a filter line covers: the bare Bresenham core, one cell wide
 * (sinkLineCells with width 0 -- reused rather than hand-rolling a second
 * rasterizer, same as scenario.ts's applyWallLine does). */
export function filterLineCells(filter: FilterInstance): { x: number; y: number }[] {
  return sinkLineCells(filter.x0, filter.y0, filter.x1, filter.y1, 0);
}

export function placeFilterInstance(filters: FilterInstance[], x0: number, y0: number, x1: number, y1: number, species: readonly number[]): FilterInstance | null {
  const id = allocateFilterId(filters);
  if (id === null) return null;
  const filter: FilterInstance = { id, entityId: nextEntityId(), x0, y0, x1, y1, species: new Set(species) };
  filters.push(filter);
  return filter;
}

/** Slides a whole line by (dx, dy), keeping its length and angle. */
export function moveFilterInstance(filter: FilterInstance, dx: number, dy: number): void {
  filter.x0 += dx;
  filter.y0 += dy;
  filter.x1 += dx;
  filter.y1 += dy;
}

/** Drags one end of the line to (x, y), leaving the other where it is -- the
 * reshaping a membrane has instead of a tube's knees, so a line drawn a
 * little short (or at the wrong angle) can be stretched into place rather
 * than erased and redrawn. */
export function moveFilterEndpoint(filter: FilterInstance, endIndex: 0 | 1, x: number, y: number): void {
  if (endIndex === 0) {
    filter.x0 = x;
    filter.y0 = y;
  } else {
    filter.x1 = x;
    filter.y1 = y;
  }
}

export function updateFilterInstance(filter: FilterInstance, species: readonly number[]): void {
  filter.species = new Set(species);
}

/** Nearest filter line within `radius` grid cells of (x, y), or null -- the
 * select-apparatus tool's hit test (see apparatus-selection.ts, which runs
 * the same test against the UI's frame snapshots). */
export function nearestFilter(filters: readonly FilterInstance[], x: number, y: number, radius: number): FilterInstance | null {
  let best: { filter: FilterInstance; dist: number } | null = null;
  for (const filter of filters) {
    const dist = pointSegmentDistance({ x, y }, { x: filter.x0, y: filter.y0 }, { x: filter.x1, y: filter.y1 });
    if (dist <= radius && (!best || dist < best.dist)) best = { filter, dist };
  }
  return best ? best.filter : null;
}
