// The one place apparatus becomes grid state.
//
// Every placed apparatus (funnel, tube, flask, filter, radiator, glass
// polygon) declares a Footprint -- which cells are its glass, its lumen, its
// membrane, its radiating cells -- and this module
// derives ALL of that grid state from the instance list in one pass: wipe the
// derived arrays, then stamp every entity in placement order. An edit is
// "mutate the instance, then recomposite"; there is no incremental unstamp
// anywhere in src/sim anymore.
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
// What the compositor does NOT touch: painted terrain. stirrerMask, sinkMask
// and catalystStrength are brush strokes the player owns, not apparatus
// output, and matter (anything that isn't glass on a cell an entity claims)
// is never cleared -- a vessel's contents survive the vessel being resized,
// moved or deleted.
import { PhaseCode, TubeMaskValue, type SimGrid } from './grid';
import { filterLineCells, type FilterInstance } from './filter';
import { flaskFootprint, type FlaskInstance } from './flask';
import { funnelGlassCells, type FunnelInstance } from './funnel';
import { glassCells, type GlassInstance } from './glass';
import { glassWallEnergyAtAmbient } from './heat';
import { radiatorStamp, type RadiatorInstance } from './radiators';
import type { SpeciesTable } from './species';
import { tubeGlassCells, tubeLumenCells, type TubeInstance } from './tube';
import type { Point } from './tube-shapes';
import { GLASS_WALL_SPEC_ID, isWallSpecId } from './walls';

/** What one entity puts on the grid. Every field is optional; a kind fills in
 * only the roles it has (a filter is nothing but a membrane, a flask is just
 * walls, a tube is walls plus the channel bored through them). */
export interface Footprint {
  /** Real glass wall matter in specId. Claims the cell (grid.entityOwner). */
  readonly wall?: readonly Point[];
  /** A bored channel: clears any wall matter in the way and flags the cell
   * as tube cargo space (TubeMaskValue.Lumen). */
  readonly lumen?: readonly Point[];
  /** Filter membrane cells; `maskValue` is the owning line's per-cell id, the
   * one movement.ts looks an allow-list up by (see filter.ts). */
  readonly membrane?: { readonly cells: readonly Point[]; readonly maskValue: number };
  /** Cells that radiate, and how far/toward what (see radiators.ts). */
  readonly radiator?: { readonly cells: readonly Point[]; readonly radius: number; readonly targetK: number };
}

/** Everything on the bench. The lists stay per-kind for now; phase 3 of the
 * overhaul plan collapses them into one `entities: AnyEntity[]`. */
export interface PlacedEntities {
  readonly funnels: readonly FunnelInstance[];
  readonly tubes: readonly TubeInstance[];
  readonly flasks: readonly FlaskInstance[];
  readonly filters: readonly FilterInstance[];
  readonly radiators: readonly RadiatorInstance[];
  readonly glass: readonly GlassInstance[];
}

export const NO_ENTITIES: PlacedEntities = { funnels: [], tubes: [], flasks: [], filters: [], radiators: [], glass: [] };

/** Every placed entity's footprint, in the order the compositor stamps them:
 * ascending entityId, i.e. the order they were placed on the bench. That's
 * what makes "who wins where two footprints overlap" a stable property of the
 * bench rather than of whichever apparatus was edited most recently. */
export function entityFootprints(placed: PlacedEntities): { entityId: number; footprint: Footprint }[] {
  const out: { entityId: number; footprint: Footprint }[] = [];
  for (const f of placed.funnels) out.push({ entityId: f.entityId, footprint: { wall: funnelGlassCells(f) } });
  for (const t of placed.tubes) {
    out.push({ entityId: t.entityId, footprint: { wall: tubeGlassCells(t), lumen: tubeLumenCells(t) } });
  }
  for (const f of placed.flasks) out.push({ entityId: f.entityId, footprint: { wall: flaskFootprint(f).wallCells } });
  for (const f of placed.filters) {
    out.push({ entityId: f.entityId, footprint: { membrane: { cells: filterLineCells(f), maskValue: f.id } } });
  }
  for (const r of placed.radiators) out.push({ entityId: r.entityId, footprint: { radiator: radiatorStamp(r) } });
  for (const g of placed.glass) out.push({ entityId: g.entityId, footprint: { wall: glassCells(g) } });
  out.sort((a, b) => a.entityId - b.entityId);
  return out;
}

function indexOf(grid: SimGrid, p: Point): number | null {
  return grid.inBounds(p.x, p.y) ? grid.index(p.x, p.y) : null;
}

/** Re-derives every apparatus-owned cell on the grid from `placed`. Safe to
 * call as often as you like: running it twice in a row leaves the grid
 * byte-identical (entity-composite.test.ts asserts that), which is what lets
 * every message handler simply mutate an instance and composite afterwards
 * without reasoning about what the edit disturbed. */
export function compositeEntities(grid: SimGrid, species: SpeciesTable, placed: PlacedEntities): void {
  // The masks are 100% apparatus-derived, so they're wiped wholesale rather
  // than per-owner -- cheaper than a scan, and it means a stale mask cell can
  // never outlive the entity that set it (the "invisible barrier belonging to
  // a tube that no longer exists" bug, made unrepresentable).
  grid.tubeMask.fill(0);
  grid.filterMask.fill(0);
  grid.radiatorRadius.fill(0);
  grid.radiatorTargetK.fill(0);

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
  for (const { entityId, footprint } of entityFootprints(placed)) {
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
      for (const cell of membrane.cells) {
        const i = indexOf(grid, cell);
        if (i !== null) grid.filterMask[i] = membrane.maskValue;
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
}
