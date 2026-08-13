// Shared "iterate every grid cell within a circular radius" primitive, used
// by every brush/radius-based tool and heat source in src/sim -- worker.ts's
// paint/erase brushes, the radiator's point heat source (heat.ts), the mixer
// brush (mixer.ts), and the grabber's pickup circle (grabber.ts) all used to
// hand-roll the same nested-loop-plus-distance-check scan.
import type { SimGrid } from './grid';

/** True when (bx, by) lies within `radius` grid cells of (ax, ay) --
 * Euclidean, radius itself inclusive. Shared distance test for the handful
 * of call sites that check a single point against a brush radius rather than
 * scanning a whole disc (e.g. worker.ts's erase handler dropping a placed
 * funnel/tube whose anchor/knee falls inside the erased circle). */
export function withinRadius(ax: number, ay: number, bx: number, by: number, radius: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  return dx * dx + dy * dy <= radius * radius;
}

/** Calls `fn(px, py, dx, dy)` for every in-bounds grid cell within `radius`
 * of (cx, cy) -- dx/dy are the offset from center (cx, cy), which callers
 * that need a relative offset (e.g. grabber.ts's held-cell offsets) can use
 * directly instead of re-subtracting. Row-major scan order (dy outer, dx
 * inner), matching every hand-rolled version this replaces. */
export function forEachCellInRadius(
  grid: SimGrid,
  cx: number,
  cy: number,
  radius: number,
  fn: (px: number, py: number, dx: number, dy: number) => void,
): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = cx + dx;
      const py = cy + dy;
      if (!grid.inBounds(px, py)) continue;
      fn(px, py, dx, dy);
    }
  }
}
