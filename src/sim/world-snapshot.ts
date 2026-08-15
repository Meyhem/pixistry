// Whole-world snapshot/restore -- captures every grid array plus the
// entity list and the sink tally in one shot, and copies
// them back later. This is the "rewind" primitive a manual Save/Restore in
// sandbox and campaign mode's Run Test both build on (see
// .grill/campaign-mode.md's Phase 0/5) -- a snapshot taken right before a
// risky change (or a fast-forward burst) means trying something never
// costs the player their work.
//
// Pure data in, pure data out: restoring copies straight back into the
// grid's existing typed arrays via .set() rather than replacing them, since
// every array here stays the same fixed size (the grid's dimensions never
// change) for the worker's whole lifetime.
//
// Only matter and painted terrain are stored. Everything apparatus-derived
// (tubeMask, the radiator fields, entityOwner) is
// left out and rebuilt by compositing the restored entity list -- storing
// both would be storing the same fact twice, and the copy that drifted would
// win.
import { compositeEntities } from './entity-composite';
import { reseedEntityIds } from './entity-id';
import type { AnyEntity } from './entity';
import type { SimGrid } from './grid';
import type { SpeciesTable } from './species';
import type { SinkCounter } from './sink';

export interface WorldSnapshot {
  readonly specId: Uint16Array;
  readonly u: Float32Array;
  readonly phase: Uint8Array;
  readonly stirrerMask: Uint8Array;
  readonly sinkMask: Uint8Array;
  readonly catalystStrength: Uint8Array;
  readonly entities: readonly AnyEntity[];
  readonly sinkTotals: Uint32Array;
  readonly sinkGrandTotal: number;
  readonly sinkHistory: SinkCounter['history'];
  readonly ventTotals: Uint32Array;
  readonly ventGrandTotal: number;
  readonly tick: number;
}

/** Deep-copies every grid array (typed arrays clone via .slice(), which
 * copies the underlying buffer, not just the view) plus the entity list
 * (structuredClone -- a TubeInstance nests a Set and precomputed geometry
 * arrays, so a shallow copy would still alias the live instances) and the
 * sink tally. Cheap at this grid's size (six arrays of ~16000 cells, well
 * under a millisecond), so it's fine to call this on every Run Test burst,
 * not just a one-off manual save. */
export function captureWorldSnapshot(
  grid: SimGrid,
  entities: readonly AnyEntity[],
  sinkCounter: SinkCounter,
  ventCounter: SinkCounter,
  tick: number,
): WorldSnapshot {
  return {
    specId: grid.specId.slice(),
    u: grid.u.slice(),
    phase: grid.phase.slice(),
    stirrerMask: grid.stirrerMask.slice(),
    sinkMask: grid.sinkMask.slice(),
    catalystStrength: grid.catalystStrength.slice(),
    entities: structuredClone(entities as AnyEntity[]),
    sinkTotals: sinkCounter.totals.slice(),
    sinkGrandTotal: sinkCounter.grandTotal,
    sinkHistory: structuredClone(sinkCounter.history),
    // No vent history: only 'rate' goals read a history, and those score
    // collected product, never vented waste (see objectives.ts), so
    // recordSinkHistory is never called on the vent counter.
    ventTotals: ventCounter.totals.slice(),
    ventGrandTotal: ventCounter.grandTotal,
    tick,
  };
}

export interface RestoredWorld {
  readonly entities: AnyEntity[];
  readonly tick: number;
}

/** Copies a snapshot's matter and painted terrain back into `grid` in place,
 * restores the sink tally, and re-derives every apparatus cell by compositing
 * the restored entity list. Returns that list and the tick for the caller to
 * reassign -- worker.ts holds them as plain `let` bindings rather than
 * SimGrid fields, so they can't be restored in place here the way the grid's
 * own arrays are. */
export function restoreWorldSnapshot(
  grid: SimGrid,
  species: SpeciesTable,
  sinkCounter: SinkCounter,
  ventCounter: SinkCounter,
  snapshot: WorldSnapshot,
): RestoredWorld {
  grid.specId.set(snapshot.specId);
  grid.u.set(snapshot.u);
  grid.phase.set(snapshot.phase);
  grid.stirrerMask.set(snapshot.stirrerMask);
  grid.sinkMask.set(snapshot.sinkMask);
  grid.catalystStrength.set(snapshot.catalystStrength);
  sinkCounter.totals.set(snapshot.sinkTotals);
  sinkCounter.grandTotal = snapshot.sinkGrandTotal;
  sinkCounter.history = structuredClone(snapshot.sinkHistory);
  ventCounter.totals.set(snapshot.ventTotals);
  ventCounter.grandTotal = snapshot.ventGrandTotal;

  const entities = structuredClone(snapshot.entities as AnyEntity[]);
  // Zeroed *before* compositing, not by it: the owner marks still on the grid
  // belong to the world being thrown away, and the compositor's final pass
  // clears unclaimed glass at every previously-owned cell -- so a stale owner
  // sitting on a cell the snapshot restored as painted glass would eat it.
  grid.entityOwner.fill(0);
  compositeEntities(grid, species, entities);
  // The counter was handing out ids in the world we just discarded; a
  // restored entity may hold one at or above where it now sits.
  reseedEntityIds(entities.map((e) => e.entityId));
  return { entities, tick: snapshot.tick };
}
