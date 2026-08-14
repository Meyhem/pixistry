// The Tool Chest: the species picker, opened from the tool rail's top slot
// (tool-rail.ts). It's species-only -- apparatus and tools each have their own
// always-visible icon slot on the rail, so the only thing left that can't fit
// on a rail is the ~149-entry paintable species list.
//
// It was briefly one modal holding everything (species *and* every tool, in
// five headed sections), which is why the file is named for a chest rather
// than a palette; the rail took the tools back out.
//
// The body is the periodic table (periodic-table.ts's buildPeriodicTablePicker),
// which replaced the flat alphabetical species grid that used to fill it: a
// 149-tile wall of formulas is a worse index into the same species than the
// chart chemists already know, and the table was sitting one extra click away
// behind a footer button anyway. The flat grid survives only as the *search
// results* view -- type a query and the matching species list comes back,
// which is still the fastest route to a specific formula like "CuSO4(aq)".
import type { PaletteEntry } from '../sim/species';
import { contrastTextColor, contrastTextShadow } from './contrast';
import { buildPeriodicTablePicker } from './periodic-table';
import { el } from './dom';

export interface ToolChestCallbacks {
  isPaintActive(specId: number): boolean;
  isPinned(label: string): boolean;
  onSelectPaint(specId: number): void;
  onTogglePin(label: string): void;
  /** Selected element in the periodic-table body -- owned by app.ts, like
   * `query` below and for the same reason (a rebuild after a pin toggle
   * mustn't collapse the open detail pane). */
  selectedSymbol: string | null;
  onSelectElement(symbol: string): void;
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

/** A swatch-colored species button. */
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
  // Locked entries sink to the end but stay visible: a campaign scenario can
  // forbid all but a handful of the 149 paintable species, and leaving them
  // interleaved would bury the usable ones. Showing them at all is deliberate
  // -- a greyed padlock explains why a species is missing, where omitting it
  // entirely just looks like it's gone.
  const visible = entries.filter((entry) => matches(entry.label, query)).sort((a, b) => Number(a.locked) - Number(b.locked));
  if (visible.length === 0) return null;

  const section = el('div', 'chest-section');
  const grid = el('div', 'chest-grid');
  for (const entry of visible) {
    const wrap = el('div', 'chest-item');
    // Selecting a species closes the chest: the point of the modal is to get
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
  /** Labels to float to the top of the list: the player's pins in sandbox,
   * the scenario's allowed reagents in campaign mode. */
  pinnedLabels: readonly string[],
  cb: ToolChestCallbacks,
): void {
  container.innerHTML = '';

  const modal = el('div', 'pt-modal chest-modal');
  container.appendChild(modal);

  const header = el('div', 'pt-modal-header');
  const titleBox = el('div');
  const title = el('div', 'pt-modal-title');
  title.textContent = 'Periodic table';
  const subtitle = el('div', 'pt-modal-subtitle');
  subtitle.textContent = 'Pick an element for its paintable species — or search every compound by formula.';
  titleBox.appendChild(title);
  titleBox.appendChild(subtitle);
  header.appendChild(titleBox);

  const closeButton = el('button', 'pt-close-btn');
  closeButton.textContent = '✕';
  closeButton.title = 'Close (Esc, or click outside)';
  closeButton.onclick = cb.onClose;
  header.appendChild(closeButton);
  modal.appendChild(header);

  const search = el('input', 'chest-search');
  search.type = 'search';
  search.placeholder = 'Search elements and compounds…';
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

    // Empty search box -> the table. Typing switches to the flat matching-
    // species list, since a formula query has no element to hang off.
    if (query === '') {
      const body = el('div', 'pt-modal-body');
      results.appendChild(body);
      buildPeriodicTablePicker(body, palette, {
        selectedSymbol: cb.selectedSymbol,
        isPinned: cb.isPinned,
        onSelectElement: cb.onSelectElement,
        // Same as the flat list's tiles: picking closes the chest, because
        // the point of the modal is to get out of the way once the pick is
        // made.
        onSelectSpecies: (specId) => {
          cb.onSelectPaint(specId);
          cb.onClose();
        },
        onTogglePin: cb.onTogglePin,
        pinnable: cb.pinnable,
        ...(cb.isPaintLocked ? { isPaintLocked: cb.isPaintLocked } : {}),
      });
      return;
    }

    const section = renderSection(speciesEntries(palette, pinnedLabels, cb), query, cb);
    if (section) {
      results.appendChild(section);
    } else {
      const empty = el('div', 'chest-empty');
      empty.textContent = `Nothing matches “${query}”.`;
      results.appendChild(empty);
    }
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

/** Every paintable species, pinned labels first and the rest alphabetical. */
function speciesEntries(palette: readonly PaletteEntry[], pinnedLabels: readonly string[], cb: ToolChestCallbacks): ChestEntry[] {
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
