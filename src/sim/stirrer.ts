// The stirrer apparatus: a painted overlay (grid.stirrerMask) that
// continuously randomizes whatever stirrable cells sit inside its drawn
// shape, every tick, for as long as it's placed -- unlike the mixer tool's
// brush stroke (mixer.ts), which only stirs while actively dragged, a
// stirrer keeps agitating on its own once drawn, the way a real magnetic
// stirrer or paddle would. Reuses mixer.ts's shuffleCells so both tools
// agitate cells the same way: a full random permutation of contents, not a
// partial probabilistic swap.
import { flaskFootprint, type FlaskInstance } from './flask';
import { SimGrid } from './grid';
import { agitateCells, isStirrable, shuffleCells } from './mixer';

type Rng = () => number;

export const STIRRER_LABEL = 'Stirrer';
export const STIRRER_COLOR = '#a877f0';

/** Every cell being stirred: the union of the painted stirrer overlay and the
 * interior of every stirred flask, unioned here rather than on the grid. A
 * stirred flask used to stamp its interior into grid.stirrerMask, which
 * stopped working the moment apparatus state became derived -- stirrerMask is
 * painted terrain the compositor deliberately never touches (see
 * entity-composite.ts), so a flask writing into it would either be wiped by
 * nothing at all (a stale patch outliving the flask) or wipe the player's own
 * brush strokes on its way out.
 *
 * The renderer's stirrer tint is built from this same function (see frame.ts's
 * buildFrame), so what looks stirred and what actually gets stirred can't
 * drift apart: for a while after the union moved off the grid, a stirred flask
 * agitated its contents with no overlay drawn at all, because the frame
 * shipped grid.stirrerMask raw. */
export function stirredMask(grid: SimGrid, flasks: readonly FlaskInstance[]): Uint8Array {
  const mask = grid.stirrerMask.slice();
  for (const flask of flasks) {
    if (!flask.stirred) continue;
    for (const { x, y } of flaskFootprint(flask).reservoirCells) {
      if (grid.inBounds(x, y)) mask[grid.index(x, y)] = 1;
    }
  }
  return mask;
}

/** Randomly permutes the contents of every stirrable cell being stirred --
 * one shared shuffle across all of them (not per separately-drawn patch), so
 * cells drift across the stirred shape rather than only ever swapping with an
 * immediate neighbor. */
export function stepStirrers(grid: SimGrid, rng: Rng, flasks: readonly FlaskInstance[] = []): void {
  const stirred = stirredMask(grid, flasks);
  const indices: number[] = [];
  for (let idx = 0; idx < stirred.length; idx++) {
    if ((stirred[idx] as number) !== 0 && isStirrable(grid, idx)) indices.push(idx);
  }
  shuffleCells(grid, rng, indices);
  agitateCells(grid, rng, indices);
}
