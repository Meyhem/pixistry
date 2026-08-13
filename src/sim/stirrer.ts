// The stirrer apparatus: a painted overlay (grid.stirrerMask) that
// continuously randomizes whatever liquid/gas cells sit inside its drawn
// shape, every tick, for as long as it's placed -- unlike the mixer tool's
// brush stroke (mixer.ts), which only stirs while actively dragged, a
// stirrer keeps agitating on its own once drawn, the way a real magnetic
// stirrer or paddle would. Reuses mixer.ts's shuffleCells so both tools
// agitate cells the same way: a full random permutation of contents, not a
// partial probabilistic swap.
import { SimGrid } from './grid';
import { isStirrable, shuffleCells } from './mixer';

type Rng = () => number;

export const STIRRER_LABEL = 'Stirrer';
export const STIRRER_COLOR = '#a877f0';

/** Randomly permutes the contents of every stirrable cell marked by the
 * stirrer overlay -- one shared shuffle across the whole overlay (not
 * per separately-drawn patch), so cells drift across the marked shape
 * rather than only ever swapping with an immediate neighbor. */
export function stepStirrers(grid: SimGrid, rng: Rng): void {
  const indices: number[] = [];
  for (let idx = 0; idx < grid.stirrerMask.length; idx++) {
    if ((grid.stirrerMask[idx] as number) === 0) continue;
    if (isStirrable(grid, idx)) indices.push(idx);
  }
  shuffleCells(grid, rng, indices);
}
