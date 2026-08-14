// Zero-asset WebAudio blips for the campaign HUD's milestone chimes (see
// .grill/campaign-mode.md's §6 point 3) and the win overlay. A single lazily
// created AudioContext, since browsers refuse to let one start before a user
// gesture -- the first real call (always in response to a click/objective
// update inside an already-interactive page) is what creates it.
let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new AudioContext();
  } catch {
    // No WebAudio support -- chimes just silently don't play.
    return null;
  }
  return ctx;
}

export type ChimePitch = 'quarter' | 'half' | 'threeQuarter' | 'full' | 'win';

const FREQUENCIES: Record<ChimePitch, number> = {
  quarter: 523.25, // C5
  half: 587.33, // D5
  threeQuarter: 659.25, // E5
  full: 783.99, // G5
  win: 1046.5, // C6
};

/** Plays a short synth blip. `pitch` picks the tone: milestone chimes climb
 * in pitch as a goal fills up (25/50/75/100%), 'win' is a fixed bright note.
 * No-op (and doesn't even touch the AudioContext) when `quiet` is true, so
 * callers can pass comfort-settings.ts's own flag straight through. */
export function playChime(pitch: ChimePitch, quiet: boolean): void {
  if (quiet) return;
  const audio = getContext();
  if (!audio) return;

  const now = audio.currentTime;
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.type = 'sine';
  osc.frequency.value = FREQUENCIES[pitch];
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(0.15, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
  osc.connect(gain);
  gain.connect(audio.destination);
  osc.start(now);
  osc.stop(now + 0.35);
}
