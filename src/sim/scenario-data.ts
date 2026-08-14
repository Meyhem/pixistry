// Campaign scenario data -- plain hand-authored data, same philosophy as
// species-data.ts/reactions.ts: authoring a level is data entry, not engine
// work (see .grill/campaign-mode.md's §3). scenario.ts turns a Scenario's
// `setup` into real grid state and enforces `rules` in the worker;
// objectives.ts turns `goals` into live progress, pure and gridless.
import type { WallKind } from './walls';
import { SpeciesId } from './species-data';

/** Mirrors the toolbar's apparatus tool set (see src/ui/toolbar.ts's
 * ToolKind) but lives in src/sim, not src/ui: worker.ts (sim layer) is what
 * actually enforces `Restrictions.tools` against incoming messages, and sim
 * must not depend on ui (see ARCHITECTURE.md). 'paint' isn't a member here
 * since manual spawning is gated per-species by `paintSpecies`, not as a
 * single on/off tool. */
export type ToolKind = 'erase' | 'grabber' | 'mixer' | 'radiator' | 'stirrer' | 'funnel' | 'tube' | 'filter' | 'sink' | 'flask';

/** What a scenario stamps onto a fresh bench before the player touches
 * anything -- built out of primitives that already exist (grid.set,
 * stampGlass, sink.ts's sinkLineCells), see scenario.ts's
 * applyScenarioSetup. Deliberately only the two kinds the first three
 * scenarios need (a filled reagent pool, a hollow wall container); more
 * kinds (funnel/flask/radiator/wallLine, all listed as available primitives
 * in .grill/campaign-mode.md's §3) get added here once a scenario actually
 * needs one, rather than pre-built and untested. */
export type SetupCommand =
  | { readonly kind: 'rect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly specId: number; readonly tempC?: number }
  | { readonly kind: 'wallRect'; readonly x: number; readonly y: number; readonly w: number; readonly h: number; readonly wall: WallKind };

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
// collect goal. Tiers 2+ (chains, purity/limit goals, continuous processes)
// wait for Phase 7's content pass once Phase 4-6 make a scenario actually
// playable end to end.
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
];
