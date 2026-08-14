// The Tool Chest: the searchable modal holding everything that used to live
// in the four always-visible toolbar rows (ELEMENTS/APPARATUS/TOOLS). The
// bench itself only shows the five category buttons in the floating HUD (see
// hud.ts) -- picking a tool is a deliberate trip through this modal, which
// buys the sim canvas the ~170px of vertical space the old toolbar card
// occupied permanently.
//
// One modal, five entry points: the HUD has a button per `ChestCategory` and
// the chest opens showing only that category's entries. The categories used
// to be five headed sections inside a single scrolling list, which meant
// every trip to (say) Flow Control started by scrolling past all 149
// paintable species.
//
// This module is also the canonical home for the UI-side `ToolKind` union and
// the select-apparatus label/color (both were in the deleted toolbar.ts), since
// the chest is what actually enumerates every tool.
import type { PaletteEntry } from '../sim/species';
import type { WallMaterial } from '../sim/walls';
import { RADIATOR_COLOR, RADIATOR_LABEL } from '../sim/radiators';
import { FUNNEL_COLOR, FUNNEL_LABEL } from '../sim/funnel';
import { STIRRER_COLOR, STIRRER_LABEL } from '../sim/stirrer';
import { TUBE_COLOR, TUBE_LABEL } from '../sim/tube';
import { FILTER_COLOR, FILTER_LABEL } from '../sim/filter-apparatus';
import { SINK_COLOR, SINK_LABEL, VENT_COLOR, VENT_LABEL } from '../sim/sink';
import { contrastTextColor, contrastTextShadow } from './contrast';
import { el } from './dom';

export type ToolKind =
  | 'radiator'
  | 'erase'
  | 'mixer'
  | 'grabber'
  | 'funnel'
  | 'stirrer'
  | 'tube'
  | 'filter'
  | 'sink'
  | 'vent'
  | 'flask-erlenmeyer'
  | 'flask-beaker'
  | 'select-apparatus';

export const SELECT_APPARATUS_LABEL = 'Select';
export const SELECT_APPARATUS_COLOR = '#4da3ff';

/** The five chest categories -- one HUD button and one chest view each. */
export type ChestCategory = 'species' | 'glassware' | 'thermal' | 'flow' | 'tools';

export interface ChestCategoryInfo {
  readonly id: ChestCategory;
  /** Chest modal title. */
  readonly label: string;
  /** HUD button caption -- the top strip can't fit the full title five times. */
  readonly short: string;
  readonly subtitle: string;
  /** Number key that opens this category from the bench (see app.ts). */
  readonly key: string;
}

const SPECIES_CATEGORY: ChestCategoryInfo = {
  id: 'species',
  label: 'Elements & Compounds',
  short: 'Elements',
  subtitle: 'Everything you can paint onto the bench, plus the periodic table.',
  key: '1',
};

export const CHEST_CATEGORIES: readonly ChestCategoryInfo[] = [
  SPECIES_CATEGORY,
  { id: 'glassware', label: 'Glassware', short: 'Glassware', subtitle: 'Vessels to hold a reaction, and glass to draw your own.', key: '2' },
  { id: 'thermal', label: 'Thermal & Mixing', short: 'Thermal', subtitle: 'Heat it, insulate it, stir it.', key: '3' },
  { id: 'flow', label: 'Flow Control', short: 'Flow', subtitle: 'Feed matter in, move it around, filter it, throw it away.', key: '4' },
  { id: 'tools', label: 'Tools', short: 'Tools', subtitle: 'Erase, mix, grab, and edit what you have already placed.', key: '5' },
];

export function chestCategoryInfo(id: ChestCategory): ChestCategoryInfo {
  // The array is exhaustive over the union, so the fallback is unreachable --
  // it's here to keep the return type non-optional.
  return CHEST_CATEGORIES.find((c) => c.id === id) ?? SPECIES_CATEGORY;
}

