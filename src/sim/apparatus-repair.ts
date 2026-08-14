// Keeps placed apparatus from destroying each other.
//
// Every apparatus draws itself the same way: clear the glass footprint it
// currently occupies, stamp a new one (funnel.ts, tube.ts, flask.ts,
// glass.ts all follow that unstamp-mutate-restamp shape). Footprints overlap
// freely, and nothing about that clear knows whose glass it is -- so a
// conveyor tube drawn across a beaker punched a permanent hole through the
// beaker's wall the moment the tube was dragged anywhere, and a beaker
// dragged across a tube did the same to the tube. Glassware is meant to be
// indestructible; the eraser is the one tool that takes it off the grid.
//
// The repair is deliberately "put back only what went empty" rather than
// "re-stamp everyone's footprint": an edit is still free to stamp glass or
// matter over its neighbours (that's what placing apparatus on top of
// something has always done), and a hole the player erased earlier stays
// erased instead of healing itself the next time anything nearby moves.
import { PhaseCode, TubeMaskValue, type SimGrid } from './grid';
import { funnelGlassCells, type FunnelInstance } from './funnel';
import { flaskGlassCells, type FlaskInstance } from './flask';
import { glassCells, type GlassInstance } from './glass';
import { glassWallEnergyAtAmbient } from './heat';
import type { SpeciesTable } from './species';
import { boreTubeLumens, restampTubeMask, tubeGlassCells, type TubeInstance } from './tube';
import type { Point } from './tube-shapes';
import { GLASS_WALL_SPEC_ID } from './walls';

/** Everything currently on the bench that owns glass. Passed as a thunk
 * because the caller's lists are mutated (and rebound) by the very edit this
 * wraps -- a newly placed tube has to be in the list by the time the overlay
 * refresh at the end runs. */
export interface PlacedApparatus {
  readonly funnels: readonly FunnelInstance[];
  readonly tubes: readonly TubeInstance[];
  readonly flasks: readonly FlaskInstance[];
  readonly glass: readonly GlassInstance[];
}

/** Which apparatus the edit is about to re-stamp: its own footprint is
 * excluded from the repair, since the cells it just vacated are exactly the
 * ones that are *supposed* to come out empty. Null for a placement, which
 * vacates nothing. */
export type ApparatusRef = { readonly kind: 'funnel' | 'tube' | 'flask' | 'glass'; readonly id: number };

function pushCells(grid: SimGrid, into: number[], cells: readonly Point[]): void {
  for (const { x, y } of cells) {
    if (grid.inBounds(x, y)) into.push(grid.index(x, y));
  }
}

/** Every cell some placed apparatus other than `exclude` holds as its own
 * glass right now. */
export function otherApparatusGlassCells(grid: SimGrid, placed: PlacedApparatus, exclude: ApparatusRef | null): number[] {
  const cells: number[] = [];
  const skips = (kind: ApparatusRef['kind'], id: number) => exclude !== null && exclude.kind === kind && exclude.id === id;
  for (const f of placed.funnels) if (!skips('funnel', f.id)) pushCells(grid, cells, funnelGlassCells(f));
  for (const t of placed.tubes) if (!skips('tube', t.id)) pushCells(grid, cells, tubeGlassCells(t));
  for (const f of placed.flasks) if (!skips('flask', f.id)) pushCells(grid, cells, flaskGlassCells(f));
  for (const g of placed.glass) if (!skips('glass', g.id)) pushCells(grid, cells, glassCells(g));
  return cells;
}

/** Re-marks every placed tube's lumen/cone overlay and re-bores its lumen.
 * Separate from the glass repair because the eraser needs this half on its
 * own: it's allowed to take a tube's glass, but a tube it only grazed keeps
 * its tracked path and must keep its overlay with it (see tube.ts's
 * restampTubeMask). */
export function refreshTubeOverlays(grid: SimGrid, tubes: readonly TubeInstance[]): void {
  for (const tube of tubes) restampTubeMask(grid, tube);
  // A repair (or another apparatus's stamp) may have just filled a lumen back
  // in with glass -- re-bore now rather than leaving the tube visibly plugged
  // until the next tick gets around to it.
  boreTubeLumens(grid, tubes);
}

/** Whether a cell is one this repair is responsible for putting back: glass
 * that's really there, or glass a tube's lumen is currently standing on.
 *
 * The lumen case is what makes dragging a tube across a beaker survivable. A
 * lumen is a bored hole through whatever it crosses (see tube.ts's
 * boreWallsFromLumen) -- the drilled port that lets a tube be plumbed into a
 * vessel at all -- so mid-drag the wall cell under it is already empty by the
 * time the next drag step is scanned. Counting it as glass anyway treats the
 * bore as glass *displaced* by the tube rather than destroyed by it, so the
 * wall closes up behind the tube instead of the drag leaving a trail of holes
 * one cell wide. A cell that's empty for any other reason -- the player
 * erased it -- is not claimed, and stays erased. */
function holdsGlass(grid: SimGrid, idx: number): boolean {
  if (grid.specId[idx] === GLASS_WALL_SPEC_ID) return true;
  return (grid.tubeMask[idx] as TubeMaskValue) === TubeMaskValue.Lumen && grid.isEmptyAt(idx);
}

/** Runs an apparatus placement/move/resize, then puts back any *other*
 * apparatus's glass the edit cleared and refreshes every tube's overlay. */
export function editApparatus(
  grid: SimGrid,
  species: SpeciesTable,
  placed: () => PlacedApparatus,
  exclude: ApparatusRef | null,
  edit: () => void,
): void {
  const claimed = otherApparatusGlassCells(grid, placed(), exclude).filter((i) => holdsGlass(grid, i));
  edit();
  const wallU = glassWallEnergyAtAmbient(species);
  for (const i of claimed) {
    // Still bored by a lumen after the edit: the tube is standing there now,
    // so the port stays open rather than being filled in under it.
    if ((grid.tubeMask[i] as TubeMaskValue) === TubeMaskValue.Lumen) continue;
    if (grid.isEmptyAt(i)) grid.setAt(i, GLASS_WALL_SPEC_ID, PhaseCode.Solid, wallU);
  }
  refreshTubeOverlays(grid, placed().tubes);
}
