# Architecture

This document describes how the codebase is built, as opposed to why — the design rationale and every
resolved trade-off lives in [.grill/chem-ca-sim.md](.grill/chem-ca-sim.md). Read that first if you're
asking "why not just hardcode X"; the answer is almost always already there. This document assumes you've
read it and want to know where things live and how they fit together.

## Layers

The project is planned as four layers, built in that order (see the doc's "Build order").

| Layer | Directory | Status | Depends on |
|---|---|---|---|
| Chemistry core | `src/chem` | **Built (M1)** | nothing (zero runtime deps) |
| Simulation grid/worker | `src/sim` | **Built (M2 grid/movement, M3 energy, M4 tools)** | `src/chem` |
| Renderer | `src/render` | **Built (M2)** | `src/sim` |
| UI | `src/ui` | **Built (M2 palette/brush, M4 full tool set + inspector)** | `src/sim`, `src/render` |

The chemistry core is deliberately headless and side-effect-free so it can run inside a Web Worker
untouched — it never imports anything from the other three layers, and nothing in it knows about frames,
cells, or a grid.

## `src/chem`: the chemistry core

### Data model

- **`Element`** (`elements.ts`) — static per-element constants: molar mass, electronegativity, covalent/
  ionic radius, standard valences, common ion charges, atomization enthalpy. 15 elements in v1.
- **`MoleculeGraph`** (`types.ts`) — the universal currency: `{ atoms: Atom[], bonds: Bond[] }`. An `Atom`
  carries a local id, element, and formal charge. A `Bond` carries an order: `0` means "ionic contact"
  (not a shared-electron bond, routes to lattice-energy treatment), `1-3` means covalent single/double/
  triple. Nothing else in the system (grid cells, reactants, products) is anything other than a
  `MoleculeGraph` plus, once interned, a computed `MoleculeProperties`.
- **`MoleculeSpec`** (`types.ts`) — a `MoleculeGraph` plus its canonical key, a `specId`, and its computed
  `MoleculeProperties`. Only `InternedPool` produces these.
- **`ReactionCandidate` / `ReactionOutcome`** — what `partition-search.ts` and `reaction.ts` return: a set
  of product graphs plus ΔH/ΔS/ΔG/bonds-broken, and (outcome) the derived Ea/probability and whether it
  fired.

### Module responsibilities

- **`canonical.ts`** — turns a `MoleculeGraph` into a canonical string key, via iterative
  Weisfeiler-Leman-style atom-invariant refinement followed by a canonical DFS traversal (brute-forced
  over every atom as a candidate root — cheap at ≤~12 atoms). This key is what makes two differently-
  labeled graphs of the same molecule collapse to one interned species. It assumes acyclic-ish graphs,
  consistent with v1 having no rings.
- **`bonds.ts`** — the only place that knows what bonds are *legal*: `bondCategory` (ionic vs. covalent
  vs. illegal-metal-metal), `canFormBondOrder`, the curated bond-dissociation-energy table with a
  Pauling-style fallback for untabulated pairs, and the VSEPR-lite geometry helpers used for dipole
  estimation.
- **`properties.ts` + `overrides.ts`** — `computeProperties(graph)` is a pure function producing every
  physical property from bond-additivity/structural estimates, then `overrides.ts` lets curated measured
  values win per-field. This is the only place ΔHf, S°, dipole, bp/mp, and density get computed; nothing
  else re-derives them.
- **`intern.ts`** — `InternedPool`: canonicalizes, dedups by canonical key, computes properties once per
  distinct species, assigns a stable `specId`. This is the only stateful class in `src/chem`.
- **`partition-search.ts`** — the algorithmic core; see the walkthrough below. Also owns its own
  `(reactantKeys, tempBucket) -> ReactionCandidate` memoization cache, module-scoped.
- **`kinetics.ts`** — two pure functions: `evansPolanyiEa` and `reactionProbability`. Deliberately not
  merged into the partition-search cache (see "Two-tier caching" below).
- **`dissolution.ts`** — the separate ionic-solid-to-aqueous-ions pathway; see below.
- **`reaction.ts`** — orchestration: decides whether a pair routes to dissolution or general
  partition-search, and (in the `attempt*` variants) fires probabilistically via an injected `rng` and
  interns the results into the caller's `InternedPool`.
- **`index.ts`** — the curated public surface. Future consumers (the M2 worker) should only import from
  here, not reach into individual modules.

### Algorithm walkthrough: `findBestPartition`

Given reactants A and (optionally) B and a temperature T:

1. **Combine.** A's and B's atoms are merged into one pool, with B's local atom ids offset so every atom
   keeps a globally-unique, stable id through the whole search — this is what lets the bonds-broken
   calculation later compare specific atom pairs against the original bonds, regardless of how the atoms
   get regrouped.
2. **Shape generation.** The combined atom multiset is partitioned by *per-element count* (not
   individual atom identity) into up to 3 groups, via a bounded stars-and-bars recursion. Shapes are
   pruned before any bonding work: heavy-atom cap (6), carbon cap (2), and a necessary-but-not-sufficient
   valence-feasibility check (can this many atoms even form a connected structure).
3. **Per-group bonding.** `enumerateBondGraphs` splits into two entirely different constructors depending
   on composition:
   - **Covalent** (all-nonmetal groups): a backtracking DFS that picks the next unsaturated atom and
     tries bonding it to another under-saturated atom at increasing order, with one atom allowed to stay
     exactly one valence unit short (a legal radical). A brand-new triple bond is only permitted between
     two currently-fully-unbonded atoms, and once formed blocks either atom from accepting anything else
     — without this, valence-5 nitrogen could stay triple-bonded to another N *and* pick up extra O=
     substituents, which is unphysical.
   - **Ionic** (mixed metal+nonmetal groups): tries every combination of each atom's `commonIonCharges`
     and keeps only combinations that sum to zero net charge, then connects them with a minimal spanning
     tree (exact topology doesn't matter here — nothing downstream depends on which specific ionic
     contacts exist, only that the group is charge-balanced and connected).
   - A single atom on its own can *also* just pick a different one of its own common ion charges (or
     revert to neutral) without bonding to anything — this is how simple electron transfer between two
     atoms in the same reaction gets represented.
4. **Isomer selection.** Multi-atom groups (covalent or ionic) immediately collapse to their single
   lowest-ΔHf realization, since their net charge contribution is fixed regardless of which isomer wins.
   Single-atom groups keep *all* their charge-option candidates.
5. **Charge-conserving cross-product.** The single-atom groups' candidate sets are cross-producted, and
   only combinations whose total charge matches the original reactants' total charge survive. This is
   what makes e.g. Na + H⁺ → Na⁺ + H come out right instead of two independently-"cheapest" but
   charge-imbalanced choices.
6. **Score and select.** ΔH/ΔS/ΔG are computed from each surviving combination's `computeProperties`
   calls (reusing whatever override applies), and the lowest-ΔG combination wins, ties broken by fewest
   bonds broken. For unimolecular calls, a single-product result whose formula matches the original
   reactant is excluded from candidacy — otherwise a stable molecule "decomposing into itself" (ΔH=0)
   would always beat any real, higher-energy fragmentation, defeating the point of modeling metastable
   species at all.

### Two-tier caching

`findBestPartition` caches on `(sorted reactant canonical keys, T rounded to the nearest 50K)` — this is
what the design doc means by "search cost is paid once per novel encounter". `reactionProbability` is
**not** part of that cache; it's evaluated at the exact T every call. If probability were bucketed too,
ignition behavior would visibly stair-step every 50K instead of responding smoothly to temperature — the
split exists specifically to avoid that.

### The dissolution split

Solid ionic lattices are `MoleculeGraph`s containing order-0 bonds. `reaction.ts`'s `reactPair` checks for
this (`isIonicSolid`) combined with the other reactant being water (`isWater`, by formula) and routes to
`dissolution.ts` instead of `partition-search.ts` — dissolution isn't a bond-forming/breaking process in
the same sense, so it gets its own energy model (Kapustinskii lattice energy + Born hydration enthalpy +
an assumed dissolution entropy) rather than being forced through the covalent/ionic bonding DFS.

## Testing strategy

Unit tests are colocated per module (`foo.ts`/`foo.test.ts`). Three suites test the *system*, not a
single module — see the "Testing conventions" section of `CLAUDE.md` for what each one covers. The
golden-reactions suite is the actual M1 acceptance artifact: it's what the design doc's build order means
by treating M1 as a go/no-go gate on the whole "general chemistry, no reaction table" premise.

## `src/sim`: grid, movement, and energy

- **`grid.ts`** — `SimGrid`: flat typed arrays for `specId` (u16, `EMPTY` sentinel), `u` (f32, internal
  energy in joules), `phase` (u8, `PhaseCode`), and `n` (u8, gas mole count, unused until M5). `phase` is
  the live, per-cell runtime phase — it can differ from a species' `phaseAtSTP` once a cell has been
  heated or cooled, and both movement and conduction read/write it directly rather than re-deriving it
  from the species table each time.
- **`species.ts`** — `SpeciesTable`: a specId-indexed cache over `InternedPool`, exposing `phaseOf`
  (STP phase, used only to build the initial palette), `densityOf`, and `thermalOf` (a `ThermalProfile`:
  melt/boil points in K, specific heat and thermal conductivity per phase, latent heats). `buildPalette`
  builds the M2/M3 paint palette (15 elements + water).
- **`movement.ts`** — `stepMovement`: bottom-up falling-sand scan with alternating horizontal parity,
  per the design doc. Reads `grid.phase[idx]` (not the species' nominal phase) so a cell that has melted
  or frozen this tick immediately obeys its new phase's movement rule.
- **`heat.ts`** (M3) — `stepConduction`: internal energy `U` is the state variable; temperature is
  *derived* piecewise via `temperatureOf`, with flat plateaus of width `mass * heatOfFusion` /
  `mass * heatOfVaporization` around the melt/boil points, giving latent heat and phase change with no
  per-species special-case code (see the design doc's Q9). `energyForTemperature` is the inverse, used to
  seed a freshly painted cell's `U` (and therefore its initial phase) from an ambient target temperature.
  Conduction itself accumulates energy deltas from a single per-tick snapshot of temperatures (like
  `movement`'s `moved` buffer, but summed rather than swapped) so the result doesn't depend on scan order;
  flux between two cells is clamped to at most what would equalize their temperatures, and conductivity is
  used as a relative rate constant, not a literal transport calculation, since a cell has no defined
  physical size in meters. Reaction enthalpy (`U += -deltaH`) is not wired in yet — reactions are a later
  milestone.
- **`rng.ts`** — `mulberry32`, a small deterministic PRNG shared by movement (for reproducible ticks/tests).
- **`walls.ts`** (M4) — glass/steel/insulator as a small fixed table of synthetic pseudo-species, *not*
  chemistry molecules: the v1 element set has no silicon (so glass/SiO2 can't be interned) and "steel"
  isn't a single compound anyway. specIds are reserved in a disjoint range (`0xff00..0xff02`, below the
  `EMPTY` sentinel `0xffff` and above anything `InternedPool` will ever assign), so `grid.specId` stays
  one flat `Uint16Array` and `SpeciesTable`/`movement.ts` only need one range check (`isWallSpecId`) to
  branch to the wall table instead of the pool. Walls never melt/vaporize in v1 — `meltK` is set absurdly
  high so `heat.ts`'s existing plateau logic simply never triggers, rather than adding special-case code —
  and `movement.ts` skips them outright (neither a mover nor something the mover can displace into).
- **`mixer.ts`** (M4) — `stirRegion`: forces extra random swaps between adjacent liquid/gas cells in a
  radius, independent of `movement.ts`'s density-driven swaps. This is **stirring only**. The design doc
  frames the mixer's real purpose as forcing contact for interface-limited immiscible pairs, but that
  requires a reaction step on the grid, and reactions aren't wired into the tick loop yet (see "What's
  next" below) — so today the mixer just visibly speeds up two same-phase liquids/gases mixing by color.
  Revisit once reactions land.
- **`worker.ts`** — owns the `SimGrid` and `InternedPool`, runs the tick loop (`movement -> heat`, per the
  design doc's `movement -> heat -> react` order — heat now includes an optional point heat source before
  conduction), and talks to the main thread over `postMessage`. Paint messages carry only a `specId`; the
  worker derives the painted cell's initial `U`/phase from ambient temperature via `heat.ts`. M4 adds:
  `step` (advance exactly one tick while paused, for single-stepping), `setSpeed` (0.25x-4x — implemented
  as a fractional tick accumulator so ticks stay whole and deterministic rather than scaling `TICK_MS`,
  which would make the swap-probability-per-tick physics run at different real rates instead of different
  simulated rates), `heat`/`clearHeat` (a persistent point power source in **watts, not target
  temperature** — deliberately, so boiling a painted liquid still costs real simulated time instead of
  snapping to a setpoint; see `heat.ts`'s `applyPointHeatSource`), and `stir`. Frame messages now also
  carry `phase` and a derived `tempK` grid so the UI's hover inspector can look up a cell locally without a
  worker round trip per hover.

## `src/render` and `src/ui`

- **`render/renderer.ts`** — raw WebGL2: a single fullscreen quad, a per-specId color LUT, and a
  nearest-filtered texture blit of the frame's `specId` grid. No per-cell geometry (see the design doc's
  "PixiJS was dropped").
- **`ui/app.ts`** (M4) — the full v1 tool set as plain DOM (no framework, per the design doc): paint
  (per-species), erase, wall materials, burner/coolant (armed on pointerdown, held while dragging, cleared
  on pointerup — mirrors `worker.ts`'s persistent-source model), and mixer, plus pause/single-step/speed
  controls. A hover inspector panel is always active regardless of the selected tool (shows formula/wall
  label, temperature in K, and phase for the cell under the cursor) — probe isn't a separate selectable
  tool since hovering is unambiguous and doesn't compete with a click-drag tool the way paint/erase would.
  Gas pressure isn't shown yet (`n` is unused until M5).

## What's next (not yet built)

Per the design doc's build order: gases/pressure/aqueous ions at the grid level (M5), then walls/
apparatus/distillation (M6) — note `src/sim/walls.ts` already gives M6 physical wall cells with a
`wallStrength` field to build on, but vessel-bursting-past-strength logic itself isn't implemented (that's
gated on M5's gas pressure existing first). Reactions (`src/chem`'s `reactPair`/`attemptReaction`) are
implemented in the chemistry core but not yet wired into the worker's tick loop — there's no dedicated
milestone number for that wiring in the design doc's build order, so treat it as arriving alongside
whichever of M5/M6 first needs visible reactions, not as already done. The mixer tool (`mixer.ts`) is
stirring-only until that wiring exists.
