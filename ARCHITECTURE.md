# Architecture

This document describes how the codebase is built. `.grill/chem-ca-sim.md` is a historical design doc:
it argued for a graph-based, general chemistry engine (element-level bond/valence search rather than a
hand-written reaction table) and that engine was actually built and shipped as `src/chem` through M1-M6.
In practice it produced unpredictable products, temperature runaways, and pressure weirdness once real
usage exercised it, so it was deleted and replaced with the much simpler static species/reaction table
described below. `.grill/chem-ca-sim.md` is kept for the historical rationale (and the parts of it that
still apply — grid layout, movement, energy/conduction, tools — are all unaffected), but its "why not just
hardcode X" answer for chemistry specifically no longer reflects what's actually built. The design doc's
gas pressure model (Q11, `grid.n`/`pressure.ts`/vessel bursting) was also dropped after real usage: Pixistry
is just pixels of elements and compounds, each with a temperature — no pressure, no compression, no vessel
bursting.

## Layers

| Layer | Directory | Depends on |
|---|---|---|
| Static species/reaction data | `src/sim/species-data.ts`, `src/sim/reactions.ts` | nothing |
| Simulation grid/worker | `src/sim` | the static data files above |
| Renderer | `src/render` | `src/sim` |
| UI | `src/ui` | `src/sim`, `src/render` |

There is no separate headless chemistry layer anymore — species and reaction data are plain arrays
consumed directly by `src/sim`, in the same module tree as the grid/tick-loop code that uses them.

## `src/sim/species-data.ts` and `src/sim/reactions.ts`: the static chemistry data

