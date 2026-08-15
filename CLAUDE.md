# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pixistry is a 2D falling-sand-style chemistry sandbox: a lab-bench sim where reactions come from a small
hand-authored `reactants -> products` table checked against neighboring cells each tick, classic
falling-sand-CA style. An earlier version tried to derive reactions from element-level physical rules
(valence, electronegativity, bond enthalpy via a graph-search engine) instead of a table — that approach
is documented for historical reference in [.grill/chem-ca-sim.md](.grill/chem-ca-sim.md), but it was
deleted after real usage showed it produced unpredictable products, temperature runaways, and pressure
weirdness. Don't resurrect it without addressing why it was replaced.

**Current status: built and running.** `src/sim/species-data.ts` (static species table) and
`src/sim/reactions.ts` (static reaction table) are the chemistry data; `src/sim` (grid/worker: movement,
energy/conduction/phase-change, tools, and reactions wired into the tick loop), `src/render` (WebGL
renderer), and `src/ui` (full tool set + inspector) round out a running app. See
[ARCHITECTURE.md](ARCHITECTURE.md) for the per-layer breakdown and its "What's next" section for what's
left (the deliberately-deferred list, plus optional prefab apparatus stamps).

There is no gas pressure model: an earlier version modeled gas cells with a mole count and derived
pressure via the ideal gas law (`grid.n`, `pressure.ts`, vessel bursting on wall-strength thresholds), but
it was ripped out as too complicated. The sim is just pixels of elements and compounds, each carrying a
temperature — that's it. Walls are indestructible now that nothing can burst them. Don't reintroduce
pressure/mole-count fields without discussing it first.

## Commands

```bash
npm install          # install deps
npm run typecheck     # tsc --noEmit
npm test               # vitest run -- the whole suite
npm run test:watch      # vitest watch mode
npm run dev               # vite dev server
npm run test:e2e           # playwright test -- the browser suite in e2e/
npm run test:e2e:ui         # playwright's interactive runner
```

First run of the browser suite on a new machine needs `npx playwright install chromium`.

Run a single test file: `npx vitest run src/sim/react.test.ts`
Run tests by name: `npx vitest run -t "NaCl"`

