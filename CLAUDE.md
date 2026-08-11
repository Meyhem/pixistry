# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Pixistry is a 2D falling-sand-style chemistry sandbox: a lab-bench sim where reactions emerge from
element-level physical rules (valence, electronegativity, bond enthalpy) rather than a hand-written
species/reaction table. The full design rationale — and the reasoning behind every non-obvious choice
below — lives in [.grill/chem-ca-sim.md](.grill/chem-ca-sim.md); read it before making architectural
changes to `src/chem`, since most "why not just do X" questions are already answered there.

**Current status: M1 only.** `src/chem` (the headless chemistry core) is implemented and tested. The
build order's remaining milestones — grid/worker (`src/sim`), WebGL renderer (`src/render`), and UI
(`src/ui`) — do not exist yet. Don't assume those directories or a running app exist.

## Commands

```bash
npm install          # install deps (zero runtime deps in src/chem by design)
npm run typecheck     # tsc --noEmit
npm test               # vitest run -- the whole suite
npm run test:watch      # vitest watch mode
npm run dev               # vite dev server (no app to see yet -- M2+ not built)
```

Run a single test file: `npx vitest run src/chem/golden-reactions.test.ts`
Run tests by name: `npx vitest run -t "NaCl"`

Both `npm run typecheck` and `npm test` passing is the actual gate — the design doc's build order names
M1 an explicit go/no-go checkpoint, and `golden-reactions.test.ts` is that checkpoint's artifact.

## Architecture: `src/chem`

Pure, headless, dependency-free TypeScript (must stay droppable into a Web Worker in M2). Every module is
a pure function of its inputs except `InternedPool`, which is a plain dedup cache. Dependency flow:

```
types.ts, elements.ts, bonds.ts          (data + primitives)
        v
canonical.ts                              (graph -> canonical string key)
        v
properties.ts + overrides.ts               (MoleculeGraph -> estimated/measured physical properties)
        v
intern.ts                                    (canonicalize + computeProperties -> MoleculeSpec, deduped)
        v
partition-search.ts                           (the algorithmic core, see below)
        v
kinetics.ts, dissolution.ts                     (Ea/probability; ionic solid <-> aqueous ions)
        v
reaction.ts                                       (public orchestration: reactPair / attemptReaction / decomposeUnimolecular)
        v
index.ts                                            (curated public API surface for the future M2 worker)
```

### The core algorithm (`partition-search.ts`)

Given two reactant `MoleculeGraph`s (or one, for unimolecular decomposition), `findBestPartition`:
1. Combines both reactants' atoms into one tagged pool, retagging B's atom ids with an offset so every
   atom keeps a stable identity through the search (needed later to detect which original bonds broke).
2. Generates candidate **group shapes** — ways to partition the combined atom multiset by per-element
   count into up to 3 groups — pruned by heavy-atom cap (6), carbon cap (2), and a valence-feasibility
   check, before any bonding work happens.
3. For each group, `enumerateBondGraphs` backtracks over legal bond assignments (a **covalent** DFS using
   valence sums, or a separate **ionic** charge-balancing constructor — see below) to produce candidate
   product graphs.
4. Scores every full partition by ΔG at the given T and returns the lowest-ΔG one. Results are memoized
   per `(sortedReactantKeys, T-bucketed-to-50K)`.

**Covalent vs. ionic bonding is a hard branch, not a spectrum**: `bonds.ts`'s `bondCategory` says a
metal+nonmetal pair is `'ionic'` (bond order 0) and two nonmetals are `'covalent'` (order 1-3); two
metals never bond. `enumerateBondGraphs` routes mixed metal/nonmetal groups to `enumerateIonicGraphs`,
which tries combinations of each atom's `commonIonCharges` and keeps only charge-balanced (net-neutral)
combinations — this is how e.g. Fe2O3 correctly comes out as Fe³⁺ rather than Fe²⁺, with no reaction
table involved. A lone atom can also change its own charge state without bonding at all (representing
simple electron transfer between two atoms in the same reaction); when a group has several such
candidates, `computeBestPartition` cross-products them and keeps only combinations that conserve total
charge — this is the mechanism that makes single-displacement-style redox emerge, when it does (see
limitation below).

A triple bond, once formed, saturates both atoms' bonding capacity even if their nominal valence would
allow more (real N≡N/C≡C/C≡O never take extra substituents) — this is what keeps N₂+O₂ correctly inert
instead of finding a bogus hypervalent product. If you touch the bonding DFS in `partition-search.ts`,
preserve this constraint.

### Properties and overrides

`properties.ts`'s `computeProperties` estimates ΔHf (bond additivity), S° (a calibrated log-MW
correlation), dipole (VSEPR-lite vector sum), bp/mp, and density purely from a `MoleculeGraph` — then
`overrides.ts` lets a curated measured value win **field-by-field** (not whole-object replacement) for
species where precision matters (water boils at exactly 100°C). Every element's own standard-state
formula (H2/N2/O2/Cl2 for the diatomics, bare symbol for the rest) is programmatically forced to
ΔHf = 0, since that's a hard thermodynamic convention, not an estimate.

Formula strings are **strict Hill notation** (`hillFormula` in `formula.ts`), which looks unfamiliar for
some compounds by design: NaCl → `"ClNa"`, HCl → `"ClH"`, NH3 → `"H3N"`. This matches what
cheminformatics tools call the Hill formula and is used as the override lookup key — don't "fix" it to
look conventional without updating every `OVERRIDES` key to match.

### Known limitation: bare-ion thermodynamics is gas-phase only

`properties.ts` prices ionization (a real per-element `IONIZATION_COST` table) but deliberately does
**not** add hydration energy for standalone charged atoms — an earlier attempt to add it made ordinary
covalent bond formation (H+H → H2) lose to spurious ion-pair splitting, because H's tiny ionic radius
makes the Born hydration term blow up. This means single-displacement redox between two metal ions only
comes out right when gas-phase ionization energy happens to agree with real aqueous reduction-potential
ordering (it does for an alkali metal displacing H⁺; it does *not* for closer pairs like Cu/Ag⁺). This is
called out in a comment in `golden-reactions.test.ts` rather than silently glossed over — if you improve
this, the fix likely needs hydration energy scoped specifically to species already marked
`Phase.Aqueous`, not applied unconditionally to every charged atom.

### Dissolution (`dissolution.ts`)

Solid ionic lattices are `MoleculeGraph`s with order-0 bonds between cation(s) and anion(s).
`attemptDissolution` uses the **Kapustinskii equation** (not a literal per-structure Madelung constant)
for lattice energy specifically because it generalizes across stoichiometries (NaCl 1:1, CaCl2 1:2, ...)
from ion count alone — an earlier per-ionic-bond-pair summation badly over-counted for non-1:1 salts.
A flat "covalent character" bonus is added for d-block metal halides (Fe/Cu/Zn/Ag), which real ionic-only
models underestimate. The NaCl-dissolves/AgCl-doesn't distinction is the calibration checkpoint for this
module — reverify both directions if you touch the constants.

### Testing conventions

Unit tests are colocated (`foo.ts` + `foo.test.ts`). Three cross-cutting suites sit alongside the
modules rather than testing one: `golden-reactions.test.ts` (product identity + sign/magnitude of ΔH
across combustion, acid-base, dissolution, radical chains, and metal redox), `conservation.test.ts`
(atom/charge/mass conservation, determinism, order-independence, and the "partitions stay in the low
hundreds" perf guard, run over a deterministic sweep across all 15 elements), and
`property-regression.test.ts` (override precision + sanity bounds on non-overridden estimates).
