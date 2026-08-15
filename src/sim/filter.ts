// The Filter apparatus: a one-cell-wide membrane line that only lets the
// species on *its own* allow-list move into its cells -- everything else is
// blocked exactly like a wall (see movement.ts's canEnterFiltered). There's
// no per-tick step function: the gating happens inline in movement.ts, so
// this module is just the instance model and the line rasterization.
//
// A membrane cell is marked on the grid purely by ownership: the compositor
// (entity-composite.ts) claims the line's cells in grid.entityOwner, and
// movement looks the owning entity's allow-list up in a per-tick
// entityId -> allow-list map (see filterAllowMap). There used to be a
// separate grid.filterMask carrying a per-kind instance id -- a Uint8Array,
// which meant a 255-line cap, an id allocator, and id reuse that could hand a
// freshly drawn line a stale selection's id. All of that fell away when the
// owner mask (which every entity already has) became the lookup key.
import { nextEntityId } from './entity-id';
import { sinkLineCells } from './sink';
import { pointSegmentDistance } from './tube-shapes';

export const FILTER_LABEL = 'Filter';
export const FILTER_COLOR = '#8ce096';

export interface FilterInstance {
  readonly kind: 'filter';
  /** Set on apparatus a scenario placed as fixed bench furniture: the worker
   * refuses to move, reshape, reconfigure or delete it, so a campaign bench
   * can't be dismantled mid-puzzle. Undefined for anything the player
   * placed. */
  readonly locked?: boolean;
  /** Placement order across every apparatus kind -- see entity-id.ts. Also
   * the id movement.ts's allow-list map is keyed by, via grid.entityOwner. */
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

/** What movement.ts consults per owned cell: entityId -> that filter's
 * allow-list. Built once per tick from the live instance list (see
 * worker.ts), so movement never has to search an array. A cell whose owner
 * isn't in the map isn't a membrane at all (it's some other apparatus's
 * glass), and passes the check untouched. */
export type FilterAllow = ReadonlyMap<number, ReadonlySet<number>>;

export const NO_FILTERS: FilterAllow = new Map();

export function filterAllowMap(filters: readonly FilterInstance[]): FilterAllow {
  const map = new Map<number, ReadonlySet<number>>();
  for (const filter of filters) map.set(filter.entityId, filter.species);
  return map;
}

/** The cells a filter line covers: the bare Bresenham core, one cell wide
 * (sinkLineCells with width 0 -- reused rather than hand-rolling a second
 * rasterizer, same as scenario.ts's applyWallLine does). */
export function filterLineCells(filter: FilterInstance): { x: number; y: number }[] {
  return sinkLineCells(filter.x0, filter.y0, filter.x1, filter.y1, 0);
}

export function placeFilterInstance(x0: number, y0: number, x1: number, y1: number, species: readonly number[]): FilterInstance {
  return { kind: 'filter', entityId: nextEntityId(), x0, y0, x1, y1, species: new Set(species) };
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
