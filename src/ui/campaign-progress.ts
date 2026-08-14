// localStorage-backed campaign progress -- which scenarios are completed,
// star ratings, best times, discovered species, and unlocked achievements.
// Same defensive load/save pattern as app.ts's loadPinnedLabels/
// savePinnedLabels: corrupt or missing storage just falls back to a fresh
// empty progress rather than throwing. No mutation helpers yet -- Phase 3/4
// (scenario engine, win screen) will shape those once there's an actual
// scenario to complete.
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
