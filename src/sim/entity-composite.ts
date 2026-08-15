// The one place apparatus becomes grid state.
//
// Every placed apparatus declares a Footprint (see entity.ts) -- which cells
// are its glass, its lumen, its membrane, its radiating cells -- and this
// module derives ALL of that grid state from the entity list in one pass:
// wipe the derived arrays, then stamp every entity in placement order. An
// edit is "mutate the instance, then recomposite"; there is no incremental
// unstamp anywhere in src/sim anymore.
//
// That's a deliberate replacement for three coexisting schemes that each
// tried to reconstruct overlap correctness locally -- a "put back whatever
// went empty" repair pass wrapped around every edit, per-kind crossing rules
// inside unstampGlass/unstampFilter/unstampRadiator, and the tube's own
// mask restamping. Each was individually reasonable and the combination was
// the source of essentially every apparatus regression this project has had
// (a tube dragged across a beaker punching a permanent hole in it; a beaker
// dragged across a tube plugging it; a knee drag collapsing a conveyor).
// Deriving instead of patching makes those unrepresentable: B's cells are
// recomputed from B, so nothing A does can damage them.
//
// What the compositor does NOT touch: painted terrain. stirrerMask and
// catalystStrength are brush strokes the player owns, not apparatus output,
// and matter (anything that isn't glass on a cell an entity claims) is never
// cleared -- a vessel's contents survive the vessel being resized, moved or
// deleted. sinkMask used to be in that list; it isn't since Sinks and Vents
// became entities (phase 6e of .grill/entity-overhaul.md), and it's derived
// here like every other apparatus array.
import { PhaseCode, TubeMaskValue, type SimGrid } from './grid';
import { footprintOfEntity, type AnyEntity, type Footprint } from './entity';
import { glassWallEnergyAtAmbient } from './heat';
import type { SpeciesTable } from './species';
import type { Point } from './tube-shapes';
import { GLASS_WALL_SPEC_ID, isWallSpecId } from './walls';

export const NO_ENTITIES: readonly AnyEntity[] = [];

/** Every placed entity's footprint, in the order the compositor stamps them:
 * ascending entityId, i.e. the order they were placed on the bench. That's
 * what makes "who wins where two footprints overlap" a stable property of the
 * bench rather than of whichever apparatus was edited most recently. */
export function entityFootprints(entities: readonly AnyEntity[]): { entityId: number; footprint: Footprint }[] {
  const out = entities.map((entity) => ({ entityId: entity.entityId, footprint: footprintOfEntity(entity) }));
  out.sort((a, b) => a.entityId - b.entityId);
  return out;
}

function indexOf(grid: SimGrid, p: Point): number | null {
  return grid.inBounds(p.x, p.y) ? grid.index(p.x, p.y) : null;
}

/** Re-derives every apparatus-owned cell on the grid from `entities`. Safe to
 * call as often as you like: running it twice in a row leaves the grid
 * byte-identical (entity-composite.test.ts asserts that), which is what lets
 * every message handler simply mutate an instance and composite afterwards
 * without reasoning about what the edit disturbed. */
