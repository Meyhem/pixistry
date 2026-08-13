# Refactoring plan

Baseline at time of writing: `npm test` 146 passing / 13 files, `npm run typecheck` clean, 7662 LOC.
Every step below must land with both still green; steps are ordered so each one is independently
revertable and none depends on a later one.

## Where the complexity actually is

| Area | LOC | Problem |
|---|---|---|
| `src/ui/app.ts` | 1278 | One 1170-line closure: DOM building, ~30 mutable locals, worker protocol, apparatus hit-testing, ghost rendering, debug hook. No tests. |
| `src/sim/worker.ts` | 443 | 140-line message switch with 7 copies of "find instance by id, guard, call"; protocol types + tick loop + frame serialization in one module. |
| `src/sim/heat.ts` | 445 | Three step functions repeat the same read-cell / write-energy / recompute-phase preamble and tail. |
| `src/sim/movement.ts` | 265 | The "try straight, then diagonals, swap and mark moved" block is written out 4 times. |
| `src/ui/{toolbar,side-panel,periodic-table}.ts` | 700 | `el()` helper triplicated; ad-hoc row/hint-box construction repeated ~10 times. |
| `src/sim/{funnel,tube}.ts` | 493 | Both hand-roll stamp/unstamp of a glass footprint; funnel does it twice within one file. |

Two structural risks worth stating up front:

- **`src/ui` has zero tests.** Every UI change is verified only by typecheck + the browser. So the UI
  steps below are restricted to mechanical, behavior-preserving moves, and each ends with a manual
  pass over the affected tool in the running app.
- **CLAUDE.md asks for a long random-fuzz run before touching conduction/reaction energy, and no such
  test exists.** Step 0 adds it. Do not start step 4 without it.

---

## Step 0 — Add the missing safety net (no production code changes)

1. `src/sim/fuzz.test.ts`: seed a grid, paint random species/walls/radiators at random cells for
   ~5000 ticks running the real `runOneTick` order, assert every cell's `u` stays finite and
   `temperatureOf` stays under `MAX_TEMP_K`. This is the guard CLAUDE.md describes for the two
   runaway clamps; it is what makes step 4 safe.
2. `src/sim/worker-handlers.test.ts` cannot exist while the handlers live inside `worker.ts`'s
   module-level `self.onmessage` — that is itself part of the argument for step 3.

Cost: ~80 lines of test. Buys the ability to refactor `heat.ts` and `react.ts` with evidence.

---

## Step 1 — `src/ui/dom.ts` (pure deduplication, lowest risk)

- Move the three identical `el<K>(tag, className)` helpers into `src/ui/dom.ts`; delete from
  `toolbar.ts`, `side-panel.ts`, `periodic-table.ts`.
- Add the two builders `side-panel.ts` repeats: `propRow(label, value)` (used 4x, inline each time)
  and `hintBox(title, body)` (used 4x, 6 lines each time). ~60 lines of side-panel body disappears.

Verification: typecheck, then eyeball the toolbar, side panel and periodic table in the browser —
the DOM produced must be identical, so any visual difference is a bug in the move.

---

## Step 2 — Shared geometry primitives in `src/sim`

The disc-scan `for dy / for dx / if (dx*dx+dy*dy > r2) continue` appears in `worker.ts` (paintCircle),
`heat.ts` (applyPointHeatSource), `mixer.ts`, and twice more as an inline radius test in `worker.ts`'s
erase handler.

- Add `src/sim/geometry.ts` with `forEachCellInRadius(grid, cx, cy, radius, fn)` and
  `withinRadius(ax, ay, bx, by, radius)`.
- Rewrite the five call sites against it. `paintCircle` in `worker.ts` becomes a one-liner.

Verification: `mixer.test.ts`, `heat.test.ts` and `radiators.test.ts` already cover the behavior of
three of the five sites; they must pass unchanged.

---

## Step 3 — Split `src/sim/worker.ts` into protocol / frame / dispatch

Today `app.ts` type-imports `MainToWorkerMessage`, `FunnelSnapshot` and `TubeSnapshot` from the worker
entry module — the main thread reaching into the worker's entry point for its wire types.

1. `src/sim/protocol.ts` — move `MainToWorkerMessage`, `WorkerToMainMessage`, `FunnelSnapshot`,
   `TubeSnapshot`. Both sides import from here; `worker.ts` re-exports nothing.
