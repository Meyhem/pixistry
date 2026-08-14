// Comfort settings -- localStorage-backed, same defensive load/save pattern
// as campaign-progress.ts. Kept as its own storage key rather than folded
// into CampaignProgress: these apply in sandbox too, and aren't tied to a
// specific campaign save.
//
// See .grill/campaign-mode.md's §6 point 5: for this audience (school kids,
// autistic kids) this is not a nice-to-have -- quiet mode mutes every sound
// this app makes (chimes, and any future SFX), reduceMotion drops the sink
// sparkle/shake-style effects, highContrast and bigUI are plain CSS-class
// toggles the stylesheet reacts to.
const SETTINGS_STORAGE_KEY = 'pixistry.comfortSettings';

export interface ComfortSettings {
  quiet: boolean;
  reduceMotion: boolean;
  highContrast: boolean;
  bigUI: boolean;
}

// Every toggle starts off (full experience) -- "defaulting to the calm end"
// (the design doc's phrase) is honored by keeping the shipped effects
// themselves modest (soft chimes, brief sparkle) rather than by muting them
// out of the box; a toggle only an audience member who needs it will find.
function defaultSettings(): ComfortSettings {
  return { quiet: false, reduceMotion: false, highContrast: false, bigUI: false };
}

function isComfortSettings(value: unknown): value is ComfortSettings {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.quiet === 'boolean' && typeof v.reduceMotion === 'boolean' && typeof v.highContrast === 'boolean' && typeof v.bigUI === 'boolean';
}

export function loadComfortSettings(): ComfortSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return defaultSettings();
    const parsed: unknown = JSON.parse(raw);
    return isComfortSettings(parsed) ? parsed : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveComfortSettings(settings: ComfortSettings): void {
  try {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Storage unavailable -- setting just won't survive a reload.
  }
}

/** Applies the toggles as document.body classes so the stylesheet (and
 * anything else) can react without every call site importing this module.
 * `quiet`/`reduceMotion` are read directly by sound.ts/the sparkle code
 * instead, since those are JS-side branches, not pure CSS. */
export function applyComfortSettings(settings: ComfortSettings): void {
  document.body.classList.toggle('comfort-high-contrast', settings.highContrast);
  document.body.classList.toggle('comfort-big-ui', settings.bigUI);
  document.body.classList.toggle('comfort-reduce-motion', settings.reduceMotion);
}