export interface ToolChestCallbacks {
  /** Which category the chest is showing -- the modal renders exactly one. */
  category: ChestCategory;
  isPaintActive(specId: number): boolean;
  isWallActive(specId: number): boolean;
  isToolActive(kind: ToolKind): boolean;
  isPinned(label: string): boolean;
  onSelectPaint(specId: number): void;
  onSelectWall(specId: number): void;
  onSelectTool(kind: ToolKind): void;
  onTogglePin(label: string): void;
  onOpenPeriodicTable(): void;
  onClose(): void;
  /** Whether the pin (📌) button appears on species tiles -- false in
   * campaign mode, where the species list is the scenario's fixed reagent
   * set rather than the player's own customizable pins. */
  pinnable: boolean;
  /** Live search text. Owned by app.ts (like every other bit of UI state
   * here) so a rebuild mid-typing doesn't lose it -- see onSetQuery. */
  query: string;
  onSetQuery(value: string): void;
  /** Campaign restrictions (absent in sandbox, which locks nothing): a
   * locked entry renders greyed with a padlock and explains why clicking it
   * does nothing, instead of silently no-op'ing at the worker. */
  isPaintLocked?(specId: number): boolean;
  isWallLocked?(specId: number): boolean;
  isToolLocked?(kind: ToolKind): boolean;
  periodicTableLocked?: boolean;
}

interface ChestEntry {
  label: string;
  color: string | null;
  active: boolean;
  locked: boolean;
  pinnable: boolean;
  pinned: boolean;
  onSelect(): void;
  onTogglePin?(): void;
}

/** A swatch-colored tool/species button. Exported because the HUD's active-
 * tool chip (hud.ts) draws the same swatch-on-color treatment and shouldn't
 * re-derive the contrast math. */
export function paletteButton(label: string, swatch: string | null, active: boolean, onClick: () => void, locked = false): HTMLButtonElement {
  const button = el('button', 'palette-btn');
  if (active) button.classList.add('active');
  if (swatch) {
    button.style.setProperty('--swatch', swatch);
    button.style.color = contrastTextColor(swatch);
    button.style.textShadow = contrastTextShadow(swatch);
  } else {
    button.classList.add('erase-btn');
  }
  button.textContent = locked ? `🔒 ${label}` : label;
  button.disabled = locked;
  if (locked) {
    button.classList.add('locked');
    button.title = 'Not available in this experiment';
  }
  button.onclick = onClick;
  return button;
}

function matches(label: string, query: string): boolean {
  return query === '' || label.toLowerCase().includes(query.toLowerCase());
}

function renderSection(entries: ChestEntry[], query: string, cb: ToolChestCallbacks): HTMLDivElement | null {
  // Locked entries sink to the end of their section but stay visible: a
  // campaign scenario can forbid all but a handful of the 149 paintable
  // species, and leaving them interleaved would bury the usable ones. Showing
  // them at all is deliberate -- a greyed padlock explains why a tool is
  // missing, where omitting it entirely just looks like the tool is gone.
  const visible = entries.filter((entry) => matches(entry.label, query)).sort((a, b) => Number(a.locked) - Number(b.locked));
  if (visible.length === 0) return null;

  // No section heading any more: the modal title *is* the category name.
  const section = el('div', 'chest-section');
  const grid = el('div', 'chest-grid');
  for (const entry of visible) {
    const wrap = el('div', 'chest-item');
    // Selecting a tool closes the chest: the point of the modal is to get
    // out of the player's way again as soon as the pick is made.
    wrap.appendChild(
      paletteButton(entry.label, entry.color, entry.active, () => {
        entry.onSelect();
        cb.onClose();
      }, entry.locked),
    );
    if (entry.pinnable && entry.onTogglePin) {
      const pinButton = el('button', 'pin-btn');
      pinButton.title = entry.pinned ? 'Unpin' : 'Pin';
      pinButton.classList.toggle('pinned', entry.pinned);
      pinButton.textContent = '📌';
      pinButton.onclick = (event) => {
        event.stopPropagation();
        entry.onTogglePin?.();
      };
      wrap.appendChild(pinButton);
    }
    grid.appendChild(wrap);
  }
  section.appendChild(grid);
  return section;
}