- **`species-data.ts`** — `SPECIES: readonly SpeciesData[]`, a fixed, hand-curated array (34 entries: 15
  pure elements in their standard state, 17 compounds, 2 aqueous dissolution products). Each entry is
  plain data: formula/label, color, density, phase at STP, melting/boiling point, per-phase specific heat
  and thermal conductivity, latent heats, and a `paintable` flag. `SpeciesId` is a plain `{name: index}`
  map giving every entry a stable numeric id (array index) for the reaction table and tick loop to
  reference. There is no interning, canonicalization, or estimation step — every value here is a real,
  hand-picked physical constant, which is what guarantees a reaction can never produce a species with
  made-up properties (the old engine's actual failure mode): only what's listed here can ever exist.
  Every species — even ones that are gas-only in practice (H2, N2, O2, Cl2) — has nonzero specific heat
  and thermal conductivity for *every* phase, not just the one it normally occupies; a zero divisor there
  is what caused `temperatureOf` (`heat.ts`) to blow up to `Infinity`/`NaN` the one time this wasn't true.
- **`reactions.ts`** — `REACTIONS: readonly ReactionRule[]`, a hand-authored list of `reactants ->
  products` rules (reactant `SpeciesId` pair, product `SpeciesId` list, `deltaH` in kJ/mol, an optional
  `minTempK` ignition threshold, and a flat per-tick `probability`). `findReaction(specA, specB)` is an
  order-independent lookup used once per adjacent cell pair, replacing what used to be a full bond-graph
  search call. The rule set mirrors every compound the old engine's curated override table knew about
  (combustion, halogenation, metal oxidation, one acid-base neutralization, and NaCl/H2O dissolution),
  just re-expressed directly as formulas instead of being *derived* by a search each tick. There is
  deliberately no rule for `AgCl + H2O` — that's the NaCl-dissolves/AgCl-doesn't calibration point the old
  `dissolution.ts` doc comment called out, preserved here by simple omission.

## Testing strategy

Unit tests are colocated per module (`foo.ts`/`foo.test.ts`) under `src/sim`. `react.test.ts` covers the
reaction table end-to-end on the grid (dissolution firing, AgCl not dissolving, ignition threshold,
probability gating, energy bookkeeping). Two suites are deliberately property-based rather than
example-based, because the bugs they guard only show up over long runs or across kind combinations:
`fuzz.test.ts` (numerical stability — every cell finite and under `MAX_TEMP_K` across thousands of ticks
of random activity) and `entity-fuzz.test.ts` (apparatus overlap — see `entity-composite.ts`).

## `src/sim`: grid, movement, and energy

- **`grid.ts`** — `SimGrid`: flat typed arrays for `specId` (u16, `EMPTY` sentinel), `u` (f32, internal
  energy in joules), and `phase` (u8, `PhaseCode`). `phase` is the live, per-cell runtime phase — it can
  differ from a species' `phaseAtSTP` once a cell has been heated or cooled, and both movement and
  conduction read/write it directly rather than re-deriving it from the species table each time. There is
  no pressure/mole-count field: a gas cell is just a cell with `PhaseCode.Gas`, same as any other phase.
  Alongside those three, a set of overlay arrays: `radiatorRadius`/`radiatorTargetK`, `tubeMask`,
  `sinkMask` and `entityOwner` are all *derived* from the apparatus entity list (see
  `entity-composite.ts`), while `stirrerMask` and `catalystStrength` are painted terrain the player owns
  and nothing derives. There is no per-cell filter array: a membrane cell is simply a cell
  whose `entityOwner` names a filter entity (see `filter.ts`).
- **`entity.ts`** / **`entity-id.ts`** — the one entity vocabulary. Every apparatus kind (funnel, tube,
  flask, filter, radiator, glass polygon) carries a `kind` discriminant, `AnyEntity` is their union, and
  `ENTITY_DEFS` is a registry of one small `EntityDef` per kind. Half of a def is instance-side, for the
  worker (`footprintOf`, `dragHandle`, `move`, optional `rotate`, `place`, `toWire`, optional
  `applySettings`/`action`); the other half is *wire*-side, for the UI (`handlesOf`, `bodyCells`,
  `bodyDistance`, `boundsOf`, optional `rotationOf`) — the main thread only ever has frame snapshots, no
  grid to resolve a real footprint against. Everything generic about apparatus (the worker's protocol
  handlers, the compositor, selection, hit-testing, the handle overlay) dispatches through it, so adding
  a kind is one registry row plus the payload unions in `protocol.ts` — no new messages, no new selection
  code — including its settings pane, which each kind declares as a `settingsSchema` of typed fields
  (slider, segmented, species picker, chip list, readout, action) that side-panel.ts renders without
  knowing which kind it is drawing. The same schema serves pre-placement config and selected-entity
  editing, since the two differ only by the `mode` the kind is asked for; `readoutsOf` supplies the
  values that come from the live instance rather than the edit draft (a funnel's dwindling budget), so
  those tick with the sim instead of freezing when the entity was selected.
  `hitTestEntities` lives here too, since "what did this click land on" is the registry's own
  question: nearest handle within grabbing distance wins, else the **smallest-area body** containing the
  point. That area rule is what keeps a funnel standing inside a big beaker clickable, and it replaced a
  hand-ordered funnel → knee → segment → filter → radiator → glass → flask chain that had to be
  re-reasoned every time a kind was added. `entityId` is one
  monotonic never-reused counter shared by every kind (a per-kind id can't order a tube against a flask),
  and is also the id everything on the wire addresses.
- **`entity-composite.ts`** — the one place apparatus becomes grid state. Every placed apparatus declares
  a `Footprint` (which cells are its glass, its lumen, its membrane, its radiating cells) and
  `compositeEntities` derives all of that in one pass: wipe the derived arrays, then stamp every entity in
  placement order (ascending `entityId`). An edit is "mutate
  the instance, then recomposite"; there is no incremental unstamp anywhere in `src/sim`. `entityOwner`
  records one owner per apparatus cell, which is what lets the final pass clear exactly the glass no live
  entity claims while never touching the player's own paint. A membrane's grid presence is *nothing but*
  ownership, claimed last and only at non-wall cells — a glass cell blocks outright anyway, and a
  membrane holding the owner slot at a glass cell would either orphan a deleted vessel's glass or eat the
  player's painted wall on the next composite.

  This replaced three coexisting schemes that each reconstructed overlap correctness locally — a "put back
  whatever went empty" repair pass wrapped around every edit, per-kind crossing rules inside
  `unstampGlass`/`unstampFilter`/`unstampRadiator`, and the tube's own mask restamping. Each was
  individually reasonable and the combination produced essentially every apparatus regression the project
  has had (a tube dragged across a beaker punching a permanent hole in it; a beaker dragged across a tube
  plugging it). Deriving instead of patching makes those unrepresentable: B's cells are recomputed from B,
  so nothing A does can damage them. Two consequences worth knowing: a tube's lumen bores through whatever
  it crosses *last*, after every wall is down (z-order doesn't apply — a funnel placed later would
  otherwise plug the conveyor with its own glass), and boring deliberately doesn't claim the cell, so
  moving the tube away heals the hole. `entity-composite.test.ts` pins the invariants and
  `entity-fuzz.test.ts` is the standing net: random place/move/reshape/delete across all six kinds,
  driven through `entity.ts`'s generic dispatchers (the same surface the worker's protocol handlers
  call), re-checking idempotence, owner/instance consistency and orphan-free overlays after every single
  op. It found a live tube segment-drag hang on its first run. Entity bugs get fixed *with* a new op or
  invariant there, not just a targeted unit test.
- **`species.ts`** — `SpeciesTable`: a thin, eager wrapper directly over `species-data.ts`'s `SPECIES`
  array (no interning — specIds are just array indices), exposing `phaseOf`, `densityOf`, and `thermalOf`
  (a `ThermalProfile`: melt/boil points in K, specific heat and thermal conductivity per phase, latent
  heats), with wall specIds branching out to `walls.ts` exactly as before. Aqueous species (the two
  dissolution-product ions) carry water's own thermal profile directly in their `species-data.ts` entry
  rather than being derived at runtime — a grid cell of "dissolved Na+" is ~1cm3 of dilute solution, not
  pure liquid ionic sodium, so its own bp/mp/heat-capacity would be physically meaningless. `buildPalette`
  builds the paint palette from every `SPECIES` entry with `paintable: true`: the 15 elements, water, and
  the two ionic solids `NaCl`/`AgCl`, so dissolution (see `react.ts`) has something to demo both ways.
- **`movement.ts`** — `stepMovement`: bottom-up falling-sand scan with alternating horizontal parity,
  per the design doc. Reads `grid.phase[idx]` (not the species' nominal phase) so a cell that has melted
  or frozen this tick immediately obeys its new phase's movement rule. `tryDiagonal` carries the standard
  anti-corner-cut rule: a diagonal step is refused when *both* orthogonal neighbours it squeezes between
  are solid-blocking (wall matter, a tube's lumen, or a membrane this species can't pass). An outer corner
  has only one blocked, so a grain still slides past it as it piles up; a one-pixel diagonal wall has
  both, so nothing tunnels through it. That replaced a `vesselMask` overlay covering the interiors of
  *stamped* flasks only — hand-drawn diagonal glass was tunnelable, which is why the Glass tool's sealed
  vessels leaked.
- **`heat.ts`** (M3) — `stepConduction`: internal energy `U` is the state variable; temperature is
  *derived* piecewise via `temperatureOf`, with flat plateaus of width `mass * heatOfFusion` /
  `mass * heatOfVaporization` around the melt/boil points, giving latent heat and phase change with no
  per-species special-case code (see the design doc's Q9). `energyForTemperature` is the inverse, used to
  seed a freshly painted cell's `U` (and therefore its initial phase) from an ambient target temperature.
  Conduction itself accumulates energy deltas from a single per-tick snapshot of temperatures (like
  `movement`'s `moved` buffer, but summed rather than swapped) so the result doesn't depend on scan order;
  each *pairwise* flux is clamped to at most what would equalize that pair's temperatures, and
  conductivity is used as a relative rate constant, not a literal transport calculation, since a cell has
  no defined physical size in meters. That per-pair clamp alone isn't enough for stability, though: a
  tiny-heat-capacity cell (a low-density gas, especially) touching several neighbors at once can still
  receive more total flux in one tick than its own capacity holds, and left unclamped that overshoot
  compounds tick over tick into an exponential runaway (observed in practice climbing to `Infinity`/`NaN`
  within a few hundred ticks). Two independent guards fix this: the final per-cell update clamps a single
  tick's *net* temperature swing to `MAX_DELTA_T_PER_TICK` (2000K, generous but finite), and separately
  clamps the result to an absolute `MAX_TEMP_K` ceiling (10000K, well above any real transition in the
  species table) via the shared `clampEnergyToMaxTemp` helper — the same helper `react.ts` uses, since a
  cell that keeps getting re-ignited by fresh reactant drifting back in tick after tick has no per-tick
  rate limit otherwise and was independently observed climbing into the tens of millions of K over a real
  play session. `applyPointHeatSource` is the shared "inject/remove watts within a radius" primitive
  (converted to joules via the tick's real duration, so it's watts, not a target temperature — boiling a
  painted liquid still costs real simulated time rather than snapping to a setpoint); `stepRadiators`
  calls it once per cell with a nonzero `grid.radiatorRadius` (a per-cell overlay field, not a wall
  material — see `radiators.ts` and `grid.ts` — so a placed radiator has no collision and doesn't
  occupy `grid.specId` at all), driving it toward that cell's own `grid.radiatorTargetK`. Both fields
  are a snapshot of the side panel's sliders captured once at placement time, so a placed radiator keeps
  radiating exactly as configured for as long as it's on the grid, regardless of what the sliders do
  afterward — the way to change one is to select it, which edits that instance's own copy (see
  `radiators.ts`).
- **`rng.ts`** — `mulberry32`, a small deterministic PRNG shared by movement (for reproducible ticks/tests).
- **`walls.ts`** (M4) — glass, a small fixed table (one entry) of synthetic pseudo-species, *not*
  chemistry species: the v1 element set has no silicon (so glass/SiO2 has no entry). An "insulator" wall
  lived here too until it was cut: it was a second wall you drew exactly like glass but couldn't shape,
  select or see through, so every vessel worth building got built out of glass anyway. specIds are reserved
  in a disjoint range (`0xff00..0xfffe`, below the `EMPTY`
  sentinel `0xffff` and above the highest `species-data.ts` index), so `grid.specId` stays one flat
  `Uint16Array` and `SpeciesTable`/`movement.ts` only need one range check (`isWallSpecId`) to branch to
  the wall table instead of `SPECIES`. Walls never melt/vaporize in v1 — `meltK` is set absurdly high so
  `heat.ts`'s existing plateau logic simply never triggers, rather than adding special-case code — and
  `movement.ts` skips them outright (neither a mover nor something the mover can displace into). Walls are
  otherwise indestructible: there is no pressure model, so nothing ever bursts them. Heater/cooler
  apparatus used to live here as heater-glass/cooler-glass wall materials, occupying `grid.specId` and
  blocking movement like any other wall; that's been replaced by the non-physical radiator overlay
  described in the `heat.ts` entry above, so a placed radiator no longer collides with anything.
- **`mixer.ts`** (M4) — `stirRegion`: forces extra random swaps between adjacent stirrable (non-empty,
  non-wall, so solids included alongside liquid/gas) cells in a radius, independent of `movement.ts`'s
  density-driven swaps. This is **stirring only**. The design doc
  frames the mixer's real purpose as forcing contact for interface-limited immiscible pairs; now that
  `react.ts` (M5) wires reactions into the tick loop, stirring genuinely helps interface-limited pairs meet
  faster, but the mixer implementation itself is unchanged from M4.
- **`react.ts`** (M5) — wires `reactions.ts`'s static rule table into the grid tick loop: every adjacent
  non-empty, non-wall cell pair is visited exactly once per tick (each unordered pair checked from its
  top-left cell, same scan `heat.ts` uses), looked up via `findReaction(specA, specB)`, checked against
  the rule's optional `minTempK` at the average of the two cells' derived temperatures, and fires
  probabilistically via the shared `rng` against the rule's flat `probability`. This is what makes
  dissolution (`NaCl + H2O -> Na+(aq) + Cl-(aq)`, just another rule) actually happen on the grid. Product
  placement: 1-2 products reuse the two reactant cells directly; a 3rd product needs an empty neighbor
  cell (searched around both reactant cells) or the reaction doesn't fire that tick. Reaction enthalpy
  (`deltaH`) is scaled off reactant A's own nominal parcel mass (`massA / molarMassA`, the same "cell is a
  parcel" convention `heat.ts` uses) and, along with both cells' pre-reaction `U`, is split across product
  cells proportional to each product's own nominal mass — each product's *own* thermal profile then
  decides its real resulting phase. The resulting energy is passed through `heat.ts`'s
  `clampEnergyToMaxTemp` (see above) before being written, so a cell that keeps getting re-ignited tick
  after tick can't climb unboundedly.
- **`tube-shapes.ts`** / **`tube.ts`** — the conveyor-tube apparatus: a player-drawn, multi-segment
  polyline (knees snapped to one of 8 directions from the previous knee, in `tube-shapes.ts`'s
  `snapOctant`) turned into a **3-cell-wide channel** — every cell within Chebyshev distance 1 of the
  centre path, so the bore stays 3 wide on diagonals too (a Euclidean band pinches across a 45-degree run,
  and a conveyor that narrows at every bend jams there) — plus a wall ring (every 8-neighbour of the
  channel that isn't channel or aperture — watertight at any knee angle by construction, no per-angle
  special casing). The tube's only openings are the two **apertures**: three cells across the
  perpendicular, one step clear of each end of the band. Unlike the funnel's glass outline, the channel
  isn't stamped as matter — only the wall ring is real glass — so it's a pure overlay (`grid.tubeMask`,
  alongside `radiatorRadius`/`stirrerMask`'s "fixed background field" convention) and whatever real matter
  sits in a channel cell *is* the tube's cargo. `movement.ts` knows to leave those cells alone as both a
  mover and a destination, so `stepTubes` is the only thing that ever moves them, in three passes per
  tick: discharge (band cells touching an exit aperture push out), advance (every occupied cell steps to
  an 8-adjacent cell strictly closer to the exit, walked nearest-exit-first so nothing cascades the whole
  length in one tick), and intake (matter sitting in a mouth aperture is drawn in). "Closer to the exit"
  is a BFS distance field precomputed at build time (`distanceToExit`), which is what carries cargo around
  a bend with no per-segment direction bookkeeping — BFS guarantees every cell has a strictly-closer
  neighbour, so there is always a way forward and never a loop. Backpressure falls out for free: a blocked
  exit means those cells stay, and pass 2 can only move into cells that are empty *now*.

  Intake at the mouth is the whole suction model. This replaced a widening cone in front of the mouth that
  pulled matter in from several cells away; the cone had to suppress ordinary gravity for everything
  standing in it, and anything the tube would never actually take (wrong species, or a pull target some
  later-placed apparatus had walled off) was then frozen in mid-air forever — an invisible obstacle with
  nothing on screen to explain it. A mouth that only takes what arrives at it needs no hold at all, so
  that whole bug class is gone rather than patched: matter the tube refuses simply falls past.

  Editing a placed tube follows the shared entity vocabulary: its knees are its handles (dragged one at a
  time via `dragEntityHandle`), and grabbing anywhere else on it slides the whole tube (`moveEntity`) —
  there is no per-segment drag. A dragged knee always keeps every segment octant-aligned, even though it
  generally can't land on an octant ray from both
  its fixed neighbors at once — `resolveKneePosition` brute-forces the 8x8 direction-pair combinations and
  picks the valid intersection closest to the cursor. A drag that would still land off-axis is refused
  outright (`hasDegenerateSegment`), and `polylineToLumenPath` derives its step count up front rather than
  walking until it happens to arrive, so a misaligned pair can't spin forever and take the worker with it.
- **`filter.ts`** — the filter apparatus: a one-cell-wide membrane line that only lets the species on its
  own allow-list move into its cells, blocking everything else exactly like glass. There's no per-tick
  step function — the gating happens inline in `movement.ts`'s `canEnterFiltered` — and no per-cell
  filter array either: a membrane cell is marked purely by `grid.entityOwner` naming the line's
  `entityId` (0 still meaning "nothing here", so movement's fast path is one array read), and
  `stepMovement` takes an entityId → allow-list map built fresh each tick from the live instance list.
  That is what lets two membranes on one bench pass different species. The owner-based lookup replaced a
  dedicated `grid.filterMask` carrying per-kind instance ids — a Uint8Array, which meant a 255-line cap,
  an id allocator, and freed-id reuse that could hand a fresh line a stale selection's id; all of it fell
  away when the owner mask every entity already has became the key. (The frame message still carries a
  0/1 `filterMask` render hint, derived per frame from the owners, so the renderer can tint membranes
  without knowing about entities.)
- **`radiators.ts`** — the radiator apparatus: the two per-cell fields above are what the physics reads,
  and this module is the tracked instance list layered over them — a drawn line remembers its own
  endpoints, reach and target so the select tool can slide it, drag either end to re-aim it, or edit its
  reach/target live. `width` thickens the emitter itself around the drawn line: the Radiator tool always
  draws 0 (the radiation reach already controls how far a placement carries), but a scenario's `radiator`
  setup command paints a disc, and campaign heaters have to be real tracked instances or the first
  recomposite would wipe them off the bench.
- **`glass.ts`** — hand-drawn glass polygons: the corner chain the Glass tool draws, tracked so the select
  tool can pick a vessel back up. The cells themselves are ordinary glass wall matter (there's no mask to
  own them, unlike a filter's), so the instance keeps the corners *as drawn* plus a rotation step and a
  translation, and resolves them on demand (`glassPoints`) — 8 wheel notches therefore return the exact
  cells drawn, where folding each turn back into the stored corners would smear the outline a little
  further off true every time. Rotation is 45° a step about the chain's own centroid, the same
  granularity a flask has.
- **`worker.ts`** — owns the `SimGrid`, runs the tick loop (`movement -> radiate -> conduct -> react`, per
  the design doc's order — `stepRadiators` takes the point-heat-source slot conduction previously shared
  with the cursor-driven burner/coolant tool), and talks to the main thread over `postMessage`. Paint
  messages carry only a `specId`; the worker derives the painted cell's initial `U`/phase from ambient
  temperature via `heat.ts`. A radiator is placed via a separate `paintRadiatorLine` message into
  `grid.radiatorRadius`/`radiatorTargetK` instead, since it's a non-physical overlay, not a wall specId.
  Alongside the grid it holds ONE `entities: AnyEntity[]` list for every placeable apparatus kind — the
  grid says what each cell *does*, never which drag put it there, so that list is what makes any of it
  selectable, movable and editable after the fact. Apparatus speaks one generic protocol
  (`placeEntity`/`moveEntity`/`dragEntityHandle`/`rotateEntity`/`updateEntitySettings`/`entityAction`/
  `deleteEntity`, each addressing an `entityId`, with per-kind payloads as tagged unions), dispatched
  through `entity.ts`'s registry rather than per-kind handlers, and frames carry the whole bench back as
  one `entities: EntityWire[]` list. Every handler that
  touches an instance goes through `mutateEntities`, which runs the edit and then re-derives the grid from
  the list; nothing else writes apparatus state. Apparatus is indestructible: `erase` takes matter and
  painted terrain only (it skips any cell an entity owns), and the sole way something leaves the bench is
  `deleteEntity`, which the Select tool sends from its Delete key or its panel button. Scenario setup
  places real tracked flasks/funnels/radiators/ports into the same list for the same reason — an
  untracked one-shot stamp would vanish on the first recomposite.
  M4 adds: `step` (advance exactly one tick while paused, for single-stepping), `setSpeed` (0.25x-4x —
  implemented as a fractional tick accumulator so ticks stay whole and deterministic rather than scaling
  `TICK_MS`, which would make the swap-probability-per-tick physics run at different real rates instead of
  different simulated rates), and `stir`. Frame messages carry `phase` and a derived `tempK` grid so the
  UI's hover inspector can look up a cell locally without a worker round trip per hover.

## `src/render` and `src/ui`

- **`render/renderer.ts`** — raw WebGL2: a single fullscreen quad, a per-specId color LUT, and a
  nearest-filtered texture blit of the frame's `specId` grid. No per-cell geometry (see the design doc's
  "PixiJS was dropped").
- **`ui/app.ts`** (M4) — the full v1 tool set as plain DOM (no framework, per the design doc): paint
  (per-species), erase, wall materials (painted like any other wall, no special-case tool logic needed
  since `applyTool`'s `'wall'` case already just sends a `paint` message), a unified radiator tool, and
  mixer, plus pause/single-step/speed controls.

  **Layout is "full-bleed canvas + left tool rail + floating HUD + modals".** The sim canvas fills the
  mount minus the rail's strip on the left (`--rail-inset`; `fitCanvasWrap` measures `canvas-wrap`, not
  `bench`, so no bench pixel ever sits under the rail). The permanent chrome is the tool rail
  (`ui/tool-rail.ts`) down the left edge and two translucent strips (`ui/hud.ts`) hovering over the top and
  bottom edges — an active-tool readout, transport controls and a `⋯` bench menu up top; brush
  width/temperature and the temperature legend below. The strips are click-through except for the control
  clusters themselves, so the gap between them is still live canvas.

  The rail is one icon slot per tool (`ui/tool-icons.ts`, inline 24x24 stroked SVG drawn from
  `currentColor`), grouped TOOLS / GLASS / HEAT / FLOW, with the active slot wearing its tool's own swatch
  and each slot naming *and* explaining itself in a hover flyout (an icon rail is only readable if hovering
  an unfamiliar glyph says what the tool does, not just what it's called). It's also the canonical home for the UI-side `ToolKind`
  union. Under 860px of window height it drops the group captions and pairs slots two-wide, since 16 slots
  in one column need ~560px. Species are the one thing that can't have a slot *each* — there are 149 — so
  the Paint slot (second in the TOOLS group, between Select and Erase, since it's the tool used most
  rather than a category of its own) opens the Tool Chest (`ui/tool-chest.ts`), now purely the species
  picker, and renames itself to whichever species is loaded. The chest's body *is* the periodic table
  (`ui/periodic-table.ts` exports the picker — grid plus detail pane — separately from its modal shell for
  exactly this): pick an element, then one of the species it forms. The flat alphabetical species grid it
  replaced survives only as the search-results view, since a formula query like `CuSO4(aq)` has no element
  to hang off. The active tool's own settings are the one thing *not* behind a modal: `ui/side-panel.ts`'s
  builder is mounted permanently as the settings dock, a narrow card on the right edge opposite the rail,
  shown whenever the active tool has anything to configure (an Erase/Mix/Grab tool shows nothing rather
  than an empty card). It replaced a "⚙ Tool settings" button and the modal behind it, which put every
  per-tool control two clicks away and hid the fact that a tool had settings at all. The bench reserves
  the dock's strip the same way it reserves the rail's; `E` (or the header's » button) folds it away and
  gives that width back, leaving a single ⚙ tab to bring it back. The brush width/temperature sliders and
  the temperature legend live in it too, which is what let the bottom HUD strip be deleted outright —
  the dock has vertical room to spare and the sliders belong beside the rest of the active tool's
  settings, not in the opposite corner of the screen. Its long "HOW IT WORKS" explainers are
  collapsed disclosures now (`ui/dom.ts`'s `hintBox`), since a permanent panel can't afford a paragraph
  per tool. Everything else is still a modal over the canvas: the periodic table, the bench menu, and
  comfort settings. Keyboard: `T` species chest, `E` fold/unfold the settings dock, `M` bench menu,
  `Space` pause, `.` step, `Esc` closes the topmost modal. This
  replaced a docked 4-row toolbar card (`ui/toolbar.ts`, deleted) and a permanent 260px side-panel column,
  which between them left the canvas roughly a sixth of the window — and one bug: `mountApp` reused `#app`
  without clearing the `menu-screen` class the title screen sets on it, so `align-items: center`
  shrink-wrapped the whole bench to its content width.

  Tool-specific settings rebuild to match the selected tool: every tool gets a brush-width slider (the
  same `radius` used for paint/erase/stir/grab) — permanently in the HUD, so the settings dock
  suppresses its own copy — and the radiator tool additionally shows radiation-radius and
  target-temperature sliders, sent to the worker via a `paintRadiatorLine` message rather than the plain
  `paint` message — this
  replaced an earlier fixed toolbar radius slider plus a separate burner/coolant tool pair that injected
  heat at the cursor only while held down, and (later) a heater-glass/cooler-glass wall-material design;
  baking the target/radius into a per-cell overlay (`grid.radiatorRadius`/`radiatorTargetK`) captured once
  at paint time instead means a placed radiator keeps working for as long as it's on the grid, with no
  collision. A hover
  inspector panel is always active regardless of the selected tool (shows formula/wall label, temperature
  in K, and phase for the cell under the cursor) — probe isn't a separate selectable tool since hovering is
  unambiguous and doesn't compete with a click-drag tool the way paint/erase would. Reaction products can
  be any species in `species-data.ts`'s `SPECIES` array, including the non-`paintable` ones that never
  appear in the initial palette (e.g. the aqueous ions); the inspector falls back to `spec N` for those
  since the main thread only ever learns palette/wall labels from the worker, not the full static table.

## What's next (not yet built)

The static species/reaction table (`species-data.ts` + `reactions.ts`) replaced the earlier graph-search
chemistry engine; grid/movement, energy/conduction, and tools are unaffected and still in place. Gas
pressure and vessel bursting (`grid.n`, `pressure.ts`, `stepWallBurst`) were dropped entirely — Pixistry is
pixels of elements/compounds with a temperature, nothing more; walls are now indestructible since there's
no pressure to burst them with. Beyond that, what's left is the "deliberately deferred" list from the
historical design doc — organic chemistry/C-C chains, catalysis, momentum/velocity fields, pumps/vacuum/pH
meters/pipettes, WebGPU, a Rust/WASM port, and any objective/scoring/progression layer — none of which is
scheduled for v1. The one explicitly-called-out convenience feature still missing is prefab apparatus
stamps (beaker/flask/condenser as one-click wall shapes); these are pure convenience over player-drawn wall
cells, not new physics, so nothing in `src/sim` depends on them existing. Growing the reaction table itself
(more compounds, more rules) is now just data entry in `reactions.ts`/`species-data.ts` — no engine changes
required.