2. `src/sim/frame.ts` — move `computeTempGrid`, `computeFunnelFill`, `funnelSnapshots`,
   `tubeSnapshots`, `overlayGrabbedCells` and a `buildFrame(grid, species, state)` that returns the
   message. These are pure functions of grid + instance lists, so they become **directly testable**
   for the first time (the funnel-fill precedence rule — cosmetic wash never overwrites real matter —
   currently has no test at all).
3. In `worker.ts`, collapse the seven `const instance = funnels.find(f => f.id === msg.id); if
   (instance) …` / tube equivalents into `withFunnel(id, fn)` and `withTube(id, fn)`. The switch drops
   from ~140 to ~90 lines and every id-lookup guard is written once.

Behavior must not change: the message names, payloads and tick order stay byte-identical. This is a
file move plus a guard extraction.

Verification: typecheck; then in the browser exercise place/move/update/reset for both funnel and
tube, since those are exactly the seven handlers being touched.

---

## Step 4 — Collapse the repeated cell-energy pattern in `heat.ts`

`stepConduction`'s final loop, `stepAmbient` and `stepRadiativeLoss` each open with the same six
lines (skip empty → specId → `massOf` → `thermalOf` → read `u` → `temperatureOf`) and each close with
the same "clamp, write `grid.u`, recompute `grid.phase`" tail. Three copies of the tail is a live bug
class: whichever copy forgets the phase recompute leaves a melted cell obeying its old movement rule.

- Add two internal helpers: `readCell(grid, species, idx)` returning `{specId, mass, thermal, u,
  tempK, phase}`, and `writeEnergy(grid, species, idx, newU)` which applies
  `clampEnergyToMaxTemp`, the `>= 0` floor, and the phase recompute in one place.
- Merge `heatCapacityFor` / `conductivityFor` (identical switch shape, different field) into one
  `phaseThermal(thermal, phase) -> {heatCapacity, conductivity}`.

**Do not touch** `MAX_DELTA_T_PER_TICK`, `MAX_TEMP_K`, `clampEnergyToMaxTemp`, or the per-pair flux
clamp in `exchangeEnergy` — those are the two documented runaway guards. The refactor moves where
they are called from, never whether.

Verification: `heat.test.ts` (29 tests) plus the step-0 fuzz run.

---

## Step 5 — Collapse the movement swap/diagonal pattern

`moveFalling` and `moveRising` contain four copies of

```
grid.swap(idx, target); moved[idx] = 1; moved[target] = 1; return;
```

and two copies of the "iterate `pickDiagonalOrder`, bounds-check, skip moved, test predicate, roll
`DIAGONAL_P`" loop. `canDisplace` and `canRiseThroughLiquid` additionally share five of their seven
lines (lumen check, empty check, wall check, both density lookups).

- `commitSwap(grid, moved, a, b): true` — one place that maintains the `moved` invariant.
- `tryDiagonal(grid, moved, x, y, targetY, rng, canMove): boolean` — takes the predicate, so falling
  and rising share it.
- Factor the shared head of the two predicates into `blockedTarget(grid, targetIdx)` returning the
  lumen/wall/empty verdict, leaving each predicate with only its own density rule.

Expected: ~265 → ~180 lines with no change in behavior. `movement.test.ts` (14 tests) is the gate;
because movement is RNG-driven, keep the same `rng()` call *order* — reordering calls changes the
sequence a seeded test sees. That is the one real trap in this step.

---

## Step 6 — Shared apparatus footprint stamping

`funnel.ts` stamps glass cells in `placeFunnelInstance` and again in `moveFunnelInstance` (clear-loop
+ stamp-loop, both hand-written); `tube.ts` has `stampTubeGeometry` / `unstampTubeGeometry` doing the
same job on a different cell list.

- Add `stampGlass(grid, species, cells)` and `clearCells(grid, cells)` to a small
  `src/sim/apparatus.ts`, both taking absolute `Point[]`.
- `moveFunnelInstance` becomes clear + stamp + anchor update, three lines.

This also centralizes the `glassWallEnergyAtAmbient` seeding, which is the fix for the
"apparatus glass at u=0 freezes cargo" bug documented in `heat.ts` — one call site instead of three
means a future apparatus type cannot reintroduce it.

