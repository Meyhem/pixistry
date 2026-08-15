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
  readonly flaskKind: FlaskKind;
  /** Whether a sep funnel's bottom aperture starts open. Meaningless (and
   * inert) for kinds without an aperture. */
  readonly open?: boolean;
}

export interface FlaskInstance {
  readonly kind: 'flask';
  /** Set on apparatus a scenario placed as fixed bench furniture: the worker
   * refuses to move, reshape, reconfigure or delete it, so a campaign bench
   * can't be dismantled mid-puzzle. Undefined for anything the player
   * placed. */
  readonly locked?: boolean;
  /** Placement order across every apparatus kind -- see entity-id.ts. */
  readonly entityId: number;
  x: number;
  y: number;
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  /** Which glassware shape (Erlenmeyer/beaker/sep funnel -- see
   * flask-shapes.ts). Named flaskKind rather than plain kind because `kind`
   * is the entity discriminant ('flask') shared by every apparatus
   * instance. */
  flaskKind: FlaskKind;
  /** The sep funnel's stopcock: closed (false) seals the aperture cells with
   * glass, open (true) leaves them empty so contents drain through. Carried
   * (but inert) on the kinds without an aperture, so switching a placed
   * vessel's shape needs no state surgery. */
  open: boolean;
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
  const shape = flaskShapeFor(instance.facing, instance.sizeScale, instance.flaskKind);
  const at = (cell: { dx: number; dy: number }) => ({ x: instance.x + cell.dx, y: instance.y + cell.dy });
  // A closed stopcock is real glass; an open one is simply absent, so the
  // compositor's derive-everything pass makes toggling it "mutate, then
  // recomposite" like every other apparatus edit -- no special unstamping.
  const wallCells = instance.open ? shape.cells.map(at) : [...shape.cells.map(at), ...shape.apertureCells.map(at)];
  return {
    wallCells,
    reservoirCells: shape.reservoirCells.map(at),
  };
}

export function placeFlaskInstance(config: FlaskConfig): FlaskInstance {
  return {
    kind: 'flask',
    entityId: nextEntityId(),
    x: config.x,
    y: config.y,
    facing: config.facing,
    sizeScale: config.sizeScale,
    stirred: config.stirred,
    flaskKind: config.flaskKind,
    open: config.open ?? false,
  };
}

/** Applies an edit (shape/size/stirred/facing/stopcock, any subset). The
 * vessel's contents are untouched -- a resize or a move re-derives the glass
 * around (or away from) whatever it was holding rather than deleting it. */
export function updateFlaskInstance(instance: FlaskInstance, patch: Partial<Pick<FlaskInstance, 'facing' | 'sizeScale' | 'stirred' | 'flaskKind' | 'open'>>): void {
  if (patch.facing !== undefined) instance.facing = patch.facing;
  if (patch.sizeScale !== undefined) instance.sizeScale = patch.sizeScale;
  if (patch.stirred !== undefined) instance.stirred = patch.stirred;
  if (patch.flaskKind !== undefined) instance.flaskKind = patch.flaskKind;
  if (patch.open !== undefined) instance.open = patch.open;
}

export function moveFlaskInstance(instance: FlaskInstance, x: number, y: number): void {
  instance.x = x;
  instance.y = y;
}