export function buildToolChest(
  container: HTMLElement,
  palette: readonly PaletteEntry[],
  walls: readonly WallMaterial[],
  /** Labels to float to the top of the species section: the player's pins in
   * sandbox, the scenario's allowed reagents in campaign mode. */
  pinnedLabels: readonly string[],
  cb: ToolChestCallbacks,
): void {
  container.innerHTML = '';

  const modal = el('div', 'pt-modal chest-modal');
  container.appendChild(modal);

  const info = chestCategoryInfo(cb.category);

  const header = el('div', 'pt-modal-header');
  const titleBox = el('div');
  const title = el('div', 'pt-modal-title');
  title.textContent = info.label;
  const subtitle = el('div', 'pt-modal-subtitle');
  subtitle.textContent = info.subtitle;
  titleBox.appendChild(title);
  titleBox.appendChild(subtitle);
  header.appendChild(titleBox);

  const closeButton = el('button', 'pt-close-btn');
  closeButton.textContent = '✕';
  closeButton.title = 'Close (Esc)';
  closeButton.onclick = cb.onClose;
  header.appendChild(closeButton);
  modal.appendChild(header);

  const search = el('input', 'chest-search');
  search.type = 'search';
  search.placeholder = `Search ${info.label.toLowerCase()}…`;
  search.value = cb.query;
  // Rebuilding on every keystroke would replace the focused input under the
  // caret, so the query lives in app.ts state and this handler re-renders
  // only the results list (see rebuildResults below) -- the input node
  // itself survives untouched.
  modal.appendChild(search);

  const results = el('div', 'chest-results');
  modal.appendChild(results);

  const rebuildResults = (query: string): void => {
    results.innerHTML = '';

    const section = renderSection(categoryEntries(cb.category, palette, walls, pinnedLabels, cb), query, cb);
    if (section) {
      results.appendChild(section);
    } else {
      const empty = el('div', 'chest-empty');
      empty.textContent = `Nothing matches “${query}”.`;
      results.appendChild(empty);
    }

    // The periodic table stays its own modal (it's a reference chart, not a
    // flat list), reachable from the foot of the species category rather than
    // a sixth permanent button on the bench.
    if (cb.category !== 'species') return;
    const footer = el('div', 'chest-footer');
    const ptButton = el('button', 'pt-open-btn');
    const dots = el('span', 'pt-dots');
    for (let i = 0; i < 9; i++) dots.appendChild(el('span', 'pt-dot'));
    ptButton.appendChild(dots);
    ptButton.appendChild(document.createTextNode(cb.periodicTableLocked ? '🔒 Periodic table' : 'Periodic table'));
    ptButton.disabled = !!cb.periodicTableLocked;
    if (cb.periodicTableLocked) {
      ptButton.classList.add('locked');
      ptButton.title = 'Not available in this experiment';
    }
    ptButton.onclick = cb.onOpenPeriodicTable;
    footer.appendChild(ptButton);
    results.appendChild(footer);
  };

  search.oninput = () => {
    cb.onSetQuery(search.value);
    rebuildResults(search.value);
  };
  rebuildResults(cb.query);

  // Autofocus so the chest is keyboard-first: press T, type "cu", Enter-ish
  // click. Deferred to the next frame because the element isn't in the
  // document yet on the first call for a freshly created overlay.
  requestAnimationFrame(() => search.focus());
}

/** Every entry belonging to one category, in display order. The split is
 * fixed here rather than derived from ToolKind so a tool's category is a
 * deliberate editorial choice (Stirrer is filed under mixing, not flow). */
