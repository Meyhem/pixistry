// Line-art icons for the tool rail (tool-rail.ts). One 24x24 stroked glyph
// per tool, drawn from `currentColor` so a slot's own color state (idle,
// hover, active, locked) carries straight into its icon with no per-icon
// styling.
//
// Inline SVG rather than emoji: the rail is 15 slots of apparatus that has no
// emoji (an addition funnel, a conveyor tube, a species filter), and emoji
// would also drag in the platform's own color palette, which is exactly what
// the swatch-on-active treatment needs to own.

export type IconName =
  | 'species'
  | 'erlenmeyer'
  | 'beaker'
  | 'glass'
  | 'insulator'
  | 'radiator'
  | 'stirrer'
  | 'funnel'
  | 'tube'
  | 'filter'
  | 'sink'
  | 'vent'
  | 'erase'
  | 'mix'
  | 'grab'
  | 'select';

/** Icon bodies, in a 0 0 24 24 box. Everything is stroked (never filled)
 * except where a solid nib actually reads better -- the select arrow and the
 * two "matter" dots -- which opt in with fill="currentColor". */
const ICONS: Record<IconName, string> = {
  // An atom: the one glyph that has to stand for "any of 149 species".
  species:
    '<circle cx="12" cy="12" r="2.6"/>' +
    '<ellipse cx="12" cy="12" rx="9.4" ry="4"/>' +
    '<ellipse cx="12" cy="12" rx="9.4" ry="4" transform="rotate(60 12 12)"/>' +
    '<ellipse cx="12" cy="12" rx="9.4" ry="4" transform="rotate(120 12 12)"/>',
  erlenmeyer: '<path d="M9 3v6.3L4.7 18.3A1.7 1.7 0 0 0 6.2 20.8h11.6a1.7 1.7 0 0 0 1.5-2.5L15 9.3V3"/><path d="M8 3h8"/><path d="M7.1 15.2h9.8"/>',
  beaker: '<path d="M5.6 3.6v13.6A3.6 3.6 0 0 0 9.2 20.8h5.6a3.6 3.6 0 0 0 3.6-3.6V3.6"/><path d="M4.2 3.6h15.6"/><path d="M5.6 14h12.8"/>',
  // A drawn polygon: the segments plus the corners you click to place them.
  glass: '<path d="M4.4 20V9.4l7.6-5 7.6 5V20"/><circle cx="4.4" cy="9.4" r="1.5"/><circle cx="12" cy="4.4" r="1.5"/><circle cx="19.6" cy="9.4" r="1.5"/>',
  insulator: '<rect x="3.6" y="5" width="16.8" height="14" rx="2"/><path d="M6.2 17.4 12.6 11M10.4 18.6 17.8 11.2M4.6 12.6 11.4 5.8M14.8 18.6l3-3"/>',
  radiator:
    '<circle cx="12" cy="12" r="3.3"/>' +
    '<path d="M12 3.2v3.1M12 17.7v3.1M3.2 12h3.1M17.7 12h3.1"/>' +
    '<path d="m5.8 5.8 2.2 2.2M16 16l2.2 2.2M18.2 5.8 16 8M8 16l-2.2 2.2"/>',
  // A stirred vortex: a circling arrow around a spinning core.
  stirrer: '<path d="M19 12a7 7 0 1 1-2.6-5.4"/><path d="M19.4 3.6v3.9h-3.9"/><path d="M12 9.6a2.4 2.4 0 1 1-2.2 3.3"/>',
  funnel: '<path d="M3.4 4.4h17.2L14 12.8v4.9l-4 2.3v-7.2z"/><path d="M12 21.6v.4"/>',
  // A pipe elbow drawn as two walls, so it reads as a lumen and not a wire.
  tube: '<path d="M3 5.2h8.8a5.6 5.6 0 0 1 5.6 5.6v9"/><path d="M3 11h5a1.6 1.6 0 0 1 1.6 1.6v7.2"/>',
  // A mesh line: one species gets through, one is turned back.
  filter:
    '<path d="M2.6 12.4h18.8"/><path d="M6.4 12.4V9.6M10.3 12.4V9.6M14.2 12.4V9.6M18.1 12.4V9.6"/>' +
    '<circle cx="8.4" cy="17.6" r="1.5" fill="currentColor" stroke="none"/>' +
    '<rect x="13.4" y="4.6" width="3.4" height="3.4" rx="0.9"/>',
  sink: '<path d="M3 20.2h18"/><path d="M12 3.4v10.4"/><path d="m7.8 9.8 4.2 4.2 4.2-4.2"/>',
  vent: '<path d="M3 20.2h18"/><path d="M12 17.4V4.6"/><path d="M7.8 8.8 12 4.6l4.2 4.2"/>',
  erase:
    '<path d="M8.8 20.4 4 15.6a1.9 1.9 0 0 1 0-2.7l8.9-8.9a1.9 1.9 0 0 1 2.7 0L20 8.4a1.9 1.9 0 0 1 0 2.7l-9.3 9.3"/>' +
    '<path d="M20.8 20.4H8.8"/><path d="m8.4 9.4 6.6 6.6"/>',
  mix: '<path d="M4.4 10.2a7.8 7.8 0 0 1 13.2-3.4"/><path d="M19.6 13.8a7.8 7.8 0 0 1-13.2 3.4"/><path d="M17.9 3.2v3.9H14"/><path d="M6.1 20.8v-3.9H10"/>',
  grab: '<path d="M9 12.4V5.7a1.6 1.6 0 0 1 3.2 0v5.5V4.6a1.6 1.6 0 0 1 3.2 0v6.6V6.9a1.6 1.6 0 0 1 3.2 0v7.3a6.6 6.6 0 0 1-6.6 6.6h-.7a5.6 5.6 0 0 1-4-1.6l-3-3a1.7 1.7 0 0 1 2.4-2.4z"/>',
  // Marquee corners plus a cursor: pick something already on the bench.
  select:
    '<path d="M3.6 7.4V3.6h3.8M20.4 7.4V3.6h-3.8M3.6 16.6v3.8h3.8"/>' +
    '<path d="m11 10 9.4 3.7-3.9 1.5-1.5 3.9z" fill="currentColor" stroke="none"/>',
};

/** Builds one icon as a detached `<svg>`. */
export function toolIcon(name: IconName): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '22');
  svg.setAttribute('height', '22');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.6');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('tool-icon');
  svg.innerHTML = ICONS[name];
  return svg;
}