Start the dev server (via the Browser pane's `preview_start`, not Bash) at the beginning of a session and
leave it running in the background — including after a feature is complete — rather than stopping it once
the task is done.

Both `npm run typecheck` and `npm test` passing is the gate before any change lands.

## Git workflow

Once a feature or fix is complete (typecheck and tests passing, and the UI verified in the browser when the
change is UI-observable), commit it and push to `origin main` automatically — don't wait for the user to
separately ask for a push each time. This repo has no PR/branch workflow; commits go straight to `main`.
Still never force-push, never skip hooks, and still stop to ask before any other destructive or
history-rewriting git operation.

## Architecture: the static chemistry data

`src/sim/species-data.ts` exports `SPECIES: readonly SpeciesData[]` (34 plain-data entries: 15 pure
elements, 17 compounds, 2 aqueous dissolution products) and `SpeciesId`, a `{name: index}` map giving each
entry a stable numeric id. Every field — color, density, phase at STP, melting/boiling point, per-phase
specific heat and thermal conductivity, latent heats — is a hand-picked real physical constant. There is
no estimation, canonicalization, or interning: a reaction can only ever produce a species listed here,
which is the whole point (the old engine's actual failure mode was reactions landing on estimated-property
species with physically implausible values).

**Every species needs nonzero specific heat and thermal conductivity for every phase, even phases it never
normally occupies.** The four diatomic gases (H2, N2, O2, Cl2) originally had `0` for their solid/liquid
fields (since real chem estimation always backfilled *something* nonzero there, this repo's static table
has to do it explicitly) — that zero was a live division-by-zero hazard in `heat.ts`'s `temperatureOf`,
and it did in fact blow up to `Infinity`/`NaN` in practice. If you add a species, give it plausible
nonzero values for all three phases regardless of whether the sim is expected to ever reach them.

`src/sim/reactions.ts` exports `REACTIONS: readonly ReactionRule[]` — hand-authored `{reactants: [specA,
specB], products: [...], deltaH, minTempK?, probability}` rules — and `findReaction(specA, specB)`, an
order-independent lookup called once per adjacent cell pair in `react.ts`. `deltaH` is in kJ/mol
(negative = exothermic), scaled against reactant A's own nominal cell-parcel mass the same way `heat.ts`
scales everything else. `minTempK` is an optional ignition threshold; `probability` is a flat per-tick
chance once eligible. There's deliberately no rule for `AgCl + H2O` — see "The NaCl/AgCl dissolution
calibration point" below.

### Numerical stability: two runaway guards in `heat.ts`

`stepConduction`'s per-*pair* flux clamp (never move more energy than would equalize that one pair) isn't
enough on its own: a tiny-heat-capacity gas cell touching several neighbors at once can receive more total
flux in a single tick than its own capacity holds, and left unclamped that overshoot compounds tick over
tick into an exponential runaway — observed climbing to `Infinity`/`NaN` within a few hundred ticks of
aggressive fuzzing. `MAX_DELTA_T_PER_TICK` (2000K) caps a cell's own net temperature swing per tick to fix
this. Separately, `MAX_TEMP_K` (10000K, `clampEnergyToMaxTemp`) is an absolute ceiling used by both
`stepConduction` and `react.ts`'s `placeProducts`, because a cell that keeps getting freshly re-ignited by
new reactant drifting back in tick after tick has no per-tick rate limit otherwise — this was independently
observed climbing into the tens of millions of K over a real (non-adversarial) play session before the fix.
If you touch either conduction or reaction energy release, keep both guards or re-derive why they're
no longer needed — don't just delete them because a specific test passes without them; use a long
random-fuzz run (paint random species at random cells for thousands of ticks, assert every cell's `u` stays
finite and under `MAX_TEMP_K`) to check, since the runaway only shows up over many ticks, not immediately.

### Apparatus is derived state: the compositor is the only writer

`src/sim/entity-composite.ts` derives *all* apparatus grid state (glass wall cells belonging to a placed
funnel/tube/flask/glass polygon, `tubeMask`, the radiator fields, and `entityOwner` — which is also how a
filter membrane exists on the grid at all; there is no per-cell filter array) from the worker's single
`entities: AnyEntity[]` list in one pass, on every edit. An edit is "mutate the instance, then
recomposite" — `worker.ts`'s `mutateEntities`. Nothing else may write those arrays, and nothing
incrementally unstamps anything. That single rule replaced three coexisting bookkeeping schemes (a "put
back whatever went empty" repair pass, per-kind crossing rules in `unstampGlass`/`unstampFilter`/
`unstampRadiator`, and the tube's own mask restamping) whose cross-interactions were the source of
essentially every apparatus regression this project has had. A new apparatus feature goes through a
`Footprint`, never through direct grid writes. See [.grill/entity-overhaul.md](.grill/entity-overhaul.md)
for the multi-phase plan this is step one of, and check which phases are ticked before touching this area.

Two corollaries that are easy to undo by accident: apparatus is **indestructible** (the eraser takes
matter and painted terrain only; `deleteApparatus` is the sole way something leaves the bench), and
`stirrerMask`/`catalystStrength` are **painted terrain the compositor must never touch** — a stirred
flask is stirred because `stepStirrers` unions its interior in, not because it marked the grid.
`sinkMask` used to be on that list and no longer is: Sinks and Vents became entities in phase 6e, so
that array is compositor-derived like `tubeMask`, and anything writing it directly is a bug that a
recomposite will silently erase. If you promote another painted array to apparatus, move it out of this
rule in the same commit rather than quietly violating it.
Scenario setup must place real tracked instances for the same reason: an untracked one-shot stamp vanishes
on the first recomposite.

`entity-fuzz.test.ts` must stay in the suite and grow with every new entity kind or operation. When an
entity bug turns up in play, the fix lands together with a fuzz op or invariant that would have caught
it, not just a targeted unit test — that suite found a live `moveTubeSegment` hang on its first run.

### The NaCl/AgCl dissolution calibration point

`REACTIONS` has a rule for `NaCl + H2O -> Na+(aq) + Cl-(aq)` but no rule for `AgCl + H2O` at all — AgCl is
realistically insoluble, and the absence of a rule is literally how that's modeled (no graph search to get
subtly wrong). `react.test.ts` asserts both directions. If you add more ionic solids, decide solubility the
same way: either give it a dissolution rule, or don't.

### Testing conventions

Unit tests are colocated (`foo.ts` + `foo.test.ts`) under `src/sim`. `react.test.ts` is the closest thing
to a system-level suite: it exercises the reaction table end-to-end on the grid (dissolution firing, AgCl
not dissolving, ignition threshold gating, probability gating, energy bookkeeping).

`e2e/` is the browser suite (Playwright, `npm run test:e2e`) — the only tests that touch `src/ui` and
`src/render` at all, which is why UI regressions kept getting through. Two rules make it stable:

- **Act through the UI, assert through the grid.** Tests click the real tool rail and drag the real canvas,
  but check the result via `window.__pixistry` (`src/ui/debug-hook.ts`) — cell species, temperature, counts.
  Never screenshot-diff a falling-sand canvas. `e2e/bench.ts` holds every helper (`openSandbox`,
  `selectTool`, `dragCells`, `countCells`, `runTicks`); a test that reaches past it for a raw selector or a
  hand-rolled `page.evaluate` is how the suite starts rotting.
- **Never sleep.** `runTicks` resumes, waits for the tick counter, and pauses again; `settle` waits for the
  worker round-trip. A bench is paused by default (`waitForBench`), so tests are deterministic unless they
  ask for time to pass.

The debug hook is `import.meta.env.DEV`-gated, so the suite runs against the Vite dev server (Playwright
starts it itself) and never a production build — don't "fix" the hook by exposing it in prod.

Because it drives a real browser, `npm run test:e2e` is *not* part of the pre-commit gate (`npm run
typecheck` + `npm test` still are) — but run it before landing anything in `src/ui`, `src/render`, or
apparatus, and add a case there when a UI regression turns up in play, the same way an entity bug lands
with a fuzz op.
