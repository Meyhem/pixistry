// Bottom-up falling-sand scan with alternating horizontal parity, per the
// design doc. Density (not a fixed solid > liquid > gas ranking) decides
// whether a cell may displace its neighbour, so a denser gas can still sink
// through a lighter one, etc. Swaps are probabilistic so mixing takes time.
import { NO_FILTERS, type FilterAllow } from './filter';
import { EMPTY, PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { massOf, temperatureOf } from './heat';
import type { SpeciesTable } from './species';
import { isWallSpecId } from './walls';

type Rng = () => number;

const DIAGONAL_P = 0.7;
const LIQUID_SPREAD_P = 0.4;
const GAS_SPREAD_P = 0.5;

/** Density for buoyancy purposes: species.densityOf's fixed table value for
 * solid/liquid, but the cell's actual temperature-scaled gas density (see
 * SpeciesTable.buoyantDensityOf) once it's actually boiled -- otherwise a
 * gas-phase cell reports the same density as the liquid it just came from
 * and can never rise through it. Only reads grid.u (via temperatureOf) when
 * the cell is actually in Gas phase, since that's the only case where
 * buoyantDensityOf's result differs from densityOf's. */
function displaceDensity(grid: SimGrid, species: SpeciesTable, idx: number, specId: number, phase: PhaseCode): number {
  if (phase !== PhaseCode.Gas) return species.densityOf(specId);
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  const tempK = temperatureOf(thermal, mass, grid.u[idx] as number).tempK;
  return species.buoyantDensityOf(specId, phase, tempK);
}

type TargetStatus =
  | { kind: 'blocked' } // a tube's lumen or a wall material -- never a valid destination
  | { kind: 'empty' }
  | { kind: 'occupied'; specId: number; phase: PhaseCode };

/** A cell covered by a filter line (grid.filterMask holds that line's
 * instance id -- see filter.ts) is only a valid destination for species on
 * *that line's* allow-list; for every other species it's blocked exactly
 * like a wall, regardless of whether the cell is itself empty or occupied.
 * A cell with no filter drawn (mask is 0) is always unaffected, which is the
 * overwhelmingly common case and stays a single array read. An id with no
 * matching instance blocks everything, same as an empty allow-list. */
function canEnterFiltered(grid: SimGrid, filterAllow: FilterAllow, targetIdx: number, fromSpecId: number): boolean {
  const filterId = grid.filterMask[targetIdx] as number;
  if (filterId === 0) return true;
  return filterAllow.get(filterId)?.has(fromSpecId) ?? false;
}

/** The shared head of canDisplace/canRiseThroughLiquid below: a tube's
 * lumen is only ever entered via its own suction cone (see tube.ts's
 * stepTubes), never by ordinary falling-sand displacement -- otherwise
 * matter could fall/rise straight into the middle of a tube, bypassing the
 * mouth and its species filter entirely. Beyond that, only the empty/wall/
 * occupied distinction is shared; the two callers disagree on what to do
 * with "empty" (canDisplace treats it as auto-displaceable,
 * canRiseThroughLiquid doesn't -- liquids don't spontaneously rise into open
 * air), so that decision stays with each predicate rather than being folded
 * in here. */
function blockedTarget(grid: SimGrid, targetIdx: number, fromSpecId: number, filterAllow: FilterAllow): TargetStatus {
  if ((grid.tubeMask[targetIdx] as TubeMaskValue) === TubeMaskValue.Lumen) return { kind: 'blocked' };
  if (!canEnterFiltered(grid, filterAllow, targetIdx, fromSpecId)) return { kind: 'blocked' };
  if (grid.isEmptyAt(targetIdx)) return { kind: 'empty' };
  const specId = grid.specId[targetIdx] as number;
  if (isWallSpecId(specId)) return { kind: 'blocked' };
  return { kind: 'occupied', specId, phase: grid.phase[targetIdx] as PhaseCode };
}

function canDisplace(
  grid: SimGrid,
  species: SpeciesTable,
  fromIdx: number,
  fromSpecId: number,
  fromPhase: PhaseCode,
  targetIdx: number,
  direction: 'down' | 'up',
  filterAllow: FilterAllow,
): boolean {
  const target = blockedTarget(grid, targetIdx, fromSpecId, filterAllow);
  if (target.kind === 'blocked') return false;
  if (target.kind === 'empty') return true;
  // Density sorting is a liquid/gas thing -- two solid grains never swap
  // places by density, they just pile up static once resting, so a denser
  // solid can't tunnel through a lighter one underneath it.
  if (fromPhase === PhaseCode.Solid && target.phase === PhaseCode.Solid) return false;
  const fromDensity = displaceDensity(grid, species, fromIdx, fromSpecId, fromPhase);
  const targetDensity = displaceDensity(grid, species, targetIdx, target.specId, target.phase);
  return direction === 'down' ? fromDensity > targetDensity : fromDensity < targetDensity;
}

function pickDiagonalOrder(rng: Rng): [number, number] {
  return rng() < 0.5 ? [-1, 1] : [1, -1];
}

/** Buoyant-rise check for a liquid displacing the liquid above it. Unlike
 * canDisplace, an empty target is NOT auto-displaceable here: liquids don't
 * spontaneously rise into open air the way gas does, they only rise past a
 * denser liquid that's in their way. */
function canRiseThroughLiquid(
  grid: SimGrid,
  species: SpeciesTable,
  fromIdx: number,
  fromSpecId: number,
  fromPhase: PhaseCode,
  targetIdx: number,
  filterAllow: FilterAllow,
): boolean {
  const target = blockedTarget(grid, targetIdx, fromSpecId, filterAllow);
  if (target.kind !== 'occupied' || target.phase !== PhaseCode.Liquid) return false;
  const fromDensity = displaceDensity(grid, species, fromIdx, fromSpecId, fromPhase);
  const targetDensity = displaceDensity(grid, species, targetIdx, target.specId, target.phase);
  return fromDensity < targetDensity;
}

/** Swaps a mover into its destination and marks both cells moved this tick
 * -- the one-liner repeated at every successful move below. Always returns
 * true so callers can write `return commitSwap(...)` from a boolean-
 * returning helper (tryDiagonal) or `commitSwap(...); return;` from a
 * void one (moveFalling/moveRising). */
function commitSwap(grid: SimGrid, moved: Uint8Array, a: number, b: number): true {
  grid.swap(a, b);
  moved[a] = 1;
  moved[b] = 1;
  return true;
}

/** Tries each of the two diagonal targets at row `targetY` (order randomized
 * per pickDiagonalOrder), swapping into the first one where `canMove` holds
 * and a DIAGONAL_P roll succeeds. Shared by the down/up diagonal-fallback
 * step in moveFalling and moveRising -- all three sites (solid/liquid
 * falling, buoyant liquid rising, gas rising) roll the same DIAGONAL_P once
 * a straight move has already failed; only the direction (targetY) and the
 * density predicate differ between them.
 *
 * A single diagonal step is otherwise enough to cut through the corner of
 * any one-pixel-thick wall -- fine (desired, even) for a grain sliding past
 * a wall's outer corner as it piles up, but not for a cell sitting directly
 * outside a placed flask's glass: the interior is open right up against the
 * inner face of that same wall pixel, so the same corner-cut lets matter
 * hop straight from "just outside the vessel" to "inside it" without ever
 * passing through the mouth -- see grid.ts's vesselMask. Blocking a diagonal
 * move whenever it would cross from outside a vessel into its interior
 * closes that off, while leaving straight-line movement through the actual
 * mouth (never diagonal, since the mouth's interior columns have open sky
 * directly above them) and diagonal movement anywhere else entirely alone. */
function tryDiagonal(
  grid: SimGrid,
  moved: Uint8Array,
  idx: number,
  x: number,
  targetY: number,
  rng: Rng,
  canMove: (targetIdx: number) => boolean,
): boolean {
  const fromInsideVessel = (grid.vesselMask[idx] as number) !== 0;
  for (const dx of pickDiagonalOrder(rng)) {
    const nx = x + dx;
    if (!grid.inBounds(nx, targetY)) continue;
    const nIdx = grid.index(nx, targetY);
    if (moved[nIdx]) continue;
    if (!fromInsideVessel && (grid.vesselMask[nIdx] as number) !== 0) continue;
    if (canMove(nIdx) && rng() < DIAGONAL_P) return commitSwap(grid, moved, idx, nIdx);
  }
  return false;
}

function moveFalling(
  grid: SimGrid,
  species: SpeciesTable,
  moved: Uint8Array,
  x: number,
  y: number,
  idx: number,
  specId: number,
  fromPhase: PhaseCode,
  rng: Rng,
  canSpreadHorizontally: boolean,
  filterAllow: FilterAllow,
): void {
  const belowY = y + 1;
  if (grid.inBounds(x, belowY)) {
    const belowIdx = grid.index(x, belowY);
    if (canDisplace(grid, species, idx, specId, fromPhase, belowIdx, 'down', filterAllow)) {
      commitSwap(grid, moved, idx, belowIdx);
      return;
    }
    if (tryDiagonal(grid, moved, idx, x, belowY, rng, (t) => canDisplace(grid, species, idx, specId, fromPhase, t, 'down', filterAllow))) return;
  }

  if (!canSpreadHorizontally) return;

  // Buoyant rise: a lighter liquid trapped under/inside a denser one (e.g.
  // enveloped against a solid boundary with no downward escape) floats up
  // through it rather than sitting stuck forever.
  const aboveY = y - 1;
  if (grid.inBounds(x, aboveY)) {
    const aboveIdx = grid.index(x, aboveY);
    if (canRiseThroughLiquid(grid, species, idx, specId, fromPhase, aboveIdx, filterAllow)) {
      commitSwap(grid, moved, idx, aboveIdx);
      return;
    }
    if (tryDiagonal(grid, moved, idx, x, aboveY, rng, (t) => canRiseThroughLiquid(grid, species, idx, specId, fromPhase, t, filterAllow))) return;
  }

  for (const dx of pickDiagonalOrder(rng)) {
    const nx = x + dx;
    if (!grid.inBounds(nx, y)) continue;
    const nIdx = grid.index(nx, y);
    if (moved[nIdx]) continue;
    if ((grid.tubeMask[nIdx] as TubeMaskValue) === TubeMaskValue.Lumen) continue;
    if (!canEnterFiltered(grid, filterAllow, nIdx, specId)) continue;
    if (grid.isEmptyAt(nIdx)) {
      if (rng() < LIQUID_SPREAD_P) {
        commitSwap(grid, moved, idx, nIdx);
        return;
      }
      continue;
    }
    // Lateral liquid<->liquid mixing: swap regardless of density so
    // same-density liquids intermix and different-density liquids get
    // reshuffled into positions where the vertical density checks above
    // can sort them into layers, instead of never touching at all.
    const targetSpecId = grid.specId[nIdx] as number;
    if (isWallSpecId(targetSpecId)) continue;
    const targetPhase = grid.phase[nIdx] as PhaseCode;
    if (targetPhase !== PhaseCode.Liquid) continue;
    if (rng() < LIQUID_SPREAD_P) {
      commitSwap(grid, moved, idx, nIdx);
      return;
    }
  }
}

function moveRising(
  grid: SimGrid,
  species: SpeciesTable,
  moved: Uint8Array,
  x: number,
  y: number,
  idx: number,
  specId: number,
  rng: Rng,
  filterAllow: FilterAllow,
): void {
  const aboveY = y - 1;
  if (grid.inBounds(x, aboveY)) {
    const aboveIdx = grid.index(x, aboveY);
    if (canDisplace(grid, species, idx, specId, PhaseCode.Gas, aboveIdx, 'up', filterAllow)) {
      commitSwap(grid, moved, idx, aboveIdx);
      return;
    }
    if (tryDiagonal(grid, moved, idx, x, aboveY, rng, (t) => canDisplace(grid, species, idx, specId, PhaseCode.Gas, t, 'up', filterAllow))) return;
  }

  for (const dx of pickDiagonalOrder(rng)) {
    const nx = x + dx;
    if (!grid.inBounds(nx, y)) continue;
    const nIdx = grid.index(nx, y);
    if (moved[nIdx]) continue;
    if ((grid.tubeMask[nIdx] as TubeMaskValue) === TubeMaskValue.Lumen) continue;
    if (!canEnterFiltered(grid, filterAllow, nIdx, specId)) continue;
    if (grid.isEmptyAt(nIdx)) {
      if (rng() < GAS_SPREAD_P) {
        commitSwap(grid, moved, idx, nIdx);
        return;
      }
      continue;
    }
    // Lateral gas<->gas mixing: swap regardless of density, same rationale
    // as moveFalling's liquid<->liquid case above -- a lighter gas boxed in
    // by denser gas with no direct/diagonal path upward (e.g. pinned under
    // a sealed ceiling next to an off-center opening) has no way to reshuffle
    // sideways into a spot where the vertical density check can carry it up,
    // and just sits there forever otherwise.
    const targetSpecId = grid.specId[nIdx] as number;
    if (isWallSpecId(targetSpecId)) continue;
    const targetPhase = grid.phase[nIdx] as PhaseCode;
    if (targetPhase !== PhaseCode.Gas) continue;
    if (rng() < GAS_SPREAD_P) {
      commitSwap(grid, moved, idx, nIdx);
      return;
    }
  }
}

/** One movement tick. Mutates grid in place. `filterAllow` maps each drawn
 * filter line's instance id to its own allow-list (see filter.ts's
 * filterAllowMap) -- defaults to empty, i.e. "every filtered cell blocks
 * everything", so callers with no filter on the grid (every test but
 * movement.test.ts's own filter coverage) don't need to pass one. */
export function stepMovement(grid: SimGrid, species: SpeciesTable, rng: Rng, tick: number, filterAllow: FilterAllow = NO_FILTERS): void {
  const { width, height } = grid;
  const leftToRight = tick % 2 === 0;
  const moved = new Uint8Array(width * height);

  for (let y = height - 1; y >= 0; y--) {
    for (let xi = 0; xi < width; xi++) {
      const x = leftToRight ? xi : width - 1 - xi;
      const idx = grid.index(x, y);
      if (moved[idx] || grid.specId[idx] === EMPTY) continue;

      const specId = grid.specId[idx] as number;
      // Walls never move: neither a mover nor moveable-into (blocked above
      // in canDisplace). Skip immediately rather than treating them as an
      // infinitely-dense solid, since that would still cost a canDisplace
      // check every tick for no benefit.
      if (isWallSpecId(specId)) continue;
      // A cell inside a tube's lumen or suction cone only moves via
      // stepTubes' own exit-first advance / mouth-outward pull (tube.ts) --
      // ordinary gravity/buoyancy is suppressed there so contents can't
      // fall/spread sideways out of the lumen, or escape the cone once
      // grabbed by it, before the tube gets a chance to walk them inward.
      // Cone cells are still a normal (unblocked) *target* for ordinary
      // movement below -- this only stops a cell already inside the cone
      // from wandering back out, it doesn't stop new matter falling in.
      const idxTubeMask = grid.tubeMask[idx] as TubeMaskValue;
      if (idxTubeMask === TubeMaskValue.Lumen || idxTubeMask === TubeMaskValue.Cone) continue;
      const phase = grid.phase[idx] as PhaseCode;
      if (phase === PhaseCode.Solid) moveFalling(grid, species, moved, x, y, idx, specId, phase, rng, false, filterAllow);
      else if (phase === PhaseCode.Liquid) moveFalling(grid, species, moved, x, y, idx, specId, phase, rng, true, filterAllow);
      else if (phase === PhaseCode.Gas) moveRising(grid, species, moved, x, y, idx, specId, rng, filterAllow);
    }
  }
}