Verification: `funnel.test.ts` (12), `tube.test.ts` (21).

---

## Step 7 — Break up `src/ui/app.ts` (largest payoff, do last)

Do this only after steps 1–6, and split into four separately-committable moves:

**7a. `describeToolMeta` → a table.** Eight branches each spell out all twelve `ToolMeta` fields;
about 130 of the function's 155 lines are repeated defaults. Replace with a `TOOL_META_DEFAULTS`
object plus per-kind overrides (`{...TOOL_META_DEFAULTS, label, color, funnelPanel: 'config'}`). The
`select-apparatus` branch stays a function, since it depends on live selection state.

**7b. Extract a `SpeciesLookup`.** `labelBySpecId` and `colorBySpecId` are built twice (once from
`SPECIES`, again from the palette in the `ready` handler) and `paletteEntryFor` does a linear
`palette.find` on every side-panel render. Replace with one `Map<number, {label, color, entry?}>`
built once in a `src/ui/species-lookup.ts`.

**7c. Extract apparatus selection into `src/ui/apparatus-selection.ts`.** The funnel and tube
selection state are parallel implementations of the same idea: `selectedXId` / `xEditDraft` /
`lastXs` / `findX` / `selectX` / `sendXUpdate`, plus `hitTestTubeKnee` and `hitTestTubeSegment` which
are the identical "nearest across all tubes, tracking best distance" loop written twice. Make it one
module owning `{selection, draft}` with `hitTest(x, y)` returning a tagged union
(`funnel | tube-knee | tube-segment | none`). `applyTool`'s `select-apparatus` case (40 lines of
nested early-breaks) collapses to a switch on that union.

**7d. Extract the four funnel field callbacks.** `onSetFunnelTemp/Rate/TotalMode/TotalAmount` are
four copies of `if (isEditMode && editDraft) { draft.K = v; sendFunnelUpdate(); } else { localK = v; }`.
Replace with one `funnelSetter(key)` factory. Same for `onToggleTubeFilterSpecies`, which spells the
set-toggle logic out twice (draft branch and pre-placement branch) — hoist the toggle into a helper
that takes the current `Set | null` and returns the next one.

Also move the ~60-line `import.meta.env.DEV` `__pixistry` hook into `src/ui/debug-hook.ts`; it is
referenced by the `pixistry-debug` skill, so its surface must stay identical.

Verification (no automated coverage here — this is the manual gate): with the dev server running,
walk every tool once — paint, erase, each wall material, radiator, mixer drag, grabber drag, stirrer,
funnel place + wheel-rotate + edit + reset, tube draw + right-click finish + Escape cancel + knee
drag + segment drag + cone-size slider drag + species filter, plus pause/step/speed and pin/unpin
persistence across reload. The cone-slider drag and the pin persistence are the two behaviors most
likely to break silently, since both depend on subtleties in the current render path (the
`sidePanel.contains(document.activeElement)` guard, and `localStorage`).

---

## Explicitly out of scope

- **The chemistry data tables.** `species-data.ts` and `reactions.ts` are hand-picked physical
  constants; there is nothing to deduplicate there and the absence of an `AgCl + H2O` rule is load
  bearing (it *is* how insolubility is modeled).
- **The two runaway guards** and the pressure/mole-count model — see CLAUDE.md.
- **The 136 `as number` casts** forced by `noUncheckedIndexedAccess`. Typed accessors on `SimGrid`
  (`specAt`, `uAt`, `phaseAt`) would remove most of them, but it touches nearly every file in
  `src/sim` for readability alone. Worth doing eventually, as its own change, not mixed into any step
  above.

## Documentation drift found while reading (fix alongside step 4)

CLAUDE.md and ARCHITECTURE.md both describe `heat.ts`'s `stepGlassRadiators` running once per
heater-glass/cooler-glass **wall cell**, and `walls.ts` carrying a `radiatorWatts` field. Neither
exists: radiators are now a per-cell overlay (`grid.radiatorRadius` / `radiatorTargetK`) driven by
`stepRadiators`, and `walls.ts` has only glass/steel/insulator. `walls.ts`'s own header comment
already documents the replacement. The two top-level docs should be corrected so they stop
describing a design that was removed.
