// Shared "glass footprint" stamping used by both apparatus types: a funnel
// (funnel.ts) and a conveyor-tube (tube.ts) both render as glass wall cells
// stamped directly into grid.specId, and both need to place/clear that
// footprint at more than one moment -- funnel at placement and every move,
// tube at placement and every knee/segment drag or cone-size edit.
import { PhaseCode, type SimGrid } from './grid';
import { glassWallEnergyAtAmbient } from './heat';
import type { SpeciesTable } from './species';
import type { Point } from './tube-shapes';
import { GLASS_WALL_SPEC_ID } from './walls';

/** Stamps every cell in `cells` as glass (overwriting whatever's there, same
 * "overwrite" convention every apparatus placement already used) -- seeded
 * at ambient temperature, not literal u=0/0 Kelvin (see
 * glassWallEnergyAtAmbient's doc comment: a wall ring stamped at 0K acts as
 * a runaway heat sink on whatever conducts against it). Out-of-bounds cells
 * are silently skipped. */
export function stampGlass(grid: SimGrid, species: SpeciesTable, cells: readonly Point[]): void {
  const wallU = glassWallEnergyAtAmbient(species);
  for (const cell of cells) {
    if (grid.inBounds(cell.x, cell.y)) grid.set(cell.x, cell.y, GLASS_WALL_SPEC_ID, PhaseCode.Solid, wallU);
  }
}

/** Clears every cell in `cells` back to empty -- the inverse of stampGlass,
 * used before re-stamping a moved/resized apparatus at its new footprint. */
export function clearCells(grid: SimGrid, cells: readonly Point[]): void {
  for (const cell of cells) {
    if (grid.inBounds(cell.x, cell.y)) grid.clear(cell.x, cell.y);
  }
}