export function compositeEntities(grid: SimGrid, species: SpeciesTable, entities: readonly AnyEntity[]): void {
  // The masks are 100% apparatus-derived, so they're wiped wholesale rather
  // than per-owner -- cheaper than a scan, and it means a stale mask cell can
  // never outlive the entity that set it (the "invisible barrier belonging to
  // a tube that no longer exists" bug, made unrepresentable).
  grid.tubeMask.fill(0);
  grid.radiatorRadius.fill(0);
  grid.radiatorTargetK.fill(0);
  grid.sinkMask.fill(0);

  // Glass matter can't be wiped that way: it lives in specId alongside the
  // player's own walls. Instead, remember who owned what, hand ownership back
  // out during the stamp pass, and clear only the glass that ends up with no
  // owner (see the tail of this function).
  const previouslyOwned: number[] = [];
  for (let i = 0; i < grid.entityOwner.length; i++) {
    if (grid.entityOwner[i] !== 0) {
      previouslyOwned.push(i);
      grid.entityOwner[i] = 0;
    }
  }

  const wallU = glassWallEnergyAtAmbient(species);
  const lumenCells: number[] = [];
  const membraneCells: { entityId: number; cells: number[] }[] = [];
  for (const { entityId, footprint } of entityFootprints(entities)) {
    for (const cell of footprint.wall ?? []) {
      const i = indexOf(grid, cell);
      if (i === null) continue;
      // Only stamped where it isn't already glass, so an unrelated edit
      // elsewhere on the bench doesn't reset every vessel's wall temperature
      // back to ambient (a recomposite runs on every edit, not just this
      // entity's).
      if (grid.specId[i] !== GLASS_WALL_SPEC_ID) grid.setAt(i, GLASS_WALL_SPEC_ID, PhaseCode.Solid, wallU);
      grid.entityOwner[i] = entityId;
    }
    for (const cell of footprint.lumen ?? []) {
      const i = indexOf(grid, cell);
      if (i === null) continue;
      grid.tubeMask[i] = TubeMaskValue.Lumen;
      lumenCells.push(i);
    }
    const membrane = footprint.membrane;
    if (membrane) {
      const cells: number[] = [];
      for (const cell of membrane) {
        const i = indexOf(grid, cell);
        if (i !== null) cells.push(i);
      }
      // Deferred to the tail of the composite (after boring and stale-glass
      // cleanup) -- see below for why a membrane can't claim mid-pass.
      membraneCells.push({ entityId, cells });
    }
    const port = footprint.port;
    if (port) {
      for (const cell of port.cells) {
        const i = indexOf(grid, cell);
        if (i === null) continue;
        grid.sinkMask[i] = port.value;
      }
    }
    const radiator = footprint.radiator;
    if (radiator) {
      for (const cell of radiator.cells) {
        const i = indexOf(grid, cell);
        if (i === null) continue;
        grid.radiatorRadius[i] = radiator.radius;
        grid.radiatorTargetK[i] = radiator.targetK;
      }
    }
  }

  // A lumen is a bored hole through whatever it crosses, which is how a tube
  // gets plumbed through a vessel wall at all. Bored last, after every wall
  // is down, because z-order doesn't apply here: a funnel placed later than
  // the tube would otherwise stamp its outline straight across the channel
  // and plug the conveyor with its own glass.
  //
  // Boring deliberately does NOT claim the cell -- the wall belongs to
  // whoever stamped it, so moving the tube away heals the hole on the next
  // composite instead of leaving a permanent gap (the f8f5379 regression,
  // now structural rather than patched up afterwards).
  for (const i of lumenCells) {
    if (isWallSpecId(grid.specId[i] as number)) grid.clearAt(i);
  }

  // Glass nobody claimed this time round belonged to an entity that has since
  // moved, been reshaped, or been deleted. Only glass: matter that happens to
  // be sitting on a vacated cell (a vessel's contents, cargo left in a
  // removed tube's lumen) stays exactly where it is.
  for (const i of previouslyOwned) {
    if (grid.entityOwner[i] === 0 && grid.specId[i] === GLASS_WALL_SPEC_ID) grid.clearAt(i);
  }

  // A membrane's grid presence is nothing but ownership: movement.ts looks
  // the owning filter's allow-list up by grid.entityOwner (there is no
  // separate per-cell filter-id array anymore -- see filter.ts). Claimed
  // last, and only at cells that aren't glass, for two reasons that are
  // really one -- glass provenance is tracked through ownership, so a
  // membrane holding the owner slot at a glass cell would corrupt it either
  // way it broke: claim a *painted* glass cell and the next composite's
  // stale-glass pass eats the player's wall; claim a *vessel's* glass cell
  // and deleting that vessel leaves its glass orphaned there forever (the
  // membrane's claim keeps shielding it from the cleanup above). Skipping
  // glass costs nothing: a glass cell blocks movement outright, so an
  // allow-list lookup there could never matter, and the moment the glass
  // goes away a recomposite hands the bare cell to the membrane. Painted
  // non-glass walls are skipped for the same shape of reason: an owned wall
  // cell is eraser-proof (see worker.ts's 'erase'), and a membrane must not
  // make the player's own painted wall undeletable.
  for (const { entityId, cells } of membraneCells) {
    for (const i of cells) {
      if (!isWallSpecId(grid.specId[i] as number)) grid.entityOwner[i] = entityId;
    }
  }
}
