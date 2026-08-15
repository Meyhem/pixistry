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

/** Randomly permutes the contents of every stirrable cell being stirred --
 * one shared shuffle across all of them (not per separately-drawn patch), so
 * cells drift across the stirred shape rather than only ever swapping with an
 * immediate neighbor.
 *
 * Two things get stirred, unioned here rather than on the grid: the painted
 * stirrer overlay, and the interior of every stirred flask. A stirred flask
 * used to stamp its interior into grid.stirrerMask, which stopped working the
 * moment apparatus state became derived -- stirrerMask is painted terrain the
 * compositor deliberately never touches (see entity-composite.ts), so a flask
 * writing into it would either be wiped by nothing at all (a stale patch
 * outliving the flask) or wipe the player's own brush strokes on its way
 * out. */
export function stepStirrers(grid: SimGrid, rng: Rng, flasks: readonly FlaskInstance[] = []): void {
  const stirred = new Set<number>();
  for (let idx = 0; idx < grid.stirrerMask.length; idx++) {
    if ((grid.stirrerMask[idx] as number) !== 0) stirred.add(idx);
  }
  for (const flask of flasks) {
    if (!flask.stirred) continue;
    for (const { x, y } of flaskFootprint(flask).reservoirCells) {
      if (grid.inBounds(x, y)) stirred.add(grid.index(x, y));
    }
  }
  const indices: number[] = [];
  for (const idx of stirred) {
    if (isStirrable(grid, idx)) indices.push(idx);
  }
  indices.sort((a, b) => a - b);
  shuffleCells(grid, rng, indices);
  agitateCells(grid, rng, indices);
}
