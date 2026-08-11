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
energy/conduction/phase-change, tools, gas pressure and reactions wired into the tick loop, and vessel
bursting), `src/render` (WebGL renderer), and `src/ui` (full tool set + inspector) round out a running
app. See [ARCHITECTURE.md](ARCHITECTURE.md) for the per-layer breakdown and its "What's next" section for
what's left (the deliberately-deferred list, plus optional prefab apparatus stamps).

## Commands

```bash
npm install          # install deps
npm run typecheck     # tsc --noEmit
npm test               # vitest run -- the whole suite
npm run test:watch      # vitest watch mode
npm run dev               # vite dev server
```

Run a single test file: `npx vitest run src/sim/react.test.ts`
Run tests by name: `npx vitest run -t "NaCl"`

Both `npm run typecheck` and `npm test` passing is the gate before any change lands.

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

### The NaCl/AgCl dissolution calibration point

`REACTIONS` has a rule for `NaCl + H2O -> Na+(aq) + Cl-(aq)` but no rule for `AgCl + H2O` at all — AgCl is
realistically insoluble, and the absence of a rule is literally how that's modeled (no graph search to get
subtly wrong). `react.test.ts` asserts both directions. If you add more ionic solids, decide solubility the
same way: either give it a dissolution rule, or don't.

### Testing conventions

Unit tests are colocated (`foo.ts` + `foo.test.ts`) under `src/sim`. `react.test.ts` is the closest thing
to a system-level suite: it exercises the reaction table end-to-end on the grid (dissolution firing, AgCl
not dissolving, ignition threshold gating, probability gating, energy bookkeeping).
