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
| **3** | `scenario-data.ts`, `scenario.ts`, `objectives.ts`, worker restrictions, solvability test | 3 scenarios only |
| **4** | Campaign UI: briefing, HUD progress bars, locked tools, hints, win + stars | first playable slice ends here |
| **5** | Run Test (`runBurst`, progress, cancel, rewind) | unlocks Tier 3 |
| **6** | Juice + meta: sparkle, chimes, comfort settings, Cabinet, achievements, recipe book | |
| **7** | Content: author scenarios 4–18, playtest each | |
| **8** | Optional toys: vent, thermometer, pulsed funnel, catalyst pad, valve | as scenarios demand |

**Recommended first cut: phases 0 → 4 with scenarios 1, 4 and 7.** That's a real vertical slice —
menu, a locked bench, a sink, live progress, a win screen — and scenario 7 (H₂ rising) already
proves the design is teaching something rather than just counting.

## 9. Decisions

1. **Sink tick position** — *decided:* last in the tick, after `stepReactions` (see §2).
2. **Build order** — *decided:* Phase 1 (Sink tool, sandbox-only) first, standalone.
3. **Name** — *decided:* keep "Sink".
4. **Reagent budgets** — deferred past the first cut.

Still open: **burst length/perf** needs a real measurement before Tier 3 scenarios are authored
around it.
