# Grill session: 2D cellular-automata chemistry lab sim

> **Superseded 2026-08-11.** The graph-search chemistry engine this doc argues for (`src/chem`) was built
> and shipped, then deleted the same day after real usage showed it produced unpredictable products,
> temperature runaways, and pressure weirdness — it was replaced with a small hand-authored
> `reactants -> products` table (`src/sim/species-data.ts` + `src/sim/reactions.ts`). This doc is kept for
> historical rationale; the grid/movement/energy/pressure/tools sections still describe what's built, but
> the chemistry-model sections below (and the "not a hand-written reaction table" goal) no longer reflect
> the actual code. See [CLAUDE.md](../CLAUDE.md) and [ARCHITECTURE.md](../ARCHITECTURE.md) for current
> state.

Session date 2026-08-11. Topic: a 2D falling-sand-style scientific chemistry
sandbox — lab bench view, no character, spawn/erase chemicals, observe reactions,
temperature and pressure, phases of matter, later distillation and other apparatus.
Explicit goal: reactions must follow general physical rules, not a hand-written
reaction table.

---

## Resolved decisions

**Chemistry model**

- Only the ~30 *elements* are enumerated. Molecules are emergent, built from
  valence/electronegativity/bond-enthalpy rules. There is no species table and no
  reaction table.
- One cell holds one molecule: `{ specId: u16, U: f32, phase, n: u8 (gas only) }`.
  `specId` is an index into an interned molecule pool (`{atoms, bonds}`).
- Reactions act on neighbour pairs: combine the two atom multisets, enumerate
  valence-valid partitions, pick the lowest-Gibbs product set. Results memoise on
  `(compA, compB, tempBucket)`, so the search cost is paid once per novel encounter,
  never per cell per frame.
- Only *elementary* steps exist — unimolecular and bimolecular, as in real kinetics.
  Radicals (H·, OH·, O·) are first-class species. Overall stoichiometry such as
  2H₂ + O₂ → 2H₂O emerges from initiation/propagation/branching/termination chains,
  and so do flame fronts and explosions.
- Kinetics via Evans–Polanyi: `Ea = 0.5·Σ(bonds broken) + 0.3·ΔH`, fired
  probabilistically as `P = exp(−Ea/RT)` per tick. This is what produces
  metastability, ignition temperatures, and inert strongly-bonded species — with no
  per-reaction tuning.
- Species space is bounded: valences satisfied, ≤6 heavy atoms, carbon chains ≤2 in
  v1, formal charge balanced. Keeps partition counts in the low hundreds.
- Physical properties of emergent molecules are estimated at intern time from the
  molecular graph — ΔHf by bond additivity, S° from degrees of freedom, dipole by
  vector-summing bond dipoles, bp from an MW+dipole+H-bond correlation, density from
  MW / vdW volume — then cached. A measured-value override file wins where it exists
  (`OVERRIDES[formula] ?? estimated`), so water boils at exactly 100 °C.
- Dissolution is itself a ΔG-gated reaction:
  `ΔGsol = ΔHhydration − latticeEnergy − T·ΔSsol`, lattice energy from Born–Landé.
  NaCl + H₂O → Na⁺(aq) + Cl⁻(aq); AgCl stays solid. Aqueous cells ignore buoyancy
  relative to the solvent and random-walk within it, so solutions homogenise.
  Saturation and precipitation emerge.

**Physics**

- Simulation runs on the CPU over flat typed arrays in a Web Worker; WebGL is used
  for rendering only. Target 256×256–512×512 at 60 Hz. Rust/WASM port deferred until
  profiling demands it.
- Tick order: movement → heat → react.
- Movement is a bottom-up falling-sand scan with alternating horizontal parity.
  Density decides swaps, probabilistically so mixing takes time. Liquids disperse by
  viscosity, gases invert gravity. 32×32 active-chunk skipping is the main perf win.
- Heat is stored as **internal energy U in joules**, not temperature. T is derived
  piecewise with melt/boil plateaus of width m·Lf and m·Lv, so latent heat,
  superheating and boiling plateaus need no special-case code. Conduction is an exact
  energy swap between neighbours. Reaction enthalpy is deposited as `U += −ΔH`.
- The atmosphere is real O₂/N₂ cells. A chunk goes dormant when it is uniformly air
  at uniform temperature with no neighbour activity; gas cells update on staggered
  ticks. A candle in a sealed jar consumes its oxygen and dies with nothing scripted.
- Gas-phase cells carry a molecule count `n`, giving `P = nRT/V`. Gas diffusion
  equalises `n` rather than moving single molecules. When a product has nowhere to
  go, `n` increments and pressure rises; past wall strength the vessel bursts.
  Le Chatelier's principle falls out of this.
- Apparatus is not scripted. Glass, steel and insulator are ordinary solid species
  with their own Tm, thermal conductivity and wall strength, and the player draws
  them. Distillation emerges from a heated flask, a sloping tube and a cool section;
  separation by boiling point is a consequence, not a feature. Prefab stamps
  (beaker, flask, condenser) are convenience only.

