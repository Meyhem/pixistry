// Turns the worker's live GoalProgress[] (see objectives.ts) into
// human-readable HUD rows -- pure data in, pure data out, no DOM. Every
// GoalProgress variant already carries its own goal params (specId/amount/
// max/limitK/...) inline, so this only needs the live progress list plus a
// label/color lookup, not the scenario's static Goal[] as well.
import type { GoalProgress } from '../sim/objectives';
import type { SpeciesLookup } from './species-lookup';

export interface ObjectiveDisplay {
  /** Kid-facing description of what this goal wants, e.g. "Collect NaCl". */
  text: string;
  /** Progress-bar color -- the target species' own swatch where there's one
   * clear target, a neutral grey for anything without one (collectAny's
   * multiple targets, or a temperature/purity goal). */
  color: string;
  /** 0-1, clamped, for the progress bar's fill width. For a 'limit'/
   * 'maxTempK' ceiling goal this is "how close to failing", not "how close
   * to done". */
  fraction: number;
  /** Already-formatted current/target readout, e.g. "62 / 100 px" or
   * "420 / 500 K". */
  readout: string;
  complete: boolean;
  failed: boolean;
}

const NEUTRAL_COLOR = '#8a8a8a';

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

export function describeObjectives(progress: readonly GoalProgress[], lookup: SpeciesLookup): ObjectiveDisplay[] {
  return progress.map((goal): ObjectiveDisplay => {
    switch (goal.kind) {
      case 'collect': {
        const label = lookup.labelOf(goal.specId) ?? `spec ${goal.specId}`;
        return {
          text: `Collect ${label}`,
          color: lookup.colorOf(goal.specId) ?? NEUTRAL_COLOR,
          fraction: clamp01(goal.current / goal.amount),
          readout: `${goal.current} / ${goal.amount} px`,
          complete: goal.complete,
          failed: false,
        };
      }
      case 'collectAny': {
        const labels = goal.specIds.map((id) => lookup.labelOf(id) ?? `spec ${id}`);
        return {
          text: `Collect ${labels.join(' or ')}`,
          color: goal.specIds.length === 1 ? (lookup.colorOf(goal.specIds[0] as number) ?? NEUTRAL_COLOR) : NEUTRAL_COLOR,
          fraction: clamp01(goal.current / goal.amount),
          readout: `${goal.current} / ${goal.amount} px`,
          complete: goal.complete,
          failed: false,
        };
      }
      case 'rate': {
        const label = lookup.labelOf(goal.specId) ?? `spec ${goal.specId}`;
        return {
          text: `Sustain ${goal.perSecond}/s ${label} for ${goal.sustainSeconds}s`,
          color: lookup.colorOf(goal.specId) ?? NEUTRAL_COLOR,
          fraction: clamp01(goal.sustainedSeconds / goal.sustainSeconds),
          readout: `${goal.currentRatePerSecond.toFixed(1)}/s · held ${goal.sustainedSeconds.toFixed(1)}s / ${goal.sustainSeconds}s`,
          complete: goal.complete,
          failed: false,
        };
      }
      case 'purity': {
        const label = lookup.labelOf(goal.specId) ?? `spec ${goal.specId}`;
        return {
          text: `${label} purity`,
          color: lookup.colorOf(goal.specId) ?? NEUTRAL_COLOR,
          fraction: clamp01(goal.currentFraction / goal.minFraction),
          readout: `${Math.round(goal.currentFraction * 100)}% / ${Math.round(goal.minFraction * 100)}%`,
          complete: goal.complete,
          failed: false,
        };
      }
      case 'limit': {
        const label = lookup.labelOf(goal.specId) ?? `spec ${goal.specId}`;
        return {
          text: `Keep ${label} under ${goal.max} px`,
          color: goal.failed ? '#e05a5a' : NEUTRAL_COLOR,
          fraction: clamp01(goal.current / goal.max),
          readout: `${goal.current} / ${goal.max} px`,
          complete: false,
          failed: goal.failed,
        };
      }
      case 'ventLimit': {
        const label = lookup.labelOf(goal.specId) ?? `spec ${goal.specId}`;
        return {
          text: `Vent no more than ${goal.max} px of ${label}`,
          color: goal.failed ? '#e05a5a' : NEUTRAL_COLOR,
          fraction: clamp01(goal.current / goal.max),
          readout: `${goal.current} / ${goal.max} px vented`,
          complete: false,
          failed: goal.failed,
        };
      }
      case 'maxTempK': {
        return {
          text: `Keep the bench under ${goal.limitK} K`,
          color: goal.failed ? '#e05a5a' : NEUTRAL_COLOR,
          fraction: clamp01(goal.currentMaxK / goal.limitK),
          readout: `${Math.round(goal.currentMaxK)} K / ${goal.limitK} K`,
          complete: false,
          failed: goal.failed,
        };
      }
    }
  });
}

/** A scenario is won once every goal that can complete has, and nothing that
 * can fail has -- 'limit'/'maxTempK' goals have no `complete` of their own
 * (they're pass-by-default ceilings), so they only need to not be failed.
 * Every real scenario has at least one goal, so an empty list means the
 * worker hasn't caught up with a just-sent 'loadScenario' yet (its frames
 * default `objectives` to `[]` until it has) -- Array.every is vacuously
 * true on [], which would otherwise read that transient state as an instant
 * win. */
export function isScenarioWon(progress: readonly GoalProgress[]): boolean {
  if (progress.length === 0) return false;
  return progress.every((goal) => ('complete' in goal ? goal.complete : true) && ('failed' in goal ? !goal.failed : true));
}
