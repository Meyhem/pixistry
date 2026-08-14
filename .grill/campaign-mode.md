# Campaign mode: sinks, scenarios, and making Pixistry a game

Design + implementation plan. Status: **proposal, nothing built yet.**

Audience note that drives most of the design decisions below: this is aimed at school kids and at
autistic kids — players who want a tight, legible feedback loop ("number goes up, thing I made is
*mine*") and who are actively harmed by frustration walls, surprise flashing/sound, and ambiguous
objectives. Every mechanic here is judged against that.

---

## 1. What the player sees

```
main.ts
  └─ menu.ts            TITLE: [ Sandbox ]  [ Campaign ]  [ Cabinet ]  [ Comfort settings ]
       ├─ Sandbox  ──►  mountApp(root, { mode: 'sandbox' })              (today's app, + Sink tool)
       └─ Campaign ──►  scenario-select.ts (cards, stars, locks)
                          └─► mountApp(root, { mode: 'campaign', scenarioId })
```

In campaign mode the app is the same sim + canvas, plus:

- a **briefing card** on entry (what you're making, the reaction you'll need, what gear you get),
- an **objective HUD** with live progress bars,
- **locked** toolbar entries (greyed with a padlock + "not in this experiment"),
- **Run Test** / **Reset experiment** buttons,
- a **win overlay** with the equation, a real-world fact, and 1–3 stars.

---

## 2. The Sink (core new mechanic)

A sink is a drawn line that eats any matter touching it and counts it. One global counter for all
sinks, per species — exactly as specified. It is useful in sandbox on its own (drain + tally), so
**Phase 1 ships standalone before any campaign code exists.**

### Sim side

- `SimGrid.sinkMask: Uint8Array` — same "fixed background field, not matter" convention as
  `filterMask` / `stirrerMask` / `tubeMask` (see `grid.ts`): untouched by `set`/`clear`/`swap`,
  cleared by the eraser alongside the other masks.
- New `src/sim/sink.ts`:
  - `SinkCounter` — `totals: Uint32Array(SPECIES.length)`, `grandTotal`, plus a ring buffer of
    per-second snapshots (`{ tick, totals }` every 60 ticks, last 120 entries ≈ 2 minutes) so
    throughput goals can be evaluated without the main thread seeing every frame.
  - `stepSinks(grid, counter)` — scan `sinkMask`; for every non-empty, **non-wall** cell on a sink
    cell: `counter.totals[specId]++`, `grid.clearAt(idx)`. Walls and overlays are never consumed.
  - `SINK_LABEL` / `SINK_COLOR` display constants, mirroring `filter-apparatus.ts`.
- **Tick order**: `stepSinks` runs **last** in `runOneTick`, after `stepReactions` (decided). A
  reactant pair that lands on a sink cell therefore gets one tick to react there, and the *product*
  is what gets counted — the sink is a collection port, not a drain that intercepts feedstock on
  arrival. (The rejected alternative was running it right after `stepMovement`/`stepTubes`, which
  is simpler to explain but means a sink placed at a reaction site swallows the reagents before
  they can combine.)
- Reset: `resetSinkCounts` message; also reset by scenario load and by Run Test.

### Drawing it

The user wants a straight line, and every existing painting tool is a brush. Implement it as a
**click-drag line**: pointerdown anchors, drag shows a ghost on the existing `apparatusPreview`
2D canvas (same pattern the tube tool already uses for its polyline ghost), pointerup commits
`paintSinkLine { x0, y0, x1, y1, width }` — Bresenham in the worker. Free-form brush painting is
*not* offered; a sink that's a squiggle makes "how much did I collect" feel arbitrary.

### Wire + render

- Frame gains `sinkMask: Uint8Array`, `sinkTotals: Uint32Array`, `sinkRatePerSec: Float32Array`
  (all cheap; ~120 entries each for the totals).
- Renderer tints sink cells like `filterMask` does (`tintTowards`, distinct color — magenta reads
  as "consumes" against the existing green filter / blue tube).
- Side panel for the Sink tool shows the live tally as a colored chip list (reuse
  `species-chip-list.ts`) — in sandbox this alone is a fun toy ("I made 412 pixels of water").

### Tests

`sink.test.ts`: consumes and counts a falling cell; ignores walls; ignores empties; counts across
multiple sinks into one counter; per-second history advances; reset clears.

---

## 3. Scenarios

### Data, not code

`src/sim/scenario-data.ts` — plain hand-authored data, same philosophy as `species-data.ts` /
`reactions.ts`. Authoring a level is data entry, not engine work.

```ts
interface Scenario {
  id: string;                 // 'salt-01'
  title: string;              // 'Table Salt'
  blurb: string;              // kid-facing one-liner
  briefing: string[];         // 2-4 short lines shown on entry
  hints: string[];            // progressive, 3 levels, last is near-solution
  fact: string;               // shown on win ("this is how it's really made")
  setup: SetupCommand[];      // stamps the starting bench
  rules: Restrictions;        // what the player may use
  goals: Goal[];
  par?: { seconds?: number; reagentPixels?: number };  // star thresholds
}

type SetupCommand =
  | { kind: 'rect';     x, y, w, h: number; specId: number; tempC?: number }
  | { kind: 'wallRect' | 'wallLine'; ... }
  | { kind: 'flask';    x, y: number; facing: FlaskFacing; sizeScale: number; stirred: boolean }
  | { kind: 'funnel';   x, y: number; facing: FunnelFacing; specId: number; ratePerMinute: number;
                        total: number | null; enabled: boolean }
  | { kind: 'radiator'; x, y, radius: number; targetTempC: number }
  | { kind: 'sink';     x0, y0, x1, y1: number };

interface Restrictions {
  paintSpecies: number[] | 'all' | 'none';   // 'none' = no manual spawning at all
  tools: ToolKind[] | 'all';
  funnelSpecies: number[] | 'none';          // which reagents a funnel may be set to
  reagentBudget?: Record<number, number>;    // px of each species the player may spend
}

type Goal =
  | { kind: 'collect'; specId: number; amount: number }
  | { kind: 'collectAny'; specIds: number[]; amount: number }
  | { kind: 'rate'; specId: number; perSecond: number; sustainSeconds: number }
  | { kind: 'purity'; specId: number; minFraction: number }        // of everything sunk
  | { kind: 'limit'; specId: number; max: number }                 // fail if exceeded
  | { kind: 'maxTempK'; limitK: number };                          // don't melt the bench
```

`purity` and `limit` are what stop "shove everything into the sink" from being a winning strategy,
and they teach waste/selectivity for free.

### Engine

- `src/sim/scenario.ts` — `applyScenarioSetup(grid, species, funnels, tubes, scenario)`, built out
  of the primitives that already exist (`stampGlass`, `flaskShapeFor`, `placeFunnelInstance`,
  `energyForTemperature`). No new physics.
- `src/sim/objectives.ts` — **pure**: `evaluateGoals(goals, snapshot) → GoalProgress[]` where
  `snapshot = { totals, history, tick, maxTempK, reagentSpent }`. Pure means unit-testable without
  a grid, which is what keeps level authoring honest.
- **Restrictions are enforced in the worker**, not just hidden in the UI: `paint`, `placeFunnel`,
  `updateFunnel`, `placeTube` etc. drop messages that violate the active `Restrictions`. Otherwise
  every scenario is one devtools call away from being trivially beaten, and (more practically) a
  UI bug can't silently let a kid "win" a level they didn't solve.
- Worker gains `loadScenario { scenario }`, `resetWorld`, and posts `objectives: GoalProgress[]`
  in each frame. Evaluation lives worker-side because fast-forward bursts emit no frames and
  because sustained-rate goals need per-tick fidelity.

### An automated "is this level even possible" test

`scenario.test.ts` does a BFS over `REACTIONS` starting from each scenario's allowed
paint/funnel species plus whatever `setup` stamps, and asserts every goal's target species is
reachable. This catches authored-by-hand impossible levels at CI time — cheap, and exactly the
kind of check this repo's static tables make easy.

---

## 4. Run Test (fast-forward)

Continuous-process scenarios need "build the apparatus, then let it run and see if it holds up".

- New worker message `runBurst { ticks }` — runs N ticks **without posting frames**, in chunks
  (~200 ticks per macrotask) so a `cancelBurst` message can still land, posting a lightweight
  `burstProgress { tick, objectives }` every chunk. 30 s of sim = 1800 ticks; at 160×100 this
  should land in the low seconds — measure before committing to the number.
- Before the burst: **snapshot the world** (copy every typed array + clone the funnel/tube instance
  lists — ~200 KB total) and reset sink counters. After: report pass/fail, and offer
  **Rewind** (restore the snapshot) so a failed run costs nothing. This snapshot/restore also gives
  "Reset experiment" for free and is worth having regardless of campaign mode.
- Raising `MAX_SPEED` above 4x is *not* a substitute — it's still frame-bound and can't be cancelled
  or rewound.

---

## 5. Mode shell + persistence

- `mountApp(root, opts)` gains `{ mode, scenarioId }` and returns an `unmount()` that terminates
  the worker and removes listeners — today it assumes it owns the page forever.
- `src/ui/menu.ts`, `src/ui/scenario-select.ts` — plain DOM, same as the rest of `src/ui`.
- `src/ui/campaign-progress.ts` — `localStorage` (`pixistry.progress`): completed ids, stars, best
  times, discovered species, achievement flags. Same defensive try/catch as `loadPinnedLabels`.

---

## 6. Making it actually fun

Ranked by (dopamine delivered) ÷ (effort), most of it reusing data that already exists.

**Feedback loop — build these with the first scenario, not after**

1. **Progress bar filled with the product's own color**, with the count ticking up. This *is* the
   game. Everything else is decoration.
2. **Sink sparkle** — consumed pixels flash before vanishing, on the existing 2D overlay canvas.
   Makes the sink feel like it's eating, not like pixels are falling through a hole.
3. **Milestone chimes** at 25/50/75/100 % — tiny WebAudio synth blips, zero assets.
4. **Win overlay**: the balanced equation of what they made + a one-line real fact + stars.
5. **Comfort settings** (menu + in-game): *quiet mode* (mute), *reduce motion* (no flash/shake),
   *high contrast*, *bigger UI*. For this audience this is not a nice-to-have; ship it with the
   first juice pass, defaulting to the calm end.

**Meta-progression — the strongest retention lever here**

6. **The Cabinet**: every species the player has ever created gets a collectible card (formula,
   swatch, melting/boiling point, a real-world fact, "first made in: <scenario>"). The species
   table already has 100+ entries with real constants — this turns the existing data into
   collectibles for near-zero cost, works in sandbox too, and gives free-play a point.
7. **Achievements**: "First Precipitate", "White Smoke", "Zero Waste (100 % purity)", "Thermal
   Runaway Survivor", "Made it rain".
8. **Three stars per scenario**: completed / under par time / efficiency (reagent spent or purity).

**Teaching layer, auto-generated from existing tables**

9. **Recipe book** — search "what makes NaCl(aq)?" and get every rule in `REACTIONS` that produces
   it, with its ignition temperature and whether water is needed. Generated from data; fully open
   in sandbox, discovery-gated in campaign.
10. **Inspector "reacts with…"** — hovering a species lists its partners, same derivation.
11. **Progressive hints** (3 levels, third near-solution). Non-negotiable for this audience: being
    stuck with no path forward is where kids quit.

**New sim toys that unlock scenario variety** (each is small; all optional)

12. **Vent** — a second sink kind that counts toward *fail* metrics instead of goals. Same code,
    different color. Instantly enables "don't gas the room" objectives (Cu + HNO₃ → NO₂).
13. **Thermometer gauge** — a placeable read-only probe with a target band; lets scenarios say
    "hold the reactor at 400–600 K". Reuses the radiator overlay pattern.
14. **Pulsed funnel** — `onTicks`/`offTicks` on `FunnelInstance`, ~10 lines. Unlocks batch and
    oscillating processes.
15. **Valve** — a wall cell that can be toggled open/closed. Bigger design space (player-built
    automation), moderate effort.
16. **Catalyst pad** — an overlay that multiplies `probability` in `react.ts` for cells inside it.
    No new species, no new energy path, and it makes the Haber process (`probability: 0.1`,
    `minTempK: 700`) go from tedious to satisfying. Teaches catalysis, one of the deliberately
    deferred items, at genuinely low cost.

Explicitly **not** proposed: any gas pressure / mole-count model. `CLAUDE.md` rules it out and none
of the above needs it.

---

## 7. Scenario ladder

Every entry below maps to rules that already exist in `reactions.ts`.

**Tier 1 — one reaction, generous**

| # | Title | Chemistry | Goal | Teaches |
|---|---|---|---|---|
| 1 | Table Salt | Na + Cl₂ → NaCl | collect 100 NaCl | the sink, the loop |
| 2 | Rust Never Sleeps | Fe + O₂ → Fe₂O₃ (≥400 K) | collect 80 | radiators / ignition temp |
| 3 | Make Water | H₂ + O₂ → H₂O (≥500 K) | collect 100, max temp limit | exotherms bite back |
| 4 | Dissolve It | NaCl + H₂O → NaCl(aq) | collect 80 aq | phases, aqueous |
| 5 | The One That Won't Dissolve | NaCl vs AgCl in water | 60 NaCl(aq), 0 AgCl collected | solubility; uses the Filter |

**Tier 2 — two-step chains**

| # | Title | Chemistry | Goal | Teaches |
|---|---|---|---|---|
| 6 | Limewater Test | CaO + H₂O → Ca(OH)₂(aq); + CO₂ → CaCO₃ | 60 CaCO₃ | staged plumbing |
| 7 | Hydrogen Factory | HCl(aq) + Zn → ZnCl₂(aq) + H₂ | 150 H₂ | gases rise — put the sink on top |
| 8 | White Smoke | NH₃ + HCl → NH₄Cl | 60 NH₄Cl | two gases → a solid |
| 9 | Photo Paper | AgNO₃(aq) + NaCl(aq) → AgCl↓ | 50 AgCl, purity ≥ 90 % | precipitation + filtration |
| 10 | Acid Rain | SO₂ + H₂O → H₂SO₃(aq) | 80 collected | gas dissolution |

**Tier 3 — continuous process, rate goals, no manual spawning**

| # | Title | Goal | Teaches |
|---|---|---|---|
| 11 | Salt Line | sustain 10 NaCl/s for 30 s, funnels only | throughput, feed balance |
| 12 | Contact Process | sustain 8 H₂SO₄(aq)/s | multi-stage continuous plant |
| 13 | Haber Plant | 100 NH₃, ≥700 K held | heat + mixing + patience (catalyst pad shines) |
| 14 | Copper Etch | 60 Cu(NO₃)₂(aq), **vent ≤ 30 NO₂** | selectivity, waste handling |
| 15 | Recycling Loop | produce 100 X spending ≤ 150 reagent | efficiency, closed loops |

**Tier 4 — freeplay challenges**

16. Thermal puzzle: freeze one chamber and boil another on a single radiator budget.
17. Rube Goldberg: deliver one pixel from A to B in under 20 s using only tubes.
18. **Daily challenge**: pick a random reachable compound (BFS over `REACTIONS` — the same code the
    solvability test uses) and ask for 50 of it. Infinite content, almost no authoring cost.

---

## 8. Build order

Each phase is independently shippable and leaves `main` working.

| Phase | Contents | Notes |
|---|---|---|
| **0** ✅ | `resetWorld`, world snapshot/restore, `mountApp` teardown | done -- `grid.clearAll`, `world-snapshot.ts`, Save/Restore/Clear All buttons in sandbox, `mountApp` returns `unmount()` (unused by main.ts until Phase 2's menu needs it) |
| **1** ✅ | **Sink tool** end to end (mask, `stepSinks`, line-draw UI, tally panel, renderer, tests) | done -- shipped to sandbox alone |
| **2** ✅ | Menu + mode shell + progress persistence | done -- `menu.ts`, `scenario-select.ts` (empty-state until Phase 3), `campaign-progress.ts` (localStorage), `mountApp` gains `{mode, scenarioId, onExitToMenu}` + a header Menu button, `main.ts` routes Menu ↔ Sandbox ↔ Campaign |
| **3** ✅ | `scenario-data.ts`, `scenario.ts`, `objectives.ts`, worker restrictions, solvability test | done -- 3 scenarios (`table-salt`, `dissolve-it`, `hydrogen-factory` = ladder #1/#4/#7), `applyScenarioSetup` handles `rect`/`wallRect` (more `SetupCommand` kinds added when a scenario needs one), worker gains `loadScenario` + gates paint/tool/funnel-species messages against `Restrictions`, posts live `objectives: GoalProgress[]` in every frame (`rate` goals wired correctly but worker doesn't yet feed real per-second history -- no scenario needs one yet), BFS solvability test in `scenario.test.ts` |
| **4** ✅ | Campaign UI: briefing, HUD progress bars, locked tools, hints, win + stars | done -- `campaign-hud.ts` (briefing modal, live objective HUD w/ progress bars, progressive hints, win overlay), `objective-display.ts` (pure `GoalProgress[]` -> HUD rows + `isScenarioWon`), `campaign-progress.ts` gains `recordCompletion`/`starsForCompletion`, `toolbar.ts` greys+padlocks any tool/wall a scenario's `Restrictions` forbid (native `<option disabled>` for dropdown entries), `app.ts` wires `loadScenarioInto` (mount/Replay/Next all go through it), `main.ts`'s scenario-select is real (`SCENARIOS` + saved stars, all unlocked). First playable slice: menu → pick a scenario → briefing → locked bench → play → win overlay with stars, persisted. Fixed two bugs found in verification: `isScenarioWon` was vacuously true on an empty (not-yet-loaded) objectives array, and a long-latent `fitCanvasWrap`/`ResizeObserver` feedback loop (`.canvas-wrap` was missing `box-sizing: border-box`, so every resize overshot by its own border width and compounded) that the HUD's per-frame rebuild made easy to trigger |
| **5** ✅ | Run Test (`runBurst`, progress, cancel, rewind) | done -- `sink.ts` gained a real per-second `history` ring buffer (`recordSinkHistory`, 60-tick interval/120-entry cap) so 'rate' goals evaluate against actual data instead of worker.ts's old hardcoded `[]`; `worldSnapshot`/`SinkCounter` snapshot/restore round-trips it too. `worker.ts` gained `runBurst`/`cancelBurst` (protocol.ts) + `burstProgress` (posted every `BURST_CHUNK_TICKS`=200-tick chunk instead of every tick, so `cancelBurst` can land between chunks): `runBurst` auto-snapshots the world into the *same* slot manual Save uses and resets the sink counters (so a test scores only what it itself produces), runs chunks via a `setTimeout` chain, ignores every message but `cancelBurst` while in flight, and resumes normal per-tick frames once done -- `cancelBurst` unwinds straight back to that pre-burst snapshot, same as a bad result. "Rewind" in the campaign HUD is literally the existing `restoreWorld` message, not a new one. `app.ts`'s win check (`checkForWin`) is now shared between the 'frame' and 'burstProgress' handlers, so a continuous-process scenario can be won by a Run Test alone, not just by watching it live. Fixed one bug found in verification: `cancelBurst` originally never told the main thread the burst had ended, so a cancelled test left the canvas permanently dimmed and inert (`.canvas-wrap.bursting` never cleared) -- fixed by having `cancelBurst` post a final `burstProgress` (`ticksRemaining: 0`) the same way a completed burst does. Run Test's fast-forward length is a fixed 1800 ticks (30 sim-seconds) for now, matching this doc's own example figure; burst performance on the 160x100 grid is comfortably sub-second, not the "low seconds" this doc worried about. `debug-hook.ts` gained a raw `send()` escape hatch (documented in the `pixistry-debug` skill) for messages with no dedicated wrapper, used to test `cancelBurst` racing mid-chunk. |
| **6** ✅ | Juice + meta: sparkle, chimes, comfort settings, Cabinet, achievements, recipe book | done -- `comfort-settings.ts` (localStorage `ComfortSettings` -- quiet/reduceMotion/highContrast/bigUI -- applied as `document.body` classes) + `comfort-screen.ts`, reachable from the title menu and an in-game ⚙ button in `app.ts`'s header. `sound.ts` (lazy `AudioContext`, zero-asset sine-wave blips) drives both milestone chimes (25/50/75/100% per goal, pitch climbing with each threshold, gated to the four "progress-towards-done" goal kinds -- a `limit`/`maxTempK` ceiling goal's fraction means "how close to failing", not something to chime on) and a win chime. Sink sparkle is a second always-present 2D overlay canvas (`sink-sparkle`, sized/positioned exactly like the existing `apparatus-preview` ghost canvas): the `'frame'` handler diffs `sinkTotals` against the previous frame, and any species whose count grew gets a handful of dots flashed along the sink line in that species' own color, faded out by a CSS `@keyframes` animation re-triggered via remove+reflow+add -- a no-op under Reduce Motion. `campaign-progress.ts` gained `discoverySourceByLabel` (backward-compat merged in on load for records saved before it existed) plus `recordDiscovery`/`unlockAchievement` pure folds; `checkForWin` was changed to fold onto the session's shared in-memory `progress` variable instead of calling `loadProgress()` fresh, so a win can no longer clobber a discovery/achievement the same tick's scan already wrote. A single `scanFrameMeta` (`frame-meta.ts`) walks the grid once per frame to drive both species discovery (Cabinet) and achievement checks, rather than two separate full-grid passes. `achievements.ts` picks concrete, honestly-detectable triggers for the design doc's 5 named achievements: First Precipitate/White Smoke key off a fixed label set/name check against `presentSpecIds`, Thermal Runaway Survivor off the frame's own max temperature (≥2000 K), Made It Rain off a live liquid-H2O cell count (≥150), Zero Waste off any `purity` goal's `currentFraction` hitting ~100% -- none of the 3 shipped scenarios has a purity goal yet, so that last one is wired but only exercisable once Phase 7 adds one. Cabinet (`cabinet.ts`) and Recipe Book (`recipe-book.ts`) are menu-level screens (`main.ts` routes to them, reading `SPECIES`/`REACTIONS`/`campaign-progress.ts` directly, no live grid needed) rather than in-game panels. All verified live in the browser: painting/discovering species, a precipitation + white-smoke reaction, an overheated cell, and a large water body each unlocked their achievement and showed up on a Cabinet card with the correct "first made in" scenario/Sandbox attribution; a full Table Salt playthrough produced milestone/win chimes with no console errors and recorded stars/best-time without disturbing the achievements/discoveries already written that session. Deliberate scope cuts: Recipe Book is sandbox-style "fully open" everywhere for now, not yet wired into an in-game, discovery-gated variant for campaign mode (design doc's own §6 point 9 distinction) -- a reasonable Phase 7 follow-up once there's discovery-gated content worth hiding. Inspector "reacts with" (point 10) is covered by Recipe Book's own reverse-lookup section rather than a separate hover-tooltip feature. |
| **7** ✅ | Content: author scenarios 4–18, playtest each | done -- 10 new scenarios shipped (`wont-dissolve`=#5, `limewater-test`=#6, `white-smoke`=#8, `photo-paper`=#9, `acid-rain`=#10, `salt-line`=#11, `contact-process`=#12, `haber-plant`=#13, `copper-etch`=#14, `rube-goldberg`=#17), bringing the campaign to 13 scenarios total. Every one was won live in the browser via the `pixistry-debug` hook (paint/burst/dumpGrid), not just typechecked. Engine gained the `SetupCommand` kinds `wallLine`/`flask`/`funnel`/`radiator`/`sink` (`scenario-data.ts`/`scenario.ts`), each a thin wrapper around an existing placement primitive (`sinkLineCells`, `stampGlass`+`flaskShapeFor`, `placeFunnelInstance`, `forEachCellInRadius`), plus `applyScenarioSetup` grew a `funnels: FunnelInstance[]` parameter so a scenario can pre-place an already-dripping funnel. Skips #15 (Recycling Loop -- needs `reagentBudget` enforcement, currently typed but unenforced, see Decision 4) and #16 (Thermal puzzle -- needs a temperature-floor/range `Goal` kind that doesn't exist); #18 (Daily challenge) is a random-scenario generator + new menu mode, not static content, and is deferred alongside them. See Decision 8 for the full list.<br><br>**Playtesting surfaced five real engine behaviors that repeatedly broke naive scenario designs, each now documented inline at its scenario:** (1) **gas always rises** (`movement.ts`'s `moveRising`) -- a `'down'`-facing funnel dripping a gas from above a pool just rises straight back to the ceiling without ever touching the liquid; fixed per-scenario by either flipping the funnel to `'up'`-facing and anchoring it low, or (for player-painted gas) sealing the container with zero headspace so the gas has nowhere to rise to and stays pinned in contact with the liquid. (2) **a sink placed inside a pool drains bulk reagent, not just product** -- `stepSinks` consumes whatever's on a sink cell regardless of whether it's "product" or unreacted raw material sitting there from world-setup, which both wrecked `rate` goals (reagent exhausted before a sustained window could complete) and `purity` goals (diluted by consumed bulk water); `rate` goals were downgraded to `collect` on `salt-line`/`contact-process` once repeated redesigns confirmed a steady per-second rate isn't reliably achievable this way, and `purity` was dropped entirely from `photo-paper`/`copper-etch` once it became clear even a Filter-protected empty buffer zone floods with bulk liquid before it can stay usefully empty (liquids fill all connected empty space almost immediately -- see Decision 9). (3) **`react.ts`'s `tryReact` needs an empty neighbor cell for any reaction with more products than reactants** (`findEmptyNeighbor`, an 8-cell local search) -- `copper-etch`'s 3-product `Cu + HNO3(aq) -> Cu(NO3)2(aq) + NO2 + H2O` reaction flatlined at 0 production in a solid-packed pool since no reacting pair ever had a free neighbor; fixed by using a narrow acid column with open tank space on both sides instead of one wall-to-wall pool, plus scoping the goal amount down to what's actually achievable (15, not the ladder's 60) and framing the hint around repeated topping-up rather than one paint-and-wait. (4) **a single oversized `'radiator'` `SetupCommand` is a real perf hazard** -- `radius` doubles as both the painted brush area and each resulting cell's own individual radiation reach, so one `radius: 45` command covering a whole chamber turned ~6000 cells into independent 45-cell-reach sources re-radiating every tick, cratering the tick rate to a crawl; fixed on `haber-plant` by using several small radiators spread through the chamber instead, matching how the interactive tool is actually used. (5) **the raw `send()` debug escape hatch has zero input validation, and `tube-shapes.ts`'s `polylineToLumenPath` assumes its input points are already octant-snapped** -- sending an arbitrary (non-45°-multiple) two-point tube path froze the whole page; the real UI always snaps drag input to an octant first, so this is a devtools-only footgun, not reachable through normal play, but worth remembering for future raw-`send()` testing (build tube paths from purely horizontal/vertical/45° segments). |
| **8** | Optional toys: vent, thermometer, pulsed funnel, catalyst pad, valve | as scenarios demand |

**Recommended first cut: phases 0 → 4 with scenarios 1, 4 and 7.** That's a real vertical slice —
menu, a locked bench, a sink, live progress, a win screen — and scenario 7 (H₂ rising) already
proves the design is teaching something rather than just counting.

## 9. Decisions

1. **Sink tick position** — *decided:* last in the tick, after `stepReactions` (see §2).
2. **Build order** — *decided:* Phase 1 (Sink tool, sandbox-only) first, standalone.
3. **Name** — *decided:* keep "Sink".
4. **Reagent budgets** — deferred past the first cut.
5. **Burst length/perf** — *decided:* fixed 1800 ticks (30 sim-seconds), matching this doc's own
   §4 example. Measured in Phase 5's verification: comfortably sub-second on the 160x100 grid at
   `BURST_CHUNK_TICKS`=200, not the "low seconds" originally worried about. Not yet
   scenario-configurable -- would become so if a future Tier 3 level's sustain window needs more
   runway than 30s.

6. **Achievement triggers** -- *decided:* each of the 5 named achievements gets the most
   concrete, honestly-detectable signal available from data the sim already exposes (species
   discovered, live max temperature, live water count, goal purity) rather than new sim
   instrumentation -- see Phase 6's build-order note for the exact mapping. Zero Waste is wired
   but unexercisable until a scenario with a `purity` goal ships (Phase 7).
7. **Recipe Book scope** -- *decided:* one menu-level screen, fully open (both "how to make X"
   and "what X reacts with" in one search), not discovery-gated and not wired into an in-game
   panel for this pass -- see Phase 6's build-order note.
8. **Phase 7 ladder gaps (#15/#16/#18)** -- *decided:* skip all three for now rather than force
   them. #15 Recycling Loop needs `reagentBudget` enforcement (typed in `Restrictions` since
   Phase 3, never enforced -- Decision 4) to be a real constraint rather than trivially bypassable;
   #16 Thermal puzzle needs a temperature-floor/range `Goal` kind that doesn't exist (today's
   `maxTempK` is a ceiling only); #18 Daily challenge is a random-scenario generator + new menu
   entry (deterministic per-day seeding, BFS-picked target), not static data like every other
   scenario, and is meaningfully more engineering than "author content." All three are natural
   Phase 8-adjacent follow-ups, not blockers for anything currently shipped.
9. **`rate` and `purity` goals are much harder to hit reliably than `collect`** -- *decided,
   the hard way:* extensive playtesting (see Phase 7's build-order note) found that a sink
   inevitably drains whatever bulk reagent it's sitting in/near, not just the product it's
   meant to catch, which both starves sustained-rate goals of reactant before a 30s window
   completes and dilutes purity goals with consumed bulk liquid -- even a Filter-protected
   "empty" buffer zone floods with liquid within ~10 sim-seconds since liquids fill all
   connected empty space almost immediately, faster than any script or player can react.
   `salt-line`/`contact-process` were downgraded from `rate` to `collect`; `photo-paper`/
   `copper-etch` had their `purity` goal dropped entirely. Future scenarios wanting a
   sustained-rate or high-purity feel should design around this rather than assume it just
   works -- e.g. a genuinely inexhaustible feed (funnel, not a fixed pool) paired with a sink
   that can't reach un-reacted reagent by construction (narrow gated channel, not open pool).

Still open: nothing blocking Phase 8.
