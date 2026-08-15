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
import { nextEntityId } from './entity-id';
import { sinkLineCells } from './sink';
import type { Point } from './tube-shapes';

/** 45 degrees per step, 8 steps to the full turn -- the same rotation
 * granularity a flask has (see flask-shapes.ts's 8 facings), so both kinds of
 * glassware answer the scroll wheel the same way. */
export const GLASS_ROTATION_STEPS = 8;

export interface GlassInstance {
  readonly id: number;
  /** Placement order across every apparatus kind -- see entity-id.ts. */
  readonly entityId: number;
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

export function placeGlassInstance(points: readonly Point[]): GlassInstance {
  return {
    id: nextGlassId++,
    entityId: nextEntityId(),
    basePoints: points.map((p) => ({ x: p.x, y: p.y })),
    rotation: 0,
    dx: 0,
    dy: 0,
  };
}

/** Slides a whole polygon by (dx, dy), keeping its shape and rotation --
 * the select tool's drag. */
export function moveGlassInstance(instance: GlassInstance, dx: number, dy: number): void {
  instance.dx += dx;
  instance.dy += dy;
}

/** Turns a polygon to an absolute rotation step (the select tool's wheel).
 * Absolute rather than relative for the same reason updateFunnel/updateFlask
 * send whole configs: a dropped or reordered wheel message then can't leave
 * the instance a notch away from what the UI is drawing. */
export function rotateGlassInstance(instance: GlassInstance, rotation: number): void {
  instance.rotation = ((Math.round(rotation) % GLASS_ROTATION_STEPS) + GLASS_ROTATION_STEPS) % GLASS_ROTATION_STEPS;
}

