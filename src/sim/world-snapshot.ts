// Whole-world snapshot/restore -- captures every grid array plus the
// funnel/tube instance lists and the sink tally in one shot, and copies
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
import type { SimGrid } from './grid';
import type { FunnelInstance } from './funnel';
import type { SinkCounter } from './sink';
import type { TubeInstance } from './tube';

export interface WorldSnapshot {
  readonly specId: Uint16Array;
  readonly u: Float32Array;
  readonly phase: Uint8Array;
  readonly radiatorRadius: Uint8Array;
  readonly radiatorTargetK: Float32Array;
  readonly stirrerMask: Uint8Array;
  readonly tubeMask: Uint8Array;
  readonly filterMask: Uint8Array;
  readonly vesselMask: Uint8Array;
  readonly sinkMask: Uint8Array;
  readonly funnels: readonly FunnelInstance[];
  readonly tubes: readonly TubeInstance[];
  readonly sinkTotals: Uint32Array;
  readonly sinkGrandTotal: number;
  readonly tick: number;
}

/** Deep-copies every grid array (typed arrays clone via .slice(), which
 * copies the underlying buffer, not just the view) plus the funnel/tube
 * instance lists (structuredClone -- TubeInstance nests a Set and
 * precomputed geometry arrays, so a shallow copy would still alias the
 * live instances) and the sink tally. Cheap at this grid's size (10 arrays
 * of ~16000 cells, well under a millisecond), so it's fine to call this on
 * every Run Test burst later, not just a one-off manual save. */
export function captureWorldSnapshot(
  grid: SimGrid,
  funnels: readonly FunnelInstance[],
  tubes: readonly TubeInstance[],
  sinkCounter: SinkCounter,
  tick: number,
): WorldSnapshot {
  return {
    specId: grid.specId.slice(),
    u: grid.u.slice(),
    phase: grid.phase.slice(),
    radiatorRadius: grid.radiatorRadius.slice(),
    radiatorTargetK: grid.radiatorTargetK.slice(),
    stirrerMask: grid.stirrerMask.slice(),
    tubeMask: grid.tubeMask.slice(),
    filterMask: grid.filterMask.slice(),
    vesselMask: grid.vesselMask.slice(),
    sinkMask: grid.sinkMask.slice(),
    funnels: structuredClone(funnels as FunnelInstance[]),
    tubes: structuredClone(tubes as TubeInstance[]),
    sinkTotals: sinkCounter.totals.slice(),
    sinkGrandTotal: sinkCounter.grandTotal,
    tick,
  };
}

export interface RestoredWorld {
  readonly funnels: FunnelInstance[];
  readonly tubes: TubeInstance[];
  readonly tick: number;
}

/** Copies a snapshot's arrays back into `grid` in place and restores the
 * sink tally into `sinkCounter`. Returns the funnel/tube instance lists and
 * tick for the caller to reassign -- worker.ts holds those as plain `let`
 * bindings rather than SimGrid fields, so they can't be restored in place
 * here the way the grid's own arrays are. */
export function restoreWorldSnapshot(grid: SimGrid, sinkCounter: SinkCounter, snapshot: WorldSnapshot): RestoredWorld {
  grid.specId.set(snapshot.specId);
  grid.u.set(snapshot.u);
  grid.phase.set(snapshot.phase);
  grid.radiatorRadius.set(snapshot.radiatorRadius);
  grid.radiatorTargetK.set(snapshot.radiatorTargetK);
  grid.stirrerMask.set(snapshot.stirrerMask);
  grid.tubeMask.set(snapshot.tubeMask);
  grid.filterMask.set(snapshot.filterMask);
  grid.vesselMask.set(snapshot.vesselMask);
  grid.sinkMask.set(snapshot.sinkMask);
  sinkCounter.totals.set(snapshot.sinkTotals);
  sinkCounter.grandTotal = snapshot.sinkGrandTotal;
  return {
    funnels: structuredClone(snapshot.funnels as FunnelInstance[]),
    tubes: structuredClone(snapshot.tubes as TubeInstance[]),
    tick: snapshot.tick,
  };
}
