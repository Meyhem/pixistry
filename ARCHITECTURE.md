# Architecture

This document describes how the codebase is built, as opposed to why — the design rationale and every
resolved trade-off lives in [.grill/chem-ca-sim.md](.grill/chem-ca-sim.md). Read that first if you're
asking "why not just hardcode X"; the answer is almost always already there. This document assumes you've
read it and want to know where things live and how they fit together.

## Layers

The project is planned as four layers, built in that order (see the doc's "Build order"). Only the first
exists today.

| Layer | Directory | Status | Depends on |
|---|---|---|---|
| Chemistry core | `src/chem` | **Built (M1)** | nothing (zero runtime deps) |
| Simulation grid/worker | `src/sim` | Not built | `src/chem` |
| Renderer | `src/render` | Not built | `src/sim` |
| UI | `src/ui` | Not built | `src/sim`, `src/render` |

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

## What's next (not yet built)

Per the design doc's build order: grid + movement + density + rendering (M2), energy/conduction/phase
change (M3), tools/UI/inspector (M4), gases/pressure/aqueous ions at the grid level (M5), then walls/
apparatus/distillation (M6). None of that exists yet — don't assume a `src/sim` worker, a canvas, or any
UI when reading this codebase today.