function categoryEntries(
  category: ChestCategory,
  palette: readonly PaletteEntry[],
  walls: readonly WallMaterial[],
  pinnedLabels: readonly string[],
  cb: ToolChestCallbacks,
): ChestEntry[] {
  if (category === 'species') {
    const pinnedOrder = new Map(pinnedLabels.map((label, index) => [label, index]));
    return [...palette]
      .sort((a, b) => {
        const ai = pinnedOrder.get(a.label) ?? Number.MAX_SAFE_INTEGER;
        const bi = pinnedOrder.get(b.label) ?? Number.MAX_SAFE_INTEGER;
        return ai !== bi ? ai - bi : a.label.localeCompare(b.label);
      })
      .map((entry) => ({
        label: entry.label,
        color: entry.color,
        active: cb.isPaintActive(entry.specId),
        locked: !!cb.isPaintLocked?.(entry.specId),
        pinnable: cb.pinnable,
        pinned: cb.isPinned(entry.label),
        onSelect: () => cb.onSelectPaint(entry.specId),
        onTogglePin: () => cb.onTogglePin(entry.label),
      }));
  }

  if (category === 'glassware') {
    const glassWall = walls.find((w) => w.kind === 'glass');
    const entries: ChestEntry[] = [
      // One entry per vessel shape -- whether it comes with a stirrer is a
      // setting inside the tool's own settings panel (see side-panel.ts's
      // flask panel), not a separate chest entry per combination.
      toolEntry('Erlenmeyer', FUNNEL_COLOR, 'flask-erlenmeyer', cb),
      toolEntry('Beaker', FUNNEL_COLOR, 'flask-beaker', cb),
    ];
    if (glassWall) entries.push(wallEntry(`${glassWall.label} (polygon)`, glassWall, cb));
    return entries;
  }

  if (category === 'thermal') {
    const insulatorWall = walls.find((w) => w.kind === 'insulator');
    const entries: ChestEntry[] = [];
    if (insulatorWall) entries.push(wallEntry(insulatorWall.label, insulatorWall, cb));
    entries.push(toolEntry(RADIATOR_LABEL, RADIATOR_COLOR, 'radiator', cb), toolEntry(STIRRER_LABEL, STIRRER_COLOR, 'stirrer', cb));
    return entries;
  }

  if (category === 'flow') {
    return [
      toolEntry(FUNNEL_LABEL, FUNNEL_COLOR, 'funnel', cb),
      toolEntry(TUBE_LABEL, TUBE_COLOR, 'tube', cb),
      toolEntry(FILTER_LABEL, FILTER_COLOR, 'filter', cb),
      toolEntry(SINK_LABEL, SINK_COLOR, 'sink', cb),
      toolEntry(VENT_LABEL, VENT_COLOR, 'vent', cb),
    ];
  }

  return [
    toolEntry('Erase', null, 'erase', cb),
    toolEntry('Mix', '#c9a8ff', 'mixer', cb),
    toolEntry('Grab', '#f2d94e', 'grabber', cb),
    // select-apparatus only edits already-placed apparatus (it creates no
    // matter of its own), so it's never locked -- there's no sim-side
    // ToolKind for it to be checked against.
    toolEntry(SELECT_APPARATUS_LABEL, SELECT_APPARATUS_COLOR, 'select-apparatus', cb),
  ];
}

function toolEntry(label: string, color: string | null, kind: ToolKind, cb: ToolChestCallbacks): ChestEntry {
  return {
    label,
    color,
    active: cb.isToolActive(kind),
    locked: !!cb.isToolLocked?.(kind),
    pinnable: false,
    pinned: false,
    onSelect: () => cb.onSelectTool(kind),
  };
}

function wallEntry(label: string, wall: WallMaterial, cb: ToolChestCallbacks): ChestEntry {
  return {
    label,
    color: wall.color,
    active: cb.isWallActive(wall.specId),
    locked: !!cb.isWallLocked?.(wall.specId),
    pinnable: false,
    pinned: false,
    onSelect: () => cb.onSelectWall(wall.specId),
  };
}
