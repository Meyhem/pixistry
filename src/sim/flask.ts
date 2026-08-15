// Placed-flask apparatus: a piece of glassware (Erlenmeyer or beaker, see
// flask-shapes.ts) that the select-apparatus tool can pick up and re-edit
// after placement.
//
// This used to be a one-shot stamp -- 'placeFlask' wrote glass cells and
// masks straight into the grid and forgot everything else, exactly like
// painting a wall material. That made a placed flask uneditable: nothing on
// the main thread knew where one was, what size it had been stamped at, or
// which cells to clear to redraw it. So a flask is tracked state now, same
// as funnel.ts's FunnelInstance and tube.ts's TubeInstance -- but unlike
// those two it still has no per-tick step function of its own: the vessel
// only ever acts through the glass walls and the vessel interior its
// footprint declares, which the compositor (entity-composite.ts) puts on the
// grid and the movement/stirrer passes read.
import { flaskShapeFor, type FlaskFacing, type FlaskKind } from './flask-shapes';
import { nextEntityId } from './entity-id';
import type { Point } from './tube-shapes';

export const FLASK_COLOR = '#a9d6e8'; // same glass tint as the funnel/tube/plain glass wall

export interface FlaskConfig {
  readonly x: number;
  readonly y: number;
  readonly facing: FlaskFacing;
  readonly sizeScale: number;
  readonly stirred: boolean;
  readonly kind: FlaskKind;
}

export interface FlaskInstance {
  readonly id: number;
  /** Placement order across every apparatus kind -- see entity-id.ts. */
  readonly entityId: number;
  x: number;
  y: number;
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  kind: FlaskKind;
}

let nextFlaskId = 1;

/** Test-only: makes ids deterministic across test files (each of which gets
 * its own module instance, but a single file placing flasks in several tests
 * would otherwise keep counting up). */
export function resetFlaskIds(): void {
  nextFlaskId = 1;
}

export interface FlaskFootprint {
  /** The glass outline, as real wall matter. */
  readonly wallCells: Point[];
  /** Everything inside that outline: the compositor marks it as vessel
   * interior (which movement.ts's tryDiagonal reads to stop matter hopping
   * diagonally through the glass instead of going in the mouth), and
   * stirrer.ts agitates it every tick for the stirred variant. */
  readonly reservoirCells: Point[];
}

export function flaskFootprint(instance: FlaskInstance): FlaskFootprint {
  const shape = flaskShapeFor(instance.facing, instance.sizeScale, instance.kind);
  return {
    wallCells: shape.cells.map((cell) => ({ x: instance.x + cell.dx, y: instance.y + cell.dy })),
    reservoirCells: shape.reservoirCells.map((cell) => ({ x: instance.x + cell.dx, y: instance.y + cell.dy })),
  };
}

export function placeFlaskInstance(config: FlaskConfig): FlaskInstance {
  return {
    id: nextFlaskId++,
    entityId: nextEntityId(),
    x: config.x,
    y: config.y,
    facing: config.facing,
    sizeScale: config.sizeScale,
    stirred: config.stirred,
    kind: config.kind,
  };
}

/** Applies an edit (shape/size/stirred/facing, any subset). The vessel's
 * contents are untouched -- a resize or a move re-derives the glass around
 * (or away from) whatever it was holding rather than deleting it. */
export function updateFlaskInstance(instance: FlaskInstance, patch: Partial<Pick<FlaskInstance, 'facing' | 'sizeScale' | 'stirred' | 'kind'>>): void {
  if (patch.facing !== undefined) instance.facing = patch.facing;
  if (patch.sizeScale !== undefined) instance.sizeScale = patch.sizeScale;
  if (patch.stirred !== undefined) instance.stirred = patch.stirred;
  if (patch.kind !== undefined) instance.kind = patch.kind;
}

export function moveFlaskInstance(instance: FlaskInstance, x: number, y: number): void {
  instance.x = x;
  instance.y = y;
}
