# Implementation decisions: M1

This log captures decisions made *while implementing* `src/chem` that weren't (and often couldn't be)
resolved during the original design session — mostly gaps the design doc didn't anticipate, or places
where a first implementation attempt turned out to be wrong once tested against real reactions. For the
original design rationale, see [.grill/chem-ca-sim.md](.grill/chem-ca-sim.md). For where things live, see
[ARCHITECTURE.md](ARCHITECTURE.md).

Each entry: the problem discovered, what was decided, and why. Ordered roughly by when they came up
during the build.

---

**D1 — How does an ionic bond actually get proposed?**
The design doc establishes that `Bond.order = 0` means "ionic contact," but the original bonding-DFS
implementation only ever tried orders 1-3, so metal+nonmetal formation (Na+Cl→NaCl, Fe+S→FeS) was
silently unreachable — golden tests for these just returned "no reaction" every time.
**Decided:** split `enumerateBondGraphs` into two constructors based on group composition. All-nonmetal
groups use the valence-sum DFS (covalent). Any group containing both a metal and a nonmetal atom routes
to `enumerateIonicGraphs`, which tries combinations of each atom's `commonIonCharges` and keeps only
combinations that net to zero charge. This is also what makes Fe₂O₃ correctly come out as Fe³⁺ (not Fe²⁺)
with no reaction table — the charge-balance search naturally rejects the combination that doesn't sum to
zero.

**D2 — Can single atoms represent simple electron transfer without bonding?**
Displacement-style redox (Cu + Ag⁺ → Cu⁺ + Ag) doesn't form or break a bond at all — it's a charge
change on two otherwise-unbonded atoms. The original model had no way to represent this; a single atom's
candidate graph always preserved its input charge unchanged.
**Decided:** a lone atom's candidate set now includes its neutral form and every one of its
`commonIonCharges`, not just its input charge. Since this creates ambiguity across separate single-atom
groups in the same reaction, `computeBestPartition` cross-products every single-atom group's charge
candidates and keeps only the combinations whose *total* charge matches the reactants' total charge —
multi-atom groups don't need this (their net charge contribution is fixed regardless of which internal
isomer wins), so only single-atom groups pay this cost.

**D3 — Triple bonds and hypervalence.**
With ionic bonding and multi-charge candidates in place, N₂ + O₂ started coming out spontaneously
favorable at room temperature (deltaG ≈ -688 kJ/mol) — badly wrong, and exactly the case the design doc
calls out as needing to emerge as inert with no tuning. The cause: nitrogen's valence-5 option let an
already triple-bonded N atom *also* pick up an N=O double bond, producing a hypervalent structure with no
real analogue.
**Decided:** a brand-new triple bond may only form between two atoms that currently have zero bonds, and
once formed, blocks either atom from accepting anything else — regardless of what their nominal valence
list would otherwise allow. This is true for every real triple bond in v1's scope (N≡N, C≡C, C≡N, C≡O)
and fixed N₂+O₂ without any per-molecule special case.

**D4 — Bare ions need to price ionization, but not hydration.**
Plain bond-additivity never looked at an atom's charge, so `Cu → Cu²⁺` cost nothing — any reaction that
produced a charged fragment looked artificially cheap.
**Decided:** added a real per-element `IONIZATION_COST` table (cumulative ionization energy for cations,
electron-affinity-derived cost for anions — including that O's second electron affinity is endothermic).
A follow-up attempt also added Born hydration energy for any standalone charged atom, reasoning that a
bare ion in this simulation's ontology always means "aqueous ion." That broke H+H→H2: because hydrogen's
ionic radius is tiny, the hydration term made H⁺/H⁻ splitting look enormously favorable, so ordinary
covalent bond formation started losing to spurious ionization. **Hydration was reverted**; only
ionization cost remains. Net effect: single-displacement redox between metal ions only comes out right
when gas-phase ionization energy happens to already agree with real aqueous reduction-potential ordering
(true for an alkali metal displacing H⁺; false for close pairs like Cu/Ag⁺). This is a known, documented
v1 gap — see the comment above the relevant case in `golden-reactions.test.ts`. A real fix would need
hydration scoped specifically to species already identified as `Phase.Aqueous`, not applied
unconditionally to every charged atom encountered mid-search.

**D5 — Lattice energy needs to generalize across stoichiometries.**
A first implementation computed lattice energy as a literal per-ionic-bond-pair sum (one Born-Lande term
per Fe-O contact, etc.). This over-counted badly for non-1:1 salts — CaCl2 came out with roughly double
the lattice energy it should have, making it *look* less soluble than NaCl instead of comparably soluble.
**Decided:** switched to the Kapustinskii equation, which is parameterized directly by ion count per
formula unit rather than needing a structure-specific Madelung constant, so it generalizes cleanly across
NaCl (1:1), CaCl2 (1:2), etc. without needing per-compound tuning. A flat "covalent character" bonus
still applies for d-block metal halides (Fe/Cu/Zn/Ag), since pure ionic models are well known to
underestimate their real lattice energies (this is why AgCl stays insoluble in the model at all).

**D6 — Unimolecular decomposition needs to exclude "staying the same."**
`findBestPartition(a, null, T)` for a stable species like H₂ or O₃ always found "reform as the original
molecule" as its lowest-ΔG partition (correctly — that *is* the most stable arrangement of those atoms),
which meant metastable species could never surface their real, higher-energy decomposition products for
Evans-Polanyi to gate.
**Decided:** for unimolecular calls specifically, a single-product candidate whose formula matches the
original reactant is excluded from candidacy (formula-based, not exact-bond-graph-based, since an
override-driven species' ΔHf is identical for any isomer with the same formula anyway). This is what
makes H2O2→2OH, O3→O2+O, and Cl2→2Cl surface their real fragmentation products instead of the trivially
"nothing changed" answer.

**D7 — Formula strings use strict Hill notation, not conventional formula writing.**
Override lookup needs a stable, mechanically-derivable key. Conventional chemical formula writing
(cation-first for ionic compounds, "traditional" element ordering for others) isn't mechanically
consistent enough to derive from an atom multiset alone without a lot of special-casing.
**Decided:** use the actual Hill system rule throughout (carbon first + hydrogen second only when carbon
is present, otherwise strict alphabetical) — the same convention cheminformatics tools like PubChem use
internally. This deliberately produces unfamiliar-looking keys (NaCl → `"ClNa"`, HCl → `"ClH"`,
NH3 → `"H3N"`), which is fine since these are never meant as display text, only as a stable key.

**D8 — Overrides merge field-by-field, not whole-object.**
The design doc's literal phrasing (`OVERRIDES[formula] ?? estimated`) implies an all-or-nothing swap.
**Decided:** implemented as a per-field merge instead (`{ ...estimated, ...override }`) — a curated entry
can supply just the fields that matter (e.g. only `boilingPointC` for water-precision) without having to
also hand-author density/dipole/etc. for the same species, while still guaranteeing any measured value
present wins.
