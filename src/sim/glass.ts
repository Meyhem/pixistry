// Hand-drawn glass polygons: the vessel walls the Glass tool draws as a
// clicked corner chain (see app.ts's polygon draw), tracked as instances the
// same way funnels/tubes/flasks/filters are.
//
// This used to be a one-shot stamp -- 'placeGlassPolyline' rasterized the
// chain into wall cells and forgot it, exactly like painting a wall material.
// That made a hand-built vessel the one piece of apparatus you could never
// pick back up: a beaker you placed a cell too far left had to be erased and
// redrawn corner by corner, while a *stamped* beaker (flask.ts) just got
// dragged. A polygon is tracked state now, so the select tool can slide it and
// rotate it after the fact.
//
// The corners as drawn (`basePoints`) are the instance's source of truth, and
// `rotation`/`dx`/`dy` are applied to them on demand (see glassPoints) rather
// than being folded back into the points. Rotating is therefore lossless: 8
// steps around the compass return the exact cells drawn, where re-rounding a
// rotated polygon into new basePoints every time would smear the shape a
// little further off its original outline on every wheel notch.
import { stampGlass } from './apparatus';
import type { SimGrid } from './grid';
import { sinkLineCells } from './sink';
import type { SpeciesTable } from './species';
import type { Point } from './tube-shapes';
import { GLASS_WALL_SPEC_ID } from './walls';

/** 45 degrees per step, 8 steps to the full turn -- the same rotation
 * granularity a flask has (see flask-shapes.ts's 8 facings), so both kinds of
 * glassware answer the scroll wheel the same way. */
export const GLASS_ROTATION_STEPS = 8;

export interface GlassInstance {
  readonly id: number;
  /** The corner chain exactly as clicked, before rotation or translation. */
  readonly basePoints: readonly Point[];
  /** 0..GLASS_ROTATION_STEPS-1, about the base chain's centroid. */
  rotation: number;
  dx: number;
  dy: number;
}

let nextGlassId = 1;

/** Test-only: makes ids deterministic across test files (same reason as
 * flask.ts's resetFlaskIds). */
export function resetGlassIds(): void {
  nextGlassId = 1;
}

function centroidOf(points: readonly Point[]): { x: number; y: number } {
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const n = Math.max(1, points.length);
  return { x: sx / n, y: sy / n };
}

/** The instance's corners as they currently sit on the grid: the drawn chain
 * turned `rotation` steps about its own centroid, rounded back onto whole
 * cells, then translated by (dx, dy). A quarter turn is exact; the 45-degree
 * steps in between round, which is why a rotated polygon's segments can come
 * out a cell longer or shorter than the ones drawn. */
export function glassPoints(instance: GlassInstance): Point[] {
  const center = centroidOf(instance.basePoints);
  const angle = (instance.rotation * 2 * Math.PI) / GLASS_ROTATION_STEPS;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return instance.basePoints.map((p) => {
    const vx = p.x - center.x;
    const vy = p.y - center.y;
    return {
      x: Math.round(center.x + vx * cos - vy * sin) + instance.dx,
      y: Math.round(center.y + vx * sin + vy * cos) + instance.dy,
    };
  });
}

/** Every cell the chain covers: each consecutive pair joined by the same
 * Bresenham rasterization the worker's original one-shot stamp used, so a
 * tracked polygon lands on exactly the cells the ghost preview drew. */
export function glassChainCells(points: readonly Point[]): Point[] {
  const cells: Point[] = [];
  for (let i = 0; i + 1 < points.length; i++) {
    const a = points[i] as Point;
    const b = points[i + 1] as Point;
    cells.push(...sinkLineCells(a.x, a.y, b.x, b.y, 0));
  }
  if (points.length === 1) cells.push(points[0] as Point);
  return cells;
}

export function glassCells(instance: GlassInstance): Point[] {
  return glassChainCells(glassPoints(instance));
}

function key(p: Point): string {
  return `${p.x},${p.y}`;
}

/** Lifts an instance's glass off the grid ahead of re-stamping it somewhere
 * else. Only cells that are still glass are cleared (so a cell the player
 * already erased, or one some other apparatus has since overwritten, is left
 * alone), and any cell another tracked polygon also covers is put straight
 * back: a newer polygon drawn across an older one must not lose a cell just
 * because the older one moved -- the same crossing rule filter.ts's
 * unstampFilter enforces through its per-cell owner id, which glass can't
 * have (its "mask" is grid.specId itself). */
function unstampGlass(grid: SimGrid, species: SpeciesTable, instance: GlassInstance, others: readonly GlassInstance[]): void {
  const cleared = new Set<string>();
  for (const cell of glassCells(instance)) {
    if (!grid.inBounds(cell.x, cell.y)) continue;
    if (grid.specId[grid.index(cell.x, cell.y)] !== GLASS_WALL_SPEC_ID) continue;
    grid.clear(cell.x, cell.y);
    cleared.add(key(cell));
  }
  if (cleared.size === 0) return;
  for (const other of others) {
    if (other.id === instance.id) continue;
    const overlap = glassCells(other).filter((cell) => cleared.has(key(cell)));
    if (overlap.length > 0) stampGlass(grid, species, overlap);
  }
}

export function placeGlassInstance(grid: SimGrid, species: SpeciesTable, points: readonly Point[]): GlassInstance {
  const instance: GlassInstance = {
    id: nextGlassId++,
    basePoints: points.map((p) => ({ x: p.x, y: p.y })),
    rotation: 0,
    dx: 0,
    dy: 0,
  };
  stampGlass(grid, species, glassCells(instance));
  return instance;
}

/** Slides a whole polygon by (dx, dy), keeping its shape and rotation --
 * the select tool's drag. */
export function moveGlassInstance(
  grid: SimGrid,
  species: SpeciesTable,
  instances: readonly GlassInstance[],
  instance: GlassInstance,
  dx: number,
  dy: number,
): void {
  if (dx === 0 && dy === 0) return;
  unstampGlass(grid, species, instance, instances);
  instance.dx += dx;
  instance.dy += dy;
  stampGlass(grid, species, glassCells(instance));
}

/** Turns a polygon to an absolute rotation step (the select tool's wheel).
 * Absolute rather than relative for the same reason updateFunnel/updateFlask
 * send whole configs: a dropped or reordered wheel message then can't leave
 * the instance a notch away from what the UI is drawing. */
export function rotateGlassInstance(
  grid: SimGrid,
  species: SpeciesTable,
  instances: readonly GlassInstance[],
  instance: GlassInstance,
  rotation: number,
): void {
  const next = ((Math.round(rotation) % GLASS_ROTATION_STEPS) + GLASS_ROTATION_STEPS) % GLASS_ROTATION_STEPS;
  if (next === instance.rotation) return;
  unstampGlass(grid, species, instance, instances);
  instance.rotation = next;
  stampGlass(grid, species, glassCells(instance));
}

/** Drops any polygon the eraser has taken off the grid entirely -- same
 * "a drawn line dies only once its last cell is gone" rule as
 * filter.ts's pruneErasedFilters, rather than an anchor cell that deletes
 * the whole thing (a polygon has no anchor; every corner is equal). */
export function pruneErasedGlass(grid: SimGrid, instances: readonly GlassInstance[]): GlassInstance[] {
  return instances.filter((instance) =>
    glassCells(instance).some((cell) => grid.inBounds(cell.x, cell.y) && grid.specId[grid.index(cell.x, cell.y)] === GLASS_WALL_SPEC_ID),
  );
}

