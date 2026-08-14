// Campaign scenario data -- plain hand-authored data, same philosophy as
// species-data.ts/reactions.ts: authoring a level is data entry, not engine
// work (see .grill/campaign-mode.md's §3). scenario.ts turns a Scenario's
// `setup` into real grid state and enforces `rules` in the worker;
// objectives.ts turns `goals` into live progress, pure and gridless.
import type { WallKind } from './walls';
import { SinkMaskValue } from './grid';
import { SpeciesId } from './species-data';
import type { FlaskFacing, FlaskKind } from './flask-shapes';
import type { FunnelFacing } from './apparatus-shapes';

/** Mirrors the Tool Chest's apparatus tool set (see src/ui/tool-chest.ts's
 * ToolKind) but lives in src/sim, not src/ui: worker.ts (sim layer) is what
 * actually enforces `Restrictions.tools` against incoming messages, and sim
 * must not depend on ui (see ARCHITECTURE.md). 'paint' isn't a member here
 * since manual spawning is gated per-species by `paintSpecies`, not as a
 * single on/off tool. */
export type ToolKind = 'erase' | 'grabber' | 'mixer' | 'radiator' | 'stirrer' | 'funnel' | 'tube' | 'filter' | 'sink' | 'vent' | 'catalyst' | 'flask';

/** What a scenario stamps onto a fresh bench before the player touches
 * anything -- built out of primitives that already exist (grid.set,
 * stampGlass, sink.ts's sinkLineCells, placeFunnelInstance), see
 * scenario.ts's applyScenarioSetup. 'wallLine' reuses sink.ts's
 * sinkLineCells Bresenham (rather than a second hand-rolled line rasterizer)
 * against a wall specId instead of the sink mask. 'funnel' ships with an
 * explicit `enabled` flag (unlike the interactive placeFunnel message, whose
 * instance always starts disabled until a player opts in) because Tier 3's
 * continuous-process scenarios need their pre-plumbed feed already dripping
 * the moment the bench loads -- there's no player action to enable it. */
