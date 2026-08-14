// localStorage-backed campaign progress -- which scenarios are completed,
// star ratings, best times, discovered species, and unlocked achievements.
// Same defensive load/save pattern as app.ts's loadPinnedLabels/
// savePinnedLabels: corrupt or missing storage just falls back to a fresh
// empty progress rather than throwing.
const PROGRESS_STORAGE_KEY = 'pixistry.campaignProgress';

export interface CampaignProgress {
  completedScenarioIds: string[];
  starsByScenarioId: Record<string, number>;
  bestTimeSecByScenarioId: Record<string, number>;
  discoveredSpeciesLabels: string[];
  achievementIds: string[];
}

function emptyProgress(): CampaignProgress {
  return {
    completedScenarioIds: [],
    starsByScenarioId: {},
    bestTimeSecByScenarioId: {},
    discoveredSpeciesLabels: [],
    achievementIds: [],
  };
}

function isCampaignProgress(value: unknown): value is CampaignProgress {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return (
    Array.isArray(v.completedScenarioIds) &&
    v.completedScenarioIds.every((x) => typeof x === 'string') &&
    typeof v.starsByScenarioId === 'object' &&
    v.starsByScenarioId !== null &&
    typeof v.bestTimeSecByScenarioId === 'object' &&
    v.bestTimeSecByScenarioId !== null &&
    Array.isArray(v.discoveredSpeciesLabels) &&
    v.discoveredSpeciesLabels.every((x) => typeof x === 'string') &&
    Array.isArray(v.achievementIds) &&
    v.achievementIds.every((x) => typeof x === 'string')
  );
}

export function loadProgress(): CampaignProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return emptyProgress();
    const parsed: unknown = JSON.parse(raw);
    return isCampaignProgress(parsed) ? parsed : emptyProgress();
  } catch {
    return emptyProgress();
  }
}

export function saveProgress(progress: CampaignProgress): void {
  try {
    localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // Storage unavailable (private browsing, quota) -- progress just won't
    // survive a reload, which is a fine degradation.
  }
}

/** Star thresholds relative to a scenario's par time -- 3 for beating par, 2
 * for finishing within 1.5x par, 1 for finishing at all. A scenario with no
 * par.seconds (nothing to race against) always awards 3: par is a bonus
 * challenge, not a requirement, so its absence shouldn't cap the score. */
export function starsForCompletion(parSeconds: number | undefined, elapsedSeconds: number): number {
  if (parSeconds === undefined) return 3;
  if (elapsedSeconds <= parSeconds) return 3;
  if (elapsedSeconds <= parSeconds * 1.5) return 2;
  return 1;
}

/** Folds a scenario win into progress: marks it completed, keeps the best
 * (highest) star rating and the best (lowest) time seen across every
 * completion, since a replay shouldn't be able to erase a better past run.
 * Returns a new object rather than mutating -- callers own persistence via
 * saveProgress. */
export function recordCompletion(progress: CampaignProgress, scenarioId: string, stars: number, elapsedSeconds: number): CampaignProgress {
  const prevStars = progress.starsByScenarioId[scenarioId] ?? 0;
  const prevBestTime = progress.bestTimeSecByScenarioId[scenarioId];
  return {
    ...progress,
    completedScenarioIds: progress.completedScenarioIds.includes(scenarioId)
      ? progress.completedScenarioIds
      : [...progress.completedScenarioIds, scenarioId],
    starsByScenarioId: { ...progress.starsByScenarioId, [scenarioId]: Math.max(prevStars, stars) },
    bestTimeSecByScenarioId: {
      ...progress.bestTimeSecByScenarioId,
      [scenarioId]: prevBestTime === undefined ? elapsedSeconds : Math.min(prevBestTime, elapsedSeconds),
    },
  };
}
