// Pure evaluation of a scenario's Goal list against a point-in-time
// snapshot of sink totals -- no grid, no SimGrid, no SpeciesTable, so a
// level's pass/fail logic is unit-testable without spinning up a worker
// (see .grill/campaign-mode.md's §3 "Engine" section). Lives worker-side in
// practice (worker.ts calls evaluateGoals every frame) because fast-forward
// bursts emit no frames and sustained-rate goals need per-tick fidelity,
// but the function itself has no opinion about where its snapshot comes
// from.
import type { Goal } from './scenario-data';

export interface GoalHistoryEntry {
  readonly tick: number;
  readonly totals: Uint32Array;
}

export interface GoalSnapshot {
  /** Indexed by specId, same array SinkCounter.totals uses. What the
   * player's *Sinks* have collected. */
  readonly totals: Uint32Array;
  /** What the player's *Vents* have thrown away, same shape as `totals` --
   * a separate tally because a vent is a waste port, not a collection port
   * (see grid.ts's SinkMaskValue), and only 'ventLimit' goals score it. */
  readonly ventTotals: Uint32Array;
  /** Per-second snapshots of `totals`, oldest first -- what 'rate' goals
   * measure a sustained throughput against. Worker.ts doesn't populate a
   * real rolling window yet (no current scenario has a 'rate' goal -- see
   * .grill/campaign-mode.md's Tier 3), so it's always `[]` in practice today;
   * this function still evaluates 'rate' goals correctly against a real one
   * once Phase 5's Run Test starts supplying it. */
  readonly history: readonly GoalHistoryEntry[];
  readonly tick: number;
  /** Highest cell temperature (K) observed anywhere on the grid since the
   * scenario was loaded -- a running max, not instantaneous, so a
   * 'maxTempK' goal latches "the bench melted" even if things cool back
   * down afterward. */
  readonly maxTempK: number;
}

export type GoalProgress =
  | { readonly kind: 'collect'; readonly specId: number; readonly amount: number; readonly current: number; readonly complete: boolean }
  | { readonly kind: 'collectAny'; readonly specIds: readonly number[]; readonly amount: number; readonly current: number; readonly complete: boolean }
  | {
      readonly kind: 'rate';
      readonly specId: number;
      readonly perSecond: number;
      readonly sustainSeconds: number;
      readonly currentRatePerSecond: number;
      readonly sustainedSeconds: number;
      readonly complete: boolean;
    }
  | { readonly kind: 'purity'; readonly specId: number; readonly minFraction: number; readonly currentFraction: number; readonly complete: boolean }
  | { readonly kind: 'limit'; readonly specId: number; readonly max: number; readonly current: number; readonly failed: boolean }
  | { readonly kind: 'ventLimit'; readonly specId: number; readonly max: number; readonly current: number; readonly failed: boolean }
  | { readonly kind: 'maxTempK'; readonly limitK: number; readonly currentMaxK: number; readonly failed: boolean };

const TICKS_PER_SECOND = 60;

function totalOf(totals: Uint32Array, specId: number): number {
  return totals[specId] ?? 0;
}

function grandTotalOf(totals: Uint32Array): number {
  let sum = 0;
  for (let i = 0; i < totals.length; i++) sum += totals[i] as number;
  return sum;
}

/** Walks the history backward from the most recent entry, accumulating
 * consecutive seconds whose measured rate meets `perSecond`, and stops at
 * the first second that doesn't -- a sustained streak has to be unbroken and
 * end at "now", not just add up somewhere in the past. */
function evaluateRate(goal: Extract<Goal, { kind: 'rate' }>, history: readonly GoalHistoryEntry[]): { currentRatePerSecond: number; sustainedSeconds: number } {
  let sustainedSeconds = 0;
  let currentRatePerSecond = 0;
  for (let i = history.length - 1; i > 0; i--) {
    const cur = history[i] as GoalHistoryEntry;
    const prev = history[i - 1] as GoalHistoryEntry;
    const deltaTicks = cur.tick - prev.tick;
    if (deltaTicks <= 0) break;
    const deltaCount = totalOf(cur.totals, goal.specId) - totalOf(prev.totals, goal.specId);
    const ratePerSecond = deltaCount / (deltaTicks / TICKS_PER_SECOND);
    if (i === history.length - 1) currentRatePerSecond = ratePerSecond;
    if (ratePerSecond < goal.perSecond) break;
    sustainedSeconds += deltaTicks / TICKS_PER_SECOND;
  }
  return { currentRatePerSecond, sustainedSeconds };
}

function evaluateOne(goal: Goal, snapshot: GoalSnapshot): GoalProgress {
  switch (goal.kind) {
    case 'collect': {
      const current = totalOf(snapshot.totals, goal.specId);
      return { kind: 'collect', specId: goal.specId, amount: goal.amount, current, complete: current >= goal.amount };
    }
    case 'collectAny': {
      let current = 0;
      for (const specId of goal.specIds) current += totalOf(snapshot.totals, specId);
      return { kind: 'collectAny', specIds: goal.specIds, amount: goal.amount, current, complete: current >= goal.amount };
    }
    case 'rate': {
      const { currentRatePerSecond, sustainedSeconds } = evaluateRate(goal, snapshot.history);
      return {
        kind: 'rate',
        specId: goal.specId,
        perSecond: goal.perSecond,
        sustainSeconds: goal.sustainSeconds,
        currentRatePerSecond,
        sustainedSeconds,
        complete: sustainedSeconds >= goal.sustainSeconds,
      };
    }
    case 'purity': {
      const grand = grandTotalOf(snapshot.totals);
      const currentFraction = grand > 0 ? totalOf(snapshot.totals, goal.specId) / grand : 0;
      return { kind: 'purity', specId: goal.specId, minFraction: goal.minFraction, currentFraction, complete: currentFraction >= goal.minFraction };
    }
    case 'limit': {
      const current = totalOf(snapshot.totals, goal.specId);
      return { kind: 'limit', specId: goal.specId, max: goal.max, current, failed: current > goal.max };
    }
    case 'ventLimit': {
      const current = totalOf(snapshot.ventTotals, goal.specId);
      return { kind: 'ventLimit', specId: goal.specId, max: goal.max, current, failed: current > goal.max };
    }
    case 'maxTempK':
      return { kind: 'maxTempK', limitK: goal.limitK, currentMaxK: snapshot.maxTempK, failed: snapshot.maxTempK > goal.limitK };
  }
}

export function evaluateGoals(goals: readonly Goal[], snapshot: GoalSnapshot): GoalProgress[] {
  return goals.map((goal) => evaluateOne(goal, snapshot));
}