export type SetupCommand =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly specId: number; readonly tempC?: number }
  | { readonly kind: 'wallRect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly wall: WallKind }
  | { readonly kind: 'wallLine'; readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number; readonly width: number; readonly wall: WallKind }
  | {
      readonly kind: 'flask';
      readonly x: number;
      readonly y: number;
      readonly facing: FlaskFacing;
      readonly sizeScale: number;
      readonly stirred: boolean;
      /** Which piece of glassware -- defaults to the Erlenmeyer, which is
       * what every scenario authored before the beaker existed means. */
      readonly glassware?: FlaskKind;
    }
  | {
      readonly kind: 'funnel';
      readonly x: number;
      readonly y: number;
      readonly facing: FunnelFacing;
      readonly specId: number;
      readonly ratePerMinute: number;
      readonly total: number | null;
      readonly enabled: boolean;
    }
  | { readonly kind: 'radiator'; readonly x: number; readonly y: number; readonly radius: number; readonly targetTempC: number }
  /** A pre-placed collection port. `port` defaults to a Sink; pass
   * SinkMaskValue.Vent for a waste port (see grid.ts's SinkMaskValue). */
  | {
      readonly kind: 'sink';
      readonly x0: number;
      readonly y0: number;
      readonly x1: number;
      readonly y1: number;
      readonly width: number;
      readonly port?: SinkMaskValue;
    }
  /** A pre-painted catalyst pad (see grid.ts's catalystStrength) --
   * `strength` is the whole-number reaction-rate multiplier, `radius` the
   * painted brush area. Unlike 'radiator', whose radius doubles as each
   * cell's own radiation reach, a catalyst cell only ever affects reactions
   * happening on itself, so a large radius here is just a large pad, not a
   * per-cell cost multiplier. */
  | { readonly kind: 'catalyst'; readonly x: number; readonly y: number; readonly radius: number; readonly strength: number };

/** What the player is allowed to do during a scenario -- enforced worker-
 * side (see scenario.ts's isPaintAllowed/isFunnelSpeciesAllowed/
 * isToolAllowed), not just hidden in the UI, so a UI bug or a devtools call
 * can't silently let a level be "won" without solving it. `reagentBudget` is
 * typed here per the design doc but deliberately unenforced for now -- see
 * .grill/campaign-mode.md §9's decision #4, "deferred past the first cut". */
export interface Restrictions {
  readonly paintSpecies: readonly number[] | 'all' | 'none';
  readonly tools: readonly ToolKind[] | 'all';
  readonly funnelSpecies: readonly number[] | 'none';
  readonly reagentBudget?: Readonly<Record<number, number>>;
}

export type Goal =
  | { readonly kind: 'collect'; readonly specId: number; readonly amount: number }
  | { readonly kind: 'collectAny'; readonly specIds: readonly number[]; readonly amount: number }
  | { readonly kind: 'rate'; readonly specId: number; readonly perSecond: number; readonly sustainSeconds: number }
  | { readonly kind: 'purity'; readonly specId: number; readonly minFraction: number }
  | { readonly kind: 'limit'; readonly specId: number; readonly max: number }
  /** A ceiling on what the player's *Vents* have thrown away, as opposed to
   * 'limit's ceiling on what their Sinks collected (see grid.ts's
   * SinkMaskValue). A separate kind rather than a `source` flag on 'limit'
   * so the two can't be confused at an authoring site: 'limit' means "don't
   * let this end up in your product", 'ventLimit' means "don't dump this
   * much of it into the room". */
  | { readonly kind: 'ventLimit'; readonly specId: number; readonly max: number }
  | { readonly kind: 'maxTempK'; readonly limitK: number };

export interface ScenarioPar {
  readonly seconds?: number;
  readonly reagentPixels?: number;
}

export interface Scenario {
  readonly id: string;
  readonly title: string;
  readonly blurb: string;
  /** 2-4 short lines shown on entry (the briefing card). */
  readonly briefing: readonly string[];
  /** Progressive, 3 levels, last is near-solution -- see
   * .grill/campaign-mode.md's point 11: being stuck with no path forward is
   * where this audience quits. */
  readonly hints: readonly string[];
  /** Shown on win -- "this is how it's really made". */
  readonly fact: string;
  readonly setup: readonly SetupCommand[];
  readonly rules: Restrictions;
  readonly goals: readonly Goal[];
  readonly par?: ScenarioPar;
}

const S = SpeciesId;

// Scenarios 1, 4, and 7 from the ladder in .grill/campaign-mode.md's §7 --
// the plan's "recommended first cut": one plain synthesis, one dissolution,
// and one acid+metal gas-generation, each a single reaction with a generous
// collect goal. Phase 7 fills in the rest of the ladder (#5, #6, #8-14, #17)
// -- see the build-order table's Phase 7 note for which of #15/#16/#18 were
// deliberately deferred and why.
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'table-salt',
    title: 'Table Salt',
    blurb: 'Make 100 pixels of salt from sodium and chlorine.',
    briefing: [
      'Sodium metal and chlorine gas react the instant they touch -- no heat needed.',
      'Paint a patch of each onto the bench, right next to each other.',
      'Draw a Sink somewhere the salt will land, to collect and count it.',
    ],
    hints: [
      'Paint Na, then paint Cl2 right beside it so they share an edge.',
      'More shared edge between the two patches means faster salt.',
      'Draw the Sink under the reaction so falling NaCl lands on it and gets counted.',
    ],
    fact: 'Na + Cl2 -> 2 NaCl is the reaction that makes the salt in your kitchen shaker.',
    setup: [],
    rules: { paintSpecies: [S.Na, S.Cl2], tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.NaCl, amount: 100 }],
    par: { seconds: 60 },
  },
  {
    id: 'dissolve-it',
    title: 'Dissolve It',
    blurb: 'Dissolve 80 pixels of salt into water.',
    briefing: [
      'Solid NaCl sitting in water slowly dissolves into NaCl(aq).',
      "There's already a pool of water on the bench.",
      'Drop salt into the pool, then sink the dissolved product.',
    ],
    hints: [
      'Paint NaCl so it falls into the blue water pool.',
      'Dissolving takes a few ticks per pixel -- give it a moment.',
      'Put the Sink inside the pool so it only counts NaCl(aq), not solid salt still sinking through.',
    ],
    fact: 'Table salt dissolves because water molecules pull the Na+ and Cl- ions apart from the crystal.',
    setup: [{ kind: 'rect', x: 40, y: 60, w: 80, h: 30, specId: S.H2O, tempC: 21 }],
    rules: { paintSpecies: [S.NaCl], tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.NaClAq, amount: 80 }],
    par: { seconds: 90 },
  },
  {
    id: 'hydrogen-factory',
    title: 'Hydrogen Factory',
    blurb: 'Collect 150 pixels of hydrogen gas from zinc and acid.',
    briefing: [
      "Zinc metal dropped into hydrochloric acid fizzes -- that's H2 gas coming off.",
      "There's a glass tank with a pool of HCl(aq) already on the bench.",
      'Hydrogen is light and rises, so put your Sink near the top of the tank.',
    ],
    hints: [
      'Paint Zn so it falls into the pool of HCl(aq).',
      'Watch the bubbles of H2 rise off the surface.',
      'A Sink line near the top of the tank catches the rising gas before it escapes.',
    ],
    fact: 'Zn + 2 HCl -> ZnCl2 + H2 is a classic lab prep for hydrogen gas.',
    setup: [
      { kind: 'wallRect', x: 30, y: 30, w: 60, h: 55, wall: 'glass' },
      { kind: 'rect', x: 32, y: 60, w: 56, h: 23, specId: S.HClAq, tempC: 21 },
    ],
    rules: { paintSpecies: [S.Zn], tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.H2, amount: 150 }],
    par: { seconds: 120 },
  },

  // Ladder #5 (Tier 1's last entry): NaCl dissolves, AgCl doesn't -- the
  // Filter tool is what lets the player keep the undissolved AgCl solid out
  // of the sink while the dissolved NaCl(aq) passes through. Order matters
  // here, confirmed by browser playtesting: a filter placed BEFORE the
  // reagents go in blocks AgCl the moment it tries to sink past, leaving it
  // stacked cleanly above the line, while NaCl(aq) trickles through to the
  // sink below -- painting first and filtering after lets both settle into
  // the same overlapping rows at the tank floor before the filter exists,
  // where a single horizontal line can no longer cleanly separate them.
  {
    id: 'wont-dissolve',
    title: "The One That Won't Dissolve",
    blurb: "Collect dissolved salt without collecting the solid that refuses to dissolve.",
    briefing: [
      'NaCl dissolves in water. AgCl looks similar, but it never does -- it just sits there as a solid.',
      "There's a tank of water waiting.",
      'A Filter line only lets chosen species pass -- set one up before you add the salts, so solid AgCl gets stuck above it.',
    ],
    hints: [
      'Draw a Filter line across the tank first, then paint your reagents in above it.',
      "Open the filter's side panel and allow only NaCl(aq) through -- nothing else should pass.",
      'Draw the Sink just below the filter line, so it only ever catches what the filter let through.',
    ],
    fact: 'AgCl is famously insoluble -- it stays solid in water, which is exactly why it makes such a clean precipitate.',
    setup: [
      { kind: 'wallRect', x: 30, y: 25, w: 70, h: 60, wall: 'glass' },
      { kind: 'rect', x: 32, y: 55, w: 66, h: 28, specId: S.H2O, tempC: 21 },
    ],
    rules: { paintSpecies: [S.NaCl, S.AgCl], tools: ['erase', 'sink', 'filter'], funnelSpecies: 'none' },
    goals: [
      { kind: 'collect', specId: S.NaClAq, amount: 60 },
      { kind: 'limit', specId: S.AgCl, max: 0 },
    ],
    par: { seconds: 150 },
  },

  // Ladder #6: a two-step chain -- CaO hydrolyzes to limewater, then CO2
  // bubbled through it turns milky with CaCO3. CO2 isn't directly paintable
  // (species-data.ts), so a pre-plumbed, always-on funnel stands in for
  // "bubbling gas through" rather than the player painting it by hand.
  // Playtesting an earlier open-bench version of this setup found the CO2
  // just drifting away across the whole 160x100 grid instead of reaching the
  // pool -- a gas needs a container to actually bubble THROUGH a liquid
  // rather than escape sideways, same as every other gas-involving scenario
  // that already uses a glass tank ('hydrogen-factory', 'copper-etch').
  {
    id: 'limewater-test',
    title: 'Limewater Test',
    blurb: 'Turn limewater milky by bubbling carbon dioxide through it.',
    briefing: [
      'Quicklime (CaO) dropped in water makes limewater -- Ca(OH)2 dissolved in solution.',
      "There's a sealed tank with a CO2 line already bubbling gently over the pool.",
      'Bubble CO2 through limewater and it turns milky white with solid CaCO3.',
    ],
    hints: [
      'Paint CaO into the water pool to make limewater first.',
      "The CO2 funnel above is already dripping -- just give it time to bubble through.",
      'Sink the milky CaCO3 that forms and settles.',
    ],
    fact: 'Bubbling CO2 through limewater is the classic school-lab test for carbon dioxide gas.',
    setup: [
      { kind: 'wallRect', x: 35, y: 20, w: 90, h: 72, wall: 'glass' },
      { kind: 'rect', x: 40, y: 60, w: 80, h: 30, specId: S.H2O, tempC: 21 },
      // 'up'-facing and anchored near the pool floor -- gas in this sim
      // always rises (movement.ts's moveRising), so a 'down'-facing funnel
      // dripping from above the pool would just immediately rise straight
      // back toward the ceiling without ever touching the water at all
      // (confirmed by an earlier playtest of exactly that). Anchoring low
      // and facing up means the CO2 spawns near the pool floor and has to
      // rise up through the whole water column to escape -- real bubbling.
      { kind: 'funnel', x: 80, y: 89, facing: 'up', specId: S.CO2, ratePerMinute: 90, total: null, enabled: true },
    ],
    rules: { paintSpecies: [S.CaO], tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.CaCO3, amount: 60 }],
    par: { seconds: 150 },
  },

  // Ladder #8: two gases that neither dissolve nor need water -- NH3 and HCl
  // combine directly into solid NH4Cl smoke. Neither gas is directly
  // paintable (species-data.ts). Gas always rises in this sim (movement.ts's
  // moveRising) -- 'salt-line' playtesting found that two funnels dripping
  // gas toward each other from above is fragile (each stream mostly rises
  // straight back up past its own spout rather than falling to meet the
  // other) and that even a solid+gas pairing needs zero headspace above it
  // or the gas just rises away and abandons contact entirely. Two large
  // static gas blocks side by side in a sealed, zero-headspace tank -- the
  // fix that actually worked for 'salt-line' -- applies the same way here:
  // neither NH3 nor HCl has anywhere to rise to, so they stay pinned in
  // contact at their shared boundary the whole time.
  {
    id: 'white-smoke',
    title: 'White Smoke',
    blurb: 'Make solid smoke by combining two gases.',
    briefing: [
      'Ammonia gas and hydrogen chloride gas react on contact -- no water needed at all.',
      "There's a sealed chamber with both gases already packed in, side by side.",
      'Watch the white smoke of NH4Cl form and fall where the two gases meet.',
    ],
    hints: [
      "You can't paint anything here -- the gases are already in place and already reacting.",
      'NH4Cl is a solid, so it falls once it forms -- put your sink at the bottom of the chamber.',
      'Use Run Test to fast-forward and see how much has collected.',
    ],
    fact: 'NH3 + HCl -> NH4Cl is the classic "white smoke" demo -- two invisible gases making a visible solid.',
    setup: [
      { kind: 'wallRect', x: 40, y: 15, w: 80, h: 80, wall: 'glass' },
      { kind: 'rect', x: 41, y: 16, w: 19, h: 78, specId: S.NH3, tempC: 21 },
      { kind: 'rect', x: 60, y: 16, w: 19, h: 78, specId: S.HCl, tempC: 21 },
    ],
    rules: { paintSpecies: 'none', tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.NH4Cl, amount: 100 }],
    par: { seconds: 120 },
  },

  // Ladder #9: precipitation, originally paired with a purity goal.
  // Playtesting found layered problems trying to hit 90% purity: (1) plain
  // density settling doesn't separate AgCl cleanly from the similarly-dense
  // NaNO3(aq)/leftover NaCl(aq)/AgNO3 around it -- a sink at the pool floor
  // caught barely 20% AgCl by volume; tried fixing this the same way
  // 'wont-dissolve' was, with the Filter tool. (2) An open-bench pool (no
  // walls) has no fixed floor for the filter's position to stay meaningful
  // against -- fixed with a sealed tank. (3) Even sealed, a filter+sink
  // drawn inside the pool's own initial footprint still failed: a filter
  // only gates NEW matter trying to *move* into a cell, it doesn't
  // retroactively evict water that's already resident there from setup.
  // (4) Tried leaving empty headroom below a shorter pool for the filter to
  // sit in -- but liquid in a sealed tank floods every connected empty cell
  // within the tank almost immediately (confirmed by pausing right on load
  // and dumping the grid: the "empty" buffer was already fully flooded
  // within ~10 sim-seconds, well before any script or player could react),
  // so there's no way to keep a buffer zone genuinely empty for the filter
  // to protect. Painting far more AgCl and re-checking confirmed purity
  // does dilute upward with volume, just far too slowly to be practical
  // (140 collected only reached 12%; hitting 90% would need roughly 9000+).
  // A `collect` goal alone is what's left once the purity mechanic doesn't
  // hold up -- see §9 Decisions.
  {
    id: 'photo-paper',
    title: 'Photo Paper',
    blurb: 'Precipitate silver chloride from two dissolved salts.',
    briefing: [
      'Silver nitrate and table salt, both dissolved in water, swap partners: you get AgCl and NaNO3.',
      "There's a deep pool of water on the bench.",
      'AgCl is insoluble -- it precipitates out and sinks. Collect it.',
    ],
    hints: [
      'Paint AgNO3 and NaCl into the pool so they dissolve.',
      'The white AgCl precipitate settles toward the bottom of the pool.',
      'Sink the settled solid at the bottom.',
    ],
    fact: 'AgNO3(aq) + NaCl(aq) -> AgCl + NaNO3(aq) is literally how light-sensitive silver chloride was made for photographic paper.',
    setup: [{ kind: 'rect', x: 40, y: 55, w: 80, h: 35, specId: S.H2O, tempC: 21 }],
    rules: { paintSpecies: [S.NaCl, S.AgNO3], tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.AgCl, amount: 50 }],
    par: { seconds: 150 },
  },

  // Ladder #10: SO2 dissolving straight into water, same one-reaction-one-
  // pool shape as 'dissolve-it', just with a gas reagent instead of a solid.
  {
    id: 'acid-rain',
    title: 'Acid Rain',
    blurb: 'Dissolve sulfur dioxide gas into water to make acid rain.',
    briefing: [
      'Sulfur dioxide gas dissolves straight into water to make sulfurous acid.',
      "There's a sealed tank with a pool of water in it.",
      'Paint SO2 into the pool so it dissolves.',
    ],
    hints: [
      'Paint SO2 straight into the water, not above it -- gas always rises in this sim, so painting it above just lets it escape.',
      'Dissolving takes a few ticks per pixel, same as any other dissolution.',
      'Sink the H2SO3(aq) once it forms in the pool.',
    ],
    // Gas always rises in this sim (movement.ts's moveRising). Two earlier
    // versions of this scenario failed playtesting: (1) wall-less, SO2
    // painted into the water rose straight up through it and out the open
    // top of the grid before dissolving much at all -- confirmed by dumping
    // the grid, none left in the pool. (2) A sealed tank with headspace
    // above the pool didn't fully fix it either -- SO2 painted mid-pool
    // still had enough clearance to rise straight through the water column
    // and pin itself against the tank ceiling, just above the water instead
    // of in it, with 0.3 probability/tick not being enough for it to react
    // on the way past. Zero headspace (same fix 'salt-line'/'white-smoke'
    // needed) -- the tank's interior exactly matches the pool's footprint,
    // so SO2 has nowhere to rise TO at all and stays trapped in the water
    // until it reacts.
    fact: 'SO2 + H2O -> H2SO3(aq) is the real chemistry behind acid rain from industrial sulfur emissions.',
    setup: [
      { kind: 'wallRect', x: 39, y: 59, w: 82, h: 32, wall: 'glass' },
      { kind: 'rect', x: 40, y: 60, w: 80, h: 30, specId: S.H2O, tempC: 21 },
    ],
    rules: { paintSpecies: [S.SO2], tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.H2SO3Aq, amount: 80 }],
    par: { seconds: 120 },
  },

  // Tier 3 begins here: continuous-process scenarios with paintSpecies:
  // 'none' -- the player builds nothing but a sink under a pre-plumbed,
  // already-dripping feed, and either watches it run or uses Run Test to
  // fast-forward. Ladder #11: sustained throughput, the simplest possible
  // Tier 3 shape (one instant reaction, no heat, no chain).
  {
    id: 'salt-line',
    title: 'Salt Line',
    blurb: 'Run a big sodium/chlorine reactor and collect the salt it makes.',
    briefing: [
      "This is a production line, not a one-off: two big reservoirs of sodium and chlorine are already sitting side by side, already reacting.",
      'Your only job is to catch the salt as it forms and falls.',
      'Collect 200 pixels of NaCl.',
    ],
    hints: [
      "You can't paint anything here -- the reservoirs are already in place and already reacting.",
      'Draw a wide Sink across the bottom of the chamber to catch NaCl as it settles.',
      'Use Run Test to fast-forward through the slow parts.',
    ],
    fact: 'A real chlor-alkali salt plant works the same way: continuous feed in, continuous product out.',
    // Originally authored against the ladder's literal "sustain 10 NaCl/s
    // for 30s" -- a `rate` goal. Four setups were tried and playtested:
    // (1) two opposing funnels (gas always rises in this sim -- movement.ts's
    // moveRising -- so Cl2 had to be 'up'-facing and anchored low to meet
    // falling Na) flooded the whole sealed tank with gas faster than Na could
    // react it away, choking Na's own spawn point; (2) two large static
    // blocks side by side (like 'table-salt' at bigger scale) reacted
    // heavily but produced NaCl "in place" within the packed lattice, mostly
    // not falling anywhere a sink could reach; (3) a sink placed directly on
    // that reaction boundary backfired even harder -- it also consumes
    // un-reacted Na/Cl2 sitting on the same cells (no way to distinguish
    // "product" from "reagent that hasn't reacted yet"), permanently
    // severing the boundary into a gap solids can't refill sideways; (4) a
    // Na funnel raining continuously through an open shaft in a static Cl2
    // reservoir seemed promising (Na actually falls, sweeping past fresh Cl2
    // the whole way down) but the shaft itself doesn't stay open -- Cl2's
    // own lateral gas-spread eventually fills it in, and stepFunnels
    // (funnel.ts) refuses to drip into a non-empty spawn cell, so production
    // silently stalled once that happened. What DOES reliably work (setup
    // #2 below, kept) is a real, honestly-measured 'collect' goal instead of
    // 'rate': production comes in a strong initial burst as the two blocks
    // first meet, then tapers off as the reaction front moves deeper into
    // each block -- great for a large one-off total, not a steady per-second
    // rate a sink can sustain indefinitely. See §9 Decisions for the
    // scope call.
    setup: [
      { kind: 'wallRect', x: 40, y: 15, w: 80, h: 80, wall: 'glass' },
      { kind: 'rect', x: 41, y: 16, w: 19, h: 78, specId: S.Na, tempC: 21 },
      { kind: 'rect', x: 60, y: 16, w: 19, h: 78, specId: S.Cl2, tempC: 21 },
    ],
    rules: { paintSpecies: 'none', tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.NaCl, amount: 200 }],
    par: { seconds: 120 },
  },

  // Ladder #12: another sustained-rate Tier 3 scenario, this time hydrating
  // SO3 straight into H2SO4(aq) -- the sim has no SO2->SO3 oxidation rule
  // (reactions.ts), so SO3 itself is the fed reagent rather than building it
  // up from sulfur, same "funnel supplies what the table can't synthesize
  // on-grid" approach 'limewater-test'/'white-smoke' use for their gases.
  // Originally authored against the ladder's literal "sustain 8/s for 20s"
  // -- a `rate` goal. Playtesting found the same problem 'salt-line' hit:
  // a sink placed anywhere in the pool inevitably touches bulk unreacted
  // H2O too (it has no way to distinguish "product" from "reactant sitting
  // on the same cell"), draining the whole finite pool in well under a
  // minute -- production peaked briefly around 2/s right after the sink
  // went in, then collapsed to 0 once the water ran out, never sustaining
  // anywhere near 8/s for a full 20 seconds. A `collect` goal instead
  // honestly measures what this setup actually does well: react a lot of
  // SO3 into product given enough time, not hold a steady per-second rate
  // indefinitely. See §9 Decisions.
  {
    id: 'contact-process',
    title: 'Contact Process',
    blurb: 'Run a continuous sulfuric acid reactor and collect the product.',
    briefing: [
      'Sulfur trioxide reacts with water to make sulfuric acid -- strongly, and continuously here.',
      "There's a pool of water with an SO3 line already feeding into it.",
      'Collect 120 pixels of H2SO4(aq).',
    ],
    hints: [
      "Nothing to paint -- the SO3 feed above the pool is already running.",
      'H2SO4(aq) is denser than water and settles toward the bottom -- put your sink there.',
      'Run Test fast-forwards 30 seconds at once, and you can run it more than once.',
    ],
    fact: "The real Contact Process is how the vast majority of the world's sulfuric acid is made.",
    setup: [
      { kind: 'rect', x: 40, y: 55, w: 80, h: 35, specId: S.H2O, tempC: 21 },
      { kind: 'funnel', x: 80, y: 35, facing: 'down', specId: S.SO3, ratePerMinute: 600, total: null, enabled: true },
    ],
    rules: { paintSpecies: 'none', tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.H2SO4Aq, amount: 120 }],
    par: { seconds: 90 },
  },

  // Ladder #13: the Haber process -- slow (probability 0.1) and gated on
  // minTempK: 700, so this is the one Tier 3 scenario that also needs
  // sustained heat. An earlier version fed N2/H2 through two 'down'-facing
  // funnels into a stirred flask below -- broken the same way the first
  // 'salt-line'/'white-smoke' attempts were: gas always rises in this sim
  // (movement.ts's moveRising), so both gases would just rise straight back
  // up past their own spouts instead of falling into the flask. Two large
  // static gas blocks in a sealed, zero-headspace tank -- the pattern that
  // actually held up for 'salt-line'/'white-smoke' -- works here too, with
  // radiators covering the whole interior to hold it above the 700 K
  // ignition floor -- one giant radius-45 radiator was tried first and
  // playtesting found it tanked the tick rate to a crawl (every one of the
  // ~6000 cells it painted became its own independent 45-cell-reach source,
  // re-radiating every tick); several small ones spread through the chamber
  // fix that. Since the product NH3 is *also* a gas (unlike 'white-smoke's
  // solid NH4Cl, which falls to a sink on its own), there's no settling
  // layer to exploit -- reactant and product gas all stay packed together
  // wherever they formed, uniformly through the whole sealed interior.
  // Playtesting confirmed a single sink line (even a wide one) barely
  // catches any of it, since only whatever happens to be sitting in that
  // exact row ever touches it -- several sink lines spread through the
  // chamber's height (matching the radiator spacing) is what actually
  // finished the scenario.
  {
    id: 'haber-plant',
    title: 'Haber Plant',
    blurb: 'Hold a hot reactor steady long enough to make ammonia.',
    briefing: [
      'N2 + H2 -> NH3 only happens above 700 K, and even then it takes patience.',
      "There's a sealed, superheated chamber already packed with nitrogen and hydrogen.",
      'Collect 100 pixels of NH3 -- a Catalyst Pad will make this far less of a wait.',
    ],
    hints: [
      "You can't paint anything here -- the chamber is already loaded and already hot.",
      "NH3 forms throughout the packed gas, not just at the bottom -- one Sink line barely catches any of it.",
      'Paint Catalyst Pads over the chamber and draw several Sink lines spread top to bottom, then lean on Run Test.',
    ],
    fact: "The real Haber process runs at even higher pressure and temperature over an iron catalyst -- it's how most of the world's nitrogen fertilizer is made.",
    // A single big 'radiator' command (matching the interactive tool's own
    // brush) stamps its `radius` onto BOTH the painted area AND each
    // resulting cell's own individual radiation reach (applyRadiator, see
    // scenario.ts) -- a radius of 45 covering the whole chamber meant ~6000
    // cells each independently radiating 45 cells outward every tick, which
    // playtesting found tanked the tick rate to a crawl (a handful of ticks
    // per real second instead of 60). Several small radiators spread through
    // the chamber -- matching how a player would actually paint a radiator
    // interactively -- heat the same volume for a small fraction of the cost.
    setup: [
      { kind: 'wallRect', x: 40, y: 15, w: 80, h: 80, wall: 'glass' },
      { kind: 'rect', x: 41, y: 16, w: 19, h: 78, specId: S.N2, tempC: 21 },
      { kind: 'rect', x: 60, y: 16, w: 19, h: 78, specId: S.H2, tempC: 21 },
      { kind: 'radiator', x: 50, y: 24, radius: 8, targetTempC: 450 },
      { kind: 'radiator', x: 50, y: 40, radius: 8, targetTempC: 450 },
      { kind: 'radiator', x: 50, y: 56, radius: 8, targetTempC: 450 },
      { kind: 'radiator', x: 50, y: 72, radius: 8, targetTempC: 450 },
      { kind: 'radiator', x: 50, y: 88, radius: 8, targetTempC: 450 },
    ],
    // The Catalyst Pad is granted but deliberately NOT pre-placed: this is
    // the one scenario on the ladder whose point is catalysis, so painting
    // the pad has to be the player's own move. Headless measurement over a
    // fixed 3600-tick (60s) window with the same sink layout throughout:
    // no pad 33 NH3, 2x pad 53, 5x pad 76, 10x pad 118. So the goal of 100
    // stays reachable without a pad (par is 180s, three times that window)
    // but is a slog -- exactly the "tedious -> satisfying" gap
    // .grill/campaign-mode.md's §6 point 16 wanted the pad to close, rather
    // than the pad being required to win at all.
    rules: { paintSpecies: 'none', tools: ['erase', 'sink', 'catalyst'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.NH3, amount: 100 }],
    par: { seconds: 180 },
  },

  // Ladder #14: copper dissolving in nitric acid, the classic brown-fumes
  // demo. The ladder's own text says "vent <= 30 NO2", but a dedicated Vent
  // apparatus (a second sink kind that counts toward failure instead of a
  // goal) doesn't exist yet -- .grill/campaign-mode.md's own §6 point 12
  // lists it as a Phase 8 "optional new toy," not something Phase 7's
  // content pass should build. A purity goal was also tried and dropped for
  // the same reason 'photo-paper's was: no Filter tool here either, and a
  // plain sink at the pool floor dilutes with unrelated leftover HNO3(aq)
  // the same way.
  //
  // Phase 8 built the Vent and re-examined that "vent <= 30 NO2" goal with
  // it in hand -- and measurement says the ladder's constraint is not a real
  // one *here*, so it deliberately still isn't wired. Driving this scenario
  // headlessly (six rounds of painting Cu into the column, 600 ticks each,
  // sink under the column) with and without a ceiling-wide Vent: 19
  // CuNO32Aq collected and 0 NO2 vented without, 18 collected and 11 NO2
  // vented with, and either way *zero* NO2 left anywhere on the grid at the
  // end. The reason is chemistry already in the table: NO2 + H2O ->
  // HNO3(aq) + NO (reactions.ts) re-absorbs the fumes into the very water
  // the etch reaction produces alongside them, so NO2 can never pile up in
  // this open tank. A 'ventLimit' of 30 would therefore be unfailable, and
  // venting buys the player nothing -- a decorative constraint, which is
  // exactly what §9's decision 9 says not to ship. See the Phase 8
  // build-order note for where the Vent does earn its place.
  //
  // Playtesting found something more fundamental, though: react.ts's
  // tryReact only places a reaction's *n*th product past the 2 reactant
  // cells by finding an EMPTY neighbor of the reacting pair (findEmptyNeighbor,
  // checking just the 8 cells around the pair) -- and this reaction has 3
  // products (CuNO32Aq + NO2 + H2O) from 2 reactants. A solid pool of
  // HNO3(aq) completely filling its container, with Cu settled into a dense
  // pile at the bottom, has NO empty neighbor anywhere near where the
  // reaction would happen -- confirmed by a burst that produced a flat 0
  // over a fresh 30-second window despite the pile clearly being in
  // contact with the acid throughout. This isn't fixable by waiting longer;
  // it needs actual empty pockets near the reacting surface. A narrower
  // acid column with open tank space on both sides (instead of one solid
  // wall-to-wall pool) gives the settling Cu pile's sides real empty
  // neighbors to place NO2/H2O into, which a burst confirmed produces
  // real, if still modest, output -- the goal amount here is sized to that,
  // not to the ladder's original 60.
  {
    id: 'copper-etch',
    title: 'Copper Etch',
    blurb: 'Dissolve copper in nitric acid.',
    briefing: [
      'Copper dropped into nitric acid dissolves -- with a rush of brown NO2 fumes.',
      "There's a tank with a narrow column of nitric acid, open on both sides.",
      'Collect the dissolved copper solution.',
    ],
    hints: [
      'Paint Cu into the acid column and watch the brown fumes rise off it.',
      "It'll slow down once the copper settles -- paint a bit more in when that happens instead of waiting.",
      'Sink low in the tank, under the acid column, to catch the dissolved copper as it settles.',
    ],
    fact: 'Cu + 4 HNO3 -> Cu(NO3)2 + 2 NO2 + 2 H2O is why nitric acid, unlike HCl or H2SO4, can dissolve copper at all.',
    setup: [
      { kind: 'wallRect', x: 30, y: 25, w: 70, h: 60, wall: 'glass' },
      { kind: 'rect', x: 55, y: 40, w: 10, h: 43, specId: S.HNO3Aq, tempC: 21 },
    ],
    rules: { paintSpecies: [S.Cu], tools: ['erase', 'sink'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.CuNO32Aq, amount: 15 }],
    par: { seconds: 180 },
  },

  // Ladder #17 (Tier 4, freeplay puzzle): route a single pre-dropped pixel
  // across the bench using only tubes. Skips #15 (needs reagentBudget
  // enforcement, currently unbuilt -- see §9 Decisions) and #16 (needs a
  // temperature-floor/range Goal kind that doesn't exist yet) in the ladder
  // numbering; #18's "daily challenge" is a random-scenario generator/menu
  // mode, not static content, and is deferred alongside them -- see the
  // build-order table's Phase 7 note.
  {
    id: 'rube-goldberg',
    title: 'Rube Goldberg',
    blurb: 'Deliver a single pixel across the bench using nothing but tubes.',
    briefing: [
      "One pixel of iron just dropped onto the bench, over on the left.",
      'The sink is already waiting for it, over on the right.',
      'The only tool you have is the Tube -- build a path to deliver it.',
    ],
    hints: [
      'The iron pixel already fell and is resting on the floor near where it dropped.',
      'Place a tube with one end at the iron and drag its other end toward the sink.',
      "A tube's mouth only picks up what's right at its opening -- line it up carefully.",
    ],
    fact: "Tubes here work like a real pneumatic conveyor -- matter only moves through where a mouth's suction cone actually reaches.",
    setup: [
      { kind: 'funnel', x: 20, y: 30, facing: 'down', specId: S.Fe, ratePerMinute: 3600, total: 1, enabled: true },
      { kind: 'sink', x0: 138, y0: 95, x1: 150, y1: 95, width: 2 },
    ],
    rules: { paintSpecies: 'none', tools: ['erase', 'tube'], funnelSpecies: 'none' },
    goals: [{ kind: 'collect', specId: S.Fe, amount: 1 }],
    par: { seconds: 45 },
  },
];
