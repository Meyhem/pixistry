// Palette/wall swatch colors span from near-black (carbon) to near-white
// (silver), so a single hardcoded button text color reads unreadable on
// roughly half the set (e.g. Carbon's #2b2b2b with #111 text). This picks
// light or dark text per-swatch off the color's relative luminance.
function relativeLuminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const channel = (c: number): number => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

const DARK_TEXT = '#111';
const LIGHT_TEXT = '#f2f2f2';

/** Dark text on light swatches, light text on dark swatches. */
export function contrastTextColor(hex: string): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return DARK_TEXT;
  return relativeLuminance(hex) > 0.42 ? DARK_TEXT : LIGHT_TEXT;
}

/** A subtle same-contrast-direction shadow to keep text edges crisp against
 * a busy swatch, without washing out light text the way a fixed light
 * shadow (tuned for dark text) would. */
export function contrastTextShadow(hex: string): string {
  return contrastTextColor(hex) === DARK_TEXT ? '0 1px 1px rgba(255, 255, 255, 0.3)' : '0 1px 1px rgba(0, 0, 0, 0.4)';
}
