// Shared plain-DOM helpers for src/ui's panel builders (toolbar.ts,
// side-panel.ts, periodic-table.ts) -- all three build their DOM by hand
// rather than through a framework (see app.ts's module comment), so el()
// itself, plus the two small composite builders below, were being
// hand-copied into each file instead of shared.
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** A label/value row ('prop-row' with 'prop-label'/'prop-value' spans) --
 * used both for a species' melt/boil/phase readout (side-panel.ts,
 * periodic-table.ts) and a placed funnel's "Remaining" status
 * (side-panel.ts). */
export function propRow(label: string, value: string): HTMLDivElement {
  const row = el('div', 'prop-row');
  const l = el('span', 'prop-label');
  l.textContent = label;
  const v = el('span', 'prop-value');
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}

/** The "HOW IT WORKS" explainer box repeated at the bottom of the radiator,
 * funnel, and tube panels (see side-panel.ts) -- title is optional since the
 * funnel tool's empty-selection hint has no title, just a body paragraph. */
export function hintBox(body: string, title?: string): HTMLDivElement {
  const hint = el('div', 'setting-hint-box');
  if (title) {
    const hintTitle = el('div', 'setting-hint-title');
    hintTitle.textContent = title;
    hint.appendChild(hintTitle);
  }
  const hintBody = el('p', 'setting-hint');
  hintBody.textContent = body;
  hint.appendChild(hintBody);
  return hint;
}
