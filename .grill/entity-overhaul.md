# Entity system overhaul plan

Baseline at time of writing: `npm test` 629 passing / 26 files, `npm run typecheck` clean.
Every phase below must land with both still green, the UI verified in the browser when the phase is
UI-observable, and a commit pushed to `origin main` (per CLAUDE.md's git workflow). Phases are ordered
so each is independently revertable and none depends on a later one. Update ARCHITECTURE.md's affected
sections as part of each phase, not as a final cleanup pass.

## Why (the diagnosis, in one paragraph)

The apparatus system is an N×M matrix: 6 entity kinds (funnel, tube, flask, filter, radiator, glass
polygon) × ~10 operations (place, move, reshape, rotate, configure, erase, hit-test, draft, panel,
snapshot), nearly every cell hand-written. Overlap correctness is reconstructed by three coexisting
bookkeeping schemes (`apparatus-repair.ts`'s "put back what went empty" heuristic, per-kind crossing
rules in `unstampGlass`/`unstampRadiator`/`unstampFilter`, and the tube's `restampTubeMask` +
per-tick `boreWallsFromLumen`). Selection carries 6 selected-ids, 6 draft types and 12 drag fields;
the side panel has 6 per-kind panel enums; the protocol has ~20 per-kind messages; erase semantics
differ per kind. Every recent regression (apparatus destroying each other's glass, conveyors freezing
pixels, knee drags collapsing tubes) is a cross-interaction between two hand-written cells of that
matrix. The overhaul collapses the matrix to one row.

## Target model

1. **One entity registry, non-destructive recomposite.** Worker holds one `entities: AnyEntity[]`
   list. A new `grid.entityOwner` (Uint32, 0 = unowned) records which entity's footprint each
   apparatus cell belongs to. All apparatus-derived grid state (glass wall cells in `specId`,
   `tubeMask`, filter membrane cells, radiator fields) is **derived** by one compositor: clear every
   owned cell, then stamp every entity in list order (z = placement order). Any entity edit = mutate
   instance → recomposite. Dragging A across B cannot damage B, because B's cells are re-derived, not
   "repaired".
2. **Entities are indestructible** (requirement 1). The eraser touches matter only. Deletion happens
   through the Select tool (Delete key / panel button). No partial-erase states exist.
3. **Entities are not bypassable** (requirement 1). Movement gains the standard falling-sand
   anti-corner-cut rule, closing diagonal tunneling through every 1-px diagonal wall — not just flask
   interiors.
4. **One shape/handle vocabulary** (requirement 2). Two shape families — polyline (tube, filter,
   radiator, glass chain) and prefab stamp (flask, funnel). Each kind implements one small interface
   (`footprintOf`, `handlesOf`, `dragHandle`, `move`, optional `rotate`, settings schema). Selection,
   hit-testing, dragging, handle overlay: written once against the interface.
5. **One generic protocol.** `placeEntity` / `moveEntity` / `dragEntityHandle` / `rotateEntity` /
   `updateEntitySettings` / `entityAction` / `deleteEntity`, one `entities[]` list per frame.
6. **Schema-driven settings pane** (requirement 3). Each kind declares its fields once; the pane
   renders the schema for both pre-placement config and selected-entity editing; edits send
   `updateEntitySettings` and re-stamp live.
7. **Tube rework** (user request): no suction cone — intake only from the cells directly at the
   mouth; lumen 3 cells wide; transport via a distance-to-exit gradient.

### What deliberately does NOT change

Chemistry data/tables, the heat runaway guards, `react.ts`, the renderer, movement's density/phase
rules (only `tryDiagonal` and mask reads change), funnel drip mechanics, flask/funnel shape tables,
octant snapping (`snapOctant`, `resolveKneePosition` — they're good), sink consumption mechanics,
scenario Restrictions enforcement, burst/snapshot message flow, worker-owns-truth + per-frame
snapshots, and the "drafts beat frame latency" idea (just one draft instead of six).

---

## Phase 1 — Compositor + ownership; eraser stops touching entities

The biggest bug-killer; almost no UI change.

**New `src/sim/entity-composite.ts`:**

```ts
interface Footprint {
  wall?: readonly Point[];      // stamped as glass matter in specId
  lumen?: readonly Point[];     // bores glass, sets tubeMask Lumen
  membrane?: readonly Point[];  // sets filterMask (phase 3 retires filterMask for entityOwner)
  interior?: readonly Point[];  // sets vesselMask (deleted in phase 2; kept for stirred flasks)
  radiator?: { cells: readonly Point[]; radius: number; targetK: number };
}
function compositeEntities(grid, species, placed): void
```

- **Clear pass:** for every cell with `entityOwner != 0`: clear `specId` if it's glass, zero
  `tubeMask`/`filterMask`/`vesselMask`, zero owner. Cells with owner 0 (painted walls, matter) are
  never touched.
- **Wholesale fields:** `radiatorRadius`/`radiatorTargetK` are zeroed entirely and re-stamped from
  the radiator instance list (last stamped wins per cell, as today). Prerequisite folded into this
  phase: `scenario.ts`'s `applyRadiator` must create *tracked* radiator instances instead of writing
  the fields raw, or scenario heaters would vanish on the first recomposite.
- **Stamp pass** in list order: wall → glass at ambient + owner; lumen → bore glass (including glass
  stamped earlier in this same pass — this is `boreWallsFromLumen` generalized), `tubeMask = Lumen`,
  owner; membrane → `filterMask = filter.id`, owner; interior → `vesselMask = 1`, owner.
- `stirrerMask`, `sinkMask`, `catalystStrength` are painted terrain; the compositor never touches
  them. Stirred flasks stop stamping `stirrerMask`: `stepStirrers(grid, rng, flasks)` unions the
  painted mask with stirred-flask interiors computed from instances. (Otherwise a recomposite would
  eat stirrer paint the player applied inside a vessel.)

**Global ids:** every placed instance gains an `entityId` from one worker-side counter (per-kind
`id`s stay on the wire until phase 3). On snapshot restore, reseed the counter to `max(entityId)+1`.

**Worker (`worker.ts`):** replace the `editApparatus`/`repairingApparatus` wrapper with
`mutateEntities(fn)` = run `fn`, then composite. Every place/move/update handler goes through it.

**Eraser becomes matter-only:** the `'erase'` handler keeps `grid.clear` plus the painted-terrain
masks (`stirrerMask`, `sinkMask`, `catalystStrength`, and radiator... no — radiators are entities;
erase no longer removes them) and drops everything else: no per-kind instance deletion, no
`pruneErasedFilters/Radiators/Glass`, no `unstampTube`/`unstampFlask` calls, no
`refreshTubeOverlays`. Glass at owned cells simply isn't cleared (guard: skip cells whose
`entityOwner != 0`); painted (owner-0) glass still erases.

**Interim deletion path** (so apparatus stays removable): new message `deleteApparatus {kind, id}`;
worker removes the instance and composites. UI: Delete/Backspace with the Select tool active deletes
the selection; each existing edit panel gets a small Delete button. (Both are generalized in phases
3–4.)

**Snapshot (`world-snapshot.ts`):** drop the derived arrays (`tubeMask`, `filterMask`, `vesselMask`,
`radiatorRadius`, `radiatorTargetK`) from `WorldSnapshot`. Restore = copy matter arrays + painted
masks, restore instance lists (rebuild tube geometry caches from points), **zero `entityOwner`
fully**, then composite. (Zeroing first matters: stale owner cells from the pre-restore world would
otherwise let the clear pass eat restored painted glass.)

**Deletions:** `apparatus-repair.ts` + its test; `glass.ts`'s `unstampGlass` crossing logic;
`radiators.ts`'s `unstampRadiator`; `filter.ts`'s `unstampFilter`/`pruneErasedFilters` and the
id-reuse machinery's *eraser* callers; `tube.ts`'s `restampTubeMask`, `boreTubeLumens`,
`unstampTube` (per-tick `boreWallsFromLumen` inside `stepOneTube` stays — wall *paint* and scenario
walls can still land on a lumen).

**Tests:**
- New `entity-composite.test.ts`: composite idempotence (running twice yields byte-identical
  arrays); drag-A-over-B-and-away leaves B intact (the beaker/tube regressions from commits
  `f8f5379`/`ed7a502`, as tests); z-order on overlap; lumen bores earlier glass; eraser leaves entity
  glass but takes painted glass; delete removes footprint and leaves neighbors.
- New `entity-fuzz.test.ts`: random place/move/delete sequences across all kinds; after every op
  assert composite idempotence, owner↔instance consistency (every owned cell maps to a live entity
  whose footprint covers it; every footprint cell not shadowed by higher z is present), no orphan
  lumen/filter cells, all arrays finite. This suite grows in later phases.
- Update existing tests that exercised erase-deletion and repair behavior.

**Landed. Two things the implementation turned up that the plan didn't predict:**
- The lumen bore has to run *after* every wall is stamped, not inline in z-order. A funnel placed later
  than a tube otherwise stamps its outline straight across the channel and plugs the conveyor with its own
  glass. (Caught by the fuzz suite's "a lumen is never wall matter" invariant.)
- `moveTubeSegment` could produce an off-axis segment — dragging the *last* segment of a 3+ knee tube
  resolved knee `i` against the old position of knee `j` and then translated `j` independently — and
  `polylineToLumenPath`'s "walk until you arrive" loop never arrives for a misaligned pair, so it spun
  forever appending cells and took the worker down. Fixed at both ends: a free end now keeps the segment
  vector, `hasDegenerateSegment` refuses an off-axis result, and the path walk derives its step count up
  front so it can't hang whatever it's handed. This was live on `main`, not introduced by the overhaul.

**Behavior changes to note in the commit:** partial-line erase is gone; erase-the-anchor/knee
deletion is gone (Delete key instead); overlap layering becomes stable placement order instead of
last-edit-wins; painting a different wall material over apparatus glass reverts on that apparatus's
next recomposite (its cells are owned).

## Phase 2 — Movement hardening: universal no-bypass; delete `vesselMask`

- `movement.ts` `tryDiagonal`: block a diagonal move from `(x,y)` to `(nx,ty)` when **both** shared
  orthogonal neighbors `(nx,y)` and `(x,ty)` are solid-blocking. Solid-blocking = wall specId, lumen
  mask, or a membrane cell that rejects this species (`canEnterFiltered` false). Matter does not
  count (grains may still slide through matter pinches; outer-corner slides keep one open side).
- Delete `vesselMask` everywhere: grid field + `clearAll`, flask/compositor interior stamping (the
  `interior` footprint list itself stays — `stepStirrers` uses it for stirred flasks), movement's
  `fromInsideVessel` logic, snapshot. The corner rule subsumes the "falling through glass" case it
  existed for.
- **Tests:** sealed 1-px *diagonal* glass vessel holds liquid and gas for thousands of ticks (this
  fails on main today); pouring through a flask mouth still works; a grain still slides past an
  outer corner; extend `fuzz.test.ts` benches with diagonal glass lines.

**Landed.** The `interior` footprint role went away entirely rather than being kept for stirred flasks:
`stepStirrers` already derives those interiors from the flask instances themselves (phase 1), so nothing
was left reading it.

## Phase 3 — One entity model, one protocol, one selection path

Split into two commits.

**3a — worker + protocol.**
- `src/sim/entity.ts` (pure, importable by UI like `tube-shapes.ts`): add a `kind` discriminant to
  each instance type; `AnyEntity` union; `ENTITY_DEFS: Record<EntityKind, EntityDef>` with
  `footprintOf`, `handlesOf`, `dragHandle`, `move`, `rotate?`, `place`, `toWire`, plus (phase 4)
  `settingsSchema`/`settingsOf`/`applySettings`/`actions`.
- Handles: `{ handleId, x, y }`; polyline kinds expose every knee/corner/end (tube knees keep
  `resolveKneePosition`; **glass corners become individually draggable** — new capability; the drag
  target is inverse-transformed into base-point space so rotation stays lossless); line ends keep
  their reshape semantics; body drags stay relative moves.
- Worker: the six lists collapse into `entities: AnyEntity[]`; the six `withX` helpers into one
  `withEntity(entityId, fn)`; per-tick steps take filtered views.
- Protocol v2: `placeEntity {kind, params}` (payload union), `moveEntity {entityId, dx, dy}`,
  `dragEntityHandle {entityId, handleId, x, y}`, `rotateEntity {entityId, rotation}` (absolute),
  `updateEntitySettings {entityId, values}`, `entityAction {entityId, action}` (funnel Reset),
  `deleteEntity {entityId}` (replaces the interim `deleteApparatus`), and frames carry
  `entities: EntityWire[]` (lean — no tube geometry caches) instead of six snapshot arrays.
  Scenario gating: `placeEntity` checks the kind→ToolKind map with the existing `isToolAllowed`,
  funnels additionally `isFunnelSpeciesAllowed`.
- `filterMask` retired: movement's membrane lookup becomes `entityOwner` + a per-tick
  entityId→allow-list map (a cell whose owner isn't in the map isn't a membrane). Deletes
  `MAX_FILTER_ID`, `allocateFilterId`, the 255-line cap, and the id-reuse stale-selection hazard.
- `world-snapshot.ts`: one `entities` list.

**3a landed.** Things the implementation settled that the plan didn't specify:
- **A membrane claims only non-wall cells, in a final pass after boring and stale-glass cleanup.** Glass
  provenance is tracked through ownership, so a membrane holding the owner slot at a glass cell corrupts
  it whichever way it breaks: claim a *painted* glass cell and the next composite's cleanup eats the
  player's wall; claim a *vessel's* glass cell and deleting the vessel leaves its glass orphaned behind
  the membrane's claim. Skipping glass costs nothing (a wall cell blocks outright, so an allow-list
  lookup there can never matter) and the moment the glass goes, a recomposite hands the bare cell to the
  membrane. It also keeps membranes from making a painted wall eraser-proof (owned wall cells are
  protected from the eraser). `filter.test.ts` and a fuzz invariant pin this.
- **Per-segment tube dragging is gone**, not just re-routed: protocol v2 has no segment message by
  design (a tube's segments are body, and body drags slide the whole entity — reshaping is what knee
  handles are for), so `moveTubeSegment` and its "free end keeps the segment vector" subtlety were
  deleted outright rather than kept as dead code.
- **Glass corners became draggable end to end** (registry `dragHandle` + the old hit-test), not just as
  a latent def capability -- the corner drag inverse-transforms the cursor into base-point space so
  rotation stays lossless.
- The frame still carries a 0/1 `filterMask` as a pure render hint (derived per frame from
  `entityOwner`), so the renderer keeps tinting membranes without learning anything about entities.
- The fuzz suite now drives every op through the generic dispatchers (`placeEntityFromWire`,
  `moveEntityBy`, `dragEntityHandleTo`, `rotateEntityTo`, `applyEntitySettings`) -- the same surface the
  worker's handlers call -- and picks drag handles via `entityHandles(entityToWire(e))` exactly the way
  the UI would.
- The UI kept its per-kind selection fields (that's 3b) but its twelve drag-state fields collapsed to
  two on their own: under protocol v2 every body drag is the same relative `moveEntity` and every handle
  drag the same absolute `dragEntityHandle`.

**3b — UI.**
- `EntitySelection` replaces `ApparatusSelection`: `selectedId: number | null`, one `draft`, one
  `dragState` (`{mode:'body', lastX, lastY}` | `{mode:'handle', handleId}`). Draft is seeded in
  exactly one place (`select()`), fixing today's two seeding conventions.
- One generic hit-test: nearest handle within ~2.5 cells wins; else body candidates (polyline kinds
  by `pointSegmentDistance ≤ 2`, stamp kinds by bounds) with the **smallest footprint area** winning
  — replaces the hand-ordered funnel→knee→segment→filter→radiator→glass→flask chain and keeps small
  apparatus clickable inside large ones by construction.
- One wheel handler via the registry's `rotate` capability (funnel/flask facing, glass rotation);
  one `dropStaleSelection`; `drawSelectionHandles`/selection box drawn generically from
  `handlesOf(wire)` + footprint bounds.

**3b landed.** The registry grew a wire-side half to make this possible, which the plan folded into
"hit-test" without naming: `bodyCells` (what an entity reads as on screen -- a tube's is its *channel*,
not its wall ring), `bodyDistance`, `boundsOf` and `rotationOf`, all over the wire shape, since the UI
has no grid to resolve a real `Footprint` against. `hitTestEntities` itself lives in `entity.ts` rather
than the UI: it's the registry's own question, and putting it there is what let `ApparatusHit`'s ten
variants become one `{entityId, kind, handleId}` (handleId null = body).
- The area-wins rule replaced the hand-ordered chain as planned, and it is *load-bearing* for the
  funnel-inside-a-beaker case that the old chain hardcoded a position for.
- `rotateSelection` returning a message-or-null is what collapsed the wheel: no per-kind branch, and
  the two kinds whose facing the panel also reads keep their draft in step inside the selection rather
  than at the call site.
- Selection boxes still skip filter/radiator deliberately -- a bracket around a diagonal line says less
  than its own highlighted cells and end handles already do.

## Phase 4 — Schema-driven settings pane

- Field kinds: `slider`, `toggle`, `segmented`, `species-pick` (opens the periodic-table picker),
  `species-set` (chip list; used by tube + filter allow-lists), `readout` (funnel remaining),
  `action` (funnel Reset). Schemas live with the kinds in `entity.ts`; labels/colors resolved via a
  ctx the panel provides (palette, species lookup, open-picker callbacks).
- `side-panel.ts`: one `renderEntityPanel(schema, values, ctx)` drives **both** pre-placement tool
  config and selected-entity editing (today's funnel panel already proves the two can share).
  `ToolMeta`'s `funnelPanel`/`tubePanel`/`filterPanel`/`flaskPanel`/`glassPanel`/`radiatorPanel`
  collapse into one `entityPanel` descriptor; the parallel per-kind callback sets in
  `SidePanelCallbacks` collapse into `onEntitySettingsChange(values)` / `onEntityAction(action)`.
- Edit-mode header gains Delete and Duplicate buttons (Duplicate = `placeEntity` with the selected
  entity's params offset by (+2,+2), then select the new id).
- Requirement 3 lands here: select → pane shows that instance's settings; every edit round-trips
  through `updateEntitySettings` and re-stamps live.

## Phase 5 — Conveyor tube rework (no cone, 3-wide, gradient transport)

**Landed** (taken before phases 3–4, which it shrinks: `coneSize` is gone from the protocol, the settings
schema and the panel, so there's that much less to carry through the generic-entity refactor). One thing
the plan got wrong: the aperture sits **two** steps out from the end knee, not one. The band is a
Chebyshev-1 dilation of the centre path, so it already caps one cell past the last centre cell -- an
aperture one step out lands *inside* the channel, and intake/discharge become no-ops against the tube's
own cells.

**Geometry (`tube-shapes.ts`):**
- `lumenBand(path)`: every cell within Chebyshev distance 1 of the center path (3-wide on straight
  *and* diagonal segments), deduped, ordered by path index.
- Apertures: at each end, the 3 cells `{end + dir + perp·k, k ∈ -1..1}` (`perp` = dir rotated 90°) —
  the mouth's intake row and the exit's discharge row. Wall = every 8-neighbor of the band that is
  neither band nor aperture — the same flat watertight rule as today, unchanged in spirit.
- `distanceToExit`: BFS over the band (8-connected), seeded from band cells adjacent to exit
  apertures. Precomputed in `buildTubeGeometry`; every band cell is guaranteed a strictly-decreasing
  neighbor by BFS construction.

**Transport (`tube.ts` `stepOneTube`), replacing the single-file walk + cone suction:**
1. *Eject:* band cells adjacent to the exit apertures, if occupied, swap into an empty non-wall,
   non-lumen aperture cell (deterministic order). Blocked exit ⇒ they stay ⇒ backpressure, as today.
2. *Advance:* occupied band cells in ascending `distanceToExit`; each moves into an empty 8-adjacent
   band cell with strictly smaller distance (fixed neighbor order + rng tie-break so lanes don't
   band). Ascending order preserves the one-cell-per-tick shift-register property.
3. *Intake:* for each mouth aperture cell holding matter (non-wall, allow-list-passing), swap into
   an empty adjacent mouth band cell. **That's the whole suction model** — pixels that arrive at the
   input get taken; nothing at a distance is grabbed.

**Deletions:** `coneCells`, `TubeMaskValue.Cone`, `ConeHold`/`coneHoldMap`/`coneHolds`/
`NO_CONE_HOLD`, movement's cone-hold branch and parameter, `coneSize` (protocol, settings schema,
slider, `DEFAULT_TUBE_CONE_SIZE`). This deletes the entire "pixel frozen in mid-air" bug class the
cone hold created — an off-filter grain in front of a mouth now just falls past it.

**UI:** `drawTubeGhost` renders the 3-wide band; tube hint text updated ("place the mouth where
material falls or flows; it swallows what arrives").

**Tests:** rewrite `tube.test.ts` transport suite (3-lane advance, backpressure through a full bend,
knee turns, intake allow-list, off-filter matter falls freely past the mouth, two tubes chained
mouth-to-exit); `tube-shapes.test.ts` (band geometry on axis + diagonal segments, watertightness:
every non-aperture neighbor of the band is wall, aperture size/placement, distance-field
monotonicity); extend the fuzz suite with tube ops.

## Phase 6 — QOL batch (independent, any order)

- **6a Hover affordance:** pointermove runs the same hit-test; hovered entity gets a subtle outline
  tint and the cursor switches (grab over body, crosshair over handle). Cheap, biggest feel win.
- **6b Keyboard:** arrows nudge the selection ±1 cell (Shift = ±5) via `moveEntity`; `R`/`Shift+R`
  rotate where the kind supports it; `Ctrl+D` duplicate; `Esc` deselect. (Delete landed in phase 1.)
- **6c Apparatus undo/redo:** worker keeps a bounded stack (~50) of `structuredClone(entities)`;
  UI sends `undoCheckpoint` at drag-start and before discrete ops; `undoEntities`/`redoEntities`
  restore a stack frame + composite. Matter is deliberately not covered (that's `snapshotWorld`'s
  job); say so in the UI copy.
- **6d Scenario apparatus become locked entities:** `locked?: true` on the instance; worker refuses
  move/drag/rotate/update/delete for locked ids (UI shows a padlock and a read-only panel);
  `applyFlask`/`applyRadiator`/scenario funnels place real locked entities. Campaign benches stop
  being untracked one-shot stamps.
- **6e Sinks/vents join the system:** kinds `sink`/`vent` as free-angle line entities (they keep
  `sinkLineCells` rasterization); footprint stamps `sinkMask` + owner and the compositor takes that
  array over; `paintSinkLine` → `placeEntity`; they gain select/move/end-drag/delete. Counters stay
  global (per-sink tallies become possible later).
- **6f Selected-entity overlays:** flow-direction arrows along a selected tube; the allow-list as
  species chips beside a selected filter; a reach circle for a selected radiator.

---

## Regression-proofing rules (standing, like the heat-guard rule in CLAUDE.md)

- `entity-fuzz.test.ts` must stay in the suite and grow with every new entity kind or operation.
  If an entity bug is found in play, the fix lands with a fuzz-op or invariant that would have
  caught it, not just a targeted unit test.
- The compositor is the only code that writes `entityOwner`, apparatus glass, `tubeMask`, membrane
  cells, or radiator fields. Any new apparatus feature goes through a `Footprint`, never through
  direct grid writes — that invariant is what makes overlap/move/delete unconditionally safe.

## Risks / watch items

- **Recomposite cost during drags** (one full clear scan + all footprints per pointermove): ~38k
  cells; expected well under a millisecond. Profile in phase 1; if it ever matters, composite a
  dirty rect (union of old/new bounds) — do not reintroduce per-kind incremental unstamps.
- **Frame payload:** `EntityWire` must stay lean (points + settings only; no geometry caches).
- **Restore ordering:** zero `entityOwner` before compositing a restored world (stale owners
  otherwise eat restored painted glass); reseed the entityId counter past the restored max.
- **Stirred flasks:** after phase 1, `stepStirrers` must union painted mask + stirred interiors —
  losing that would silently un-stir every stirred flask.
- **Scenario radiators:** must become tracked in phase 1 itself, or the first recomposite deletes
  every scenario heater.

## Checklist

- [x] Phase 1: compositor + `entityOwner`; eraser matter-only; Delete key/button; snapshot slimming;
      repair/crossing/prune machinery deleted; composite + fuzz tests green
- [x] Phase 2: diagonal corner rule; `vesselMask` deleted; diagonal-vessel containment test
- [x] Phase 3a: `AnyEntity` + registry; generic protocol; `filterMask` retired; per-kind ids retired
      (`entityId` is the one id on the wire); glass corners draggable; fuzz suite drives the registry
- [x] Phase 3b: one selection/drag/hit-test path; generic handles overlay; `hitTestEntities` +
      `bodyCells`/`boundsOf`/`rotationOf` on the registry; one `EntityHit`; one wheel handler
- [ ] Phase 4: schema-driven panel; Delete/Duplicate buttons; per-kind panel enums deleted
- [x] Phase 5: 3-wide lumen; cone removed; gradient transport; tube tests rewritten
- [x] Phase 6a: hover highlight + cursor
- [x] Phase 6b: keyboard arrows/R/Esc (Ctrl+D duplicate deferred to phase 4, where one generic
      `placeEntity` replaces six per-kind place messages -- duplicating through the current protocol
      would mean six hand-written clone cases that phase 4 then deletes). Needed a new `moveTube`
      message: the tube was the one kind with no whole-move at all, only per-segment drags.
- [ ] Phase 6c–6f: undo/redo, locked scenario entities, sink/vent entities, selected-entity overlays