**Presentation and interaction**

- Colour is procedural: hue from element composition, saturation from polarity,
  alpha from phase, glow from temperature — with real-colour overrides for known
  substances, so CuSO₄ solution is genuinely blue. A hover inspector gives exact
  formula, T, P and phase.
- v1 tools: paint, erase, wall (glass/steel/insulator), burner, coolant, probe,
  mixer, and time controls (pause, single-step, 0.25×–4×).
- The burner injects **power in watts**, not a target temperature. Chosen
  deliberately to preserve energy accounting: boiling off a solvent takes real time,
  and a strong flame can genuinely overheat something.
- The mixer's purpose changed once dissolution became a reaction: it is *not* for
  salt and water (which dissolve unaided) but for genuinely immiscible or
  interface-limited pairs.

**Process and stack**

- Validation is a headless golden-reaction suite in CI. The reaction engine is a
  pure function of `(speciesA, speciesB, T, P)`, so it is tested with no grid and no
  renderer: ~40 known reactions asserting products and the sign/rough magnitude of
  ΔH, property regressions against measured bp/density, and conservation invariants
  for atoms, charge and energy. Built alongside the engine, not after.
- Build order, with M1 as an explicit go/no-go gate on the whole design:
  1. Headless chemistry core + tests
  2. Grid, movement, density, render
  3. Energy: conduction, phase change
  4. Tools, UI, inspector
  5. Gases, pressure, aqueous ions
  6. Walls, apparatus, distillation
- Stack: Vite + TypeScript + Vitest. `src/chem` pure and headless, `src/sim` worker
  with typed arrays, `src/render` a raw WebGL2 quad plus fragment shader, `src/ui`
  plain DOM/React panels. **PixiJS was dropped** — it solves sprite batching, and
  this project draws exactly one sprite; owning the shader also gives heat glow,
  flame bloom and false-colour overlays cheaply.

## Deliberately deferred

Organic chemistry and C–C chains; catalysis; momentum/velocity fields; pumps,
vacuum, pH meters and pipettes; WebGPU; Rust/WASM; any objective, scoring or
progression layer (v1 is a pure sandbox).

## Remaining open item

The exact v1 element set is unfixed. Working assumption for M1:
H, C, N, O, Na, Mg, Al, S, Cl, K, Ca, Fe, Cu, Zn, Ag — enough for acids, bases,
salts, metals, gases, precipitates and simple combustion.

---

## Q&A log

**Q1 — Can reactions be fully general, or is a species table unavoidable?**
Recommended species-table + reaction-templates. **Rejected** in favour of
element-level emergence, accepting higher risk and longer time-to-playable for
genuine generality.

**Q2 — What does one cell contain?** Recommended one molecule per cell. Accepted.

**Q3 — Multi-reactant stoichiometry with only pairwise cells?** Recommended
elementary steps only plus first-class radicals. Accepted.

**Q4 — Where does activation energy come from without per-reaction data?**
Recommended Evans–Polanyi. Accepted.

**Q5 — Properties of never-tabulated molecules?** Recommended structural estimation
at intern time plus a measured-value override file. Accepted.

**Q6 — What bounds the emergent species space?** Recommended ≤6 heavy atoms and no
C–C chains in v1. Accepted.

**Q7 — Where does the simulation run?** Recommended CPU typed arrays in a Worker,
WebGL for render only. Accepted.

**Q8 — Movement model?** Recommended falling-sand scan with density swaps and active
chunks. Accepted.

**Q8b — CONTRADICTION raised:** the stated salt/water "two layers" example implies
immiscibility, but salt actually dissolves, and most lab chemistry is aqueous.
Resolved by making dissolution a ΔG-gated reaction producing diffusing aqueous ions.
Knock-on: the mixer tool's purpose was redefined.

**Q9 — Heat model?** Recommended storing internal energy and deriving temperature.
Accepted.

**Q10 — Is the atmosphere simulated?** Recommended real O₂/N₂ cells with
uniform-air chunk skipping. Accepted.

**Q11 — Pressure, given cells can't compress?** Recommended a molecule count on gas
cells giving P = nRT/V. Accepted.

**Q12 — Apparatus representation?** Recommended wall cells and player-drawn
geometry, no scripted apparatus. Accepted. Left an open detail — active energy
sources — which was folded into Q14.

**Q13 — Visual identity of emergent species?** Recommended procedural colour with
real-colour overrides. Accepted.

**Q14 — v1 tool set and heating semantics?** Recommended the full basic set with
watt-based heating. Accepted.

**Q15 — How is derived chemistry validated?** Recommended a headless golden-reaction
suite in CI. Accepted.

**Q16 — Build order?** Recommended headless chemistry core first as a go/no-go gate.
Accepted.

**Q17 — Is PixiJS still right?** Challenged it. Recommended dropping it for a raw
WebGL2 blit with DOM UI. Accepted.
