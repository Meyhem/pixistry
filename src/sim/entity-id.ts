// One monotonic id space shared by every placed apparatus (funnel, tube,
// flask, filter, radiator, glass polygon), separate from the per-kind `id`
// each instance still carries on the wire.
//
// Two things need it. The compositor (entity-composite.ts) stamps entities in
// ascending entityId order, so "who wins where two footprints overlap" is
// stable placement order rather than whichever one was edited last -- a
// per-kind counter can't order a tube against a flask. And grid.entityOwner
// records one owner per cell, which only works if an id is never reused: a
// recycled id would let a freshly placed apparatus inherit the cells a
// deleted one left owned.
let nextId = 1;

export function nextEntityId(): number {
  return nextId++;
}

/** After restoring a snapshot, pushes the counter past every id the restored
 * world already contains -- the ids in a snapshot were handed out before the
 * counter was rewound past them, so continuing to count from where the live
 * world happened to be could hand a new entity an id a restored one holds. */
export function reseedEntityIds(entityIds: readonly number[]): void {
  for (const id of entityIds) {
    if (id >= nextId) nextId = id + 1;
  }
}

/** Test-only: makes ids deterministic across test files (same reason as
 * flask.ts's resetFlaskIds). */
export function resetEntityIds(): void {
  nextId = 1;
}
