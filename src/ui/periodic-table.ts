// The periodic-table modal: a full periods-1-5 grid (Z 1-54), with every
// element the sim actually simulates clickable and everything else shown
// dimmed for context. Picking a clickable element shows its melt/boil point
// and the paintable species it participates in (pure element, plus any
// paintable compounds from periodic-data.ts's COMPOUNDS_FOR_ELEMENT), each
// pickable and pinnable from right there.
//
// The picker (grid + detail pane) is exported separately from the modal shell:
// the Tool Chest renders it as its own body, since the periodic table *is* the
// species picker now rather than a reference chart linked from the bottom of a
// flat 149-entry list.
import type { PaletteEntry } from '../sim/species';
import { contrastTextColor, contrastTextShadow } from './contrast';
import { formatCelsius } from './format';
import { CATEGORY_HUE, CATEGORY_LABEL, COMPOUNDS_FOR_ELEMENT, ELEMENTS, PURE_FOR_ELEMENT } from './periodic-data';
import { el, propRow } from './dom';

export interface PeriodicTablePickerCallbacks {
  selectedSymbol: string | null;
  isPinned(label: string): boolean;
  onSelectElement(symbol: string): void;
  onSelectSpecies(specId: number): void;
  onTogglePin(label: string): void;
  /** Whether the pin (📌) button appears on the detail pane's species rows
   * -- false in campaign mode, where the toolbar's species list is the
   * scenario's fixed reagent set rather than the player's own pins. */
  pinnable?: boolean;
  /** Campaign restrictions (absent in sandbox, which locks nothing): a
   * locked species renders greyed with a padlock and an element whose whole
   * species list is locked isn't clickable at all, rather than opening onto
   * a detail pane where nothing can be picked. */
  isPaintLocked?(specId: number): boolean;
}

export interface PeriodicTableCallbacks extends PeriodicTablePickerCallbacks {
  onClose(): void;
}

export function buildPeriodicTable(overlay: HTMLElement, palette: PaletteEntry[], cb: PeriodicTableCallbacks): void {
  overlay.innerHTML = '';
  overlay.onclick = cb.onClose;

  const modal = el('div', 'pt-modal');
  modal.onclick = (e) => e.stopPropagation();
  overlay.appendChild(modal);

  const header = el('div', 'pt-modal-header');
  const headerText = el('div');
  const title = el('div', 'pt-modal-title');
  title.textContent = 'Periodic table';
  const subtitle = el('div', 'pt-modal-subtitle');
  subtitle.textContent = 'Periods 1-5, plus period 6 main group · colored elements are simulated in Pixistry';
  headerText.appendChild(title);
  headerText.appendChild(subtitle);
  header.appendChild(headerText);

  const closeButton = el('button', 'pt-close-btn');
  closeButton.textContent = '×';
  closeButton.title = 'Close (Esc, or click outside)';
  closeButton.onclick = cb.onClose;
  header.appendChild(closeButton);
  modal.appendChild(header);

  const body = el('div', 'pt-modal-body');
  modal.appendChild(body);
  buildPeriodicTablePicker(body, palette, cb);
}

/** The picker itself -- the element grid plus the selected element's detail
 * pane -- rendered into whatever container it's handed, with no modal shell
 * of its own. Two callers: the standalone modal above (the species picker for
 * a funnel's payload, a tube/filter allow-list) and the Tool Chest, which
 * uses it as its whole body (see tool-chest.ts). */
export function buildPeriodicTablePicker(body: HTMLElement, palette: readonly PaletteEntry[], cb: PeriodicTablePickerCallbacks): void {
  body.innerHTML = '';

  const grid = el('div', 'pt-grid');
  const byLabel = new Map(palette.map((entry) => [entry.label, entry]));

  for (const element of ELEMENTS) {
    const hue = CATEGORY_HUE[element.category];
    const isSelected = element.symbol === cb.selectedSymbol;
    // An element with nothing pickable left under a campaign's restrictions
    // is treated exactly like an unsimulated one: dimmed and unclickable,
    // rather than clickable onto an all-padlocks detail pane.
    const locked = cb.isPaintLocked ? speciesFor(element.symbol, byLabel).every((entry) => cb.isPaintLocked?.(entry.specId)) : false;
    const supported = element.symbol in PURE_FOR_ELEMENT && !locked;

    const cell = el('button', 'pt-cell');
    cell.style.gridColumn = String(element.group);
    cell.style.gridRow = String(element.period);
    cell.style.setProperty('--hue', String(hue));
    cell.classList.toggle('supported', supported);
    cell.classList.toggle('selected', isSelected);
    const note = locked ? ' — not available in this experiment' : supported ? '' : ' — not simulated';
    cell.title = `${element.name} (${CATEGORY_LABEL[element.category]})${note}`;
    cell.disabled = !supported;
    if (supported) cell.onclick = () => cb.onSelectElement(element.symbol);

    const z = el('span', 'pt-z');
    z.textContent = String(element.z);
    const symbol = el('span', 'pt-symbol');
    symbol.textContent = element.symbol;
    cell.appendChild(z);
    cell.appendChild(symbol);
    grid.appendChild(cell);
  }
  body.appendChild(grid);

  const detail = el('div', 'pt-detail');
  body.appendChild(detail);

  const selectedElement = cb.selectedSymbol ? ELEMENTS.find((e) => e.symbol === cb.selectedSymbol) : undefined;
  if (!selectedElement) {
    const empty = el('div', 'pt-detail-empty');
    empty.textContent = 'Click a highlighted element to view its properties and the species you can paint with.';
    detail.appendChild(empty);
    return;
  }

  const pureLabel = PURE_FOR_ELEMENT[selectedElement.symbol];
  const pureEntry = pureLabel ? byLabel.get(pureLabel) : undefined;

  const symbolEl = el('div', 'pt-detail-symbol');
  symbolEl.textContent = selectedElement.symbol;
  detail.appendChild(symbolEl);

  const nameEl = el('div', 'pt-detail-name');
  nameEl.textContent = selectedElement.name;
  detail.appendChild(nameEl);

  const catChip = el('div', 'category-chip');
  catChip.textContent = CATEGORY_LABEL[selectedElement.category];
  detail.appendChild(catChip);

  if (pureEntry) {
    const divider1 = el('div', 'divider');
    detail.appendChild(divider1);

    const props = el('div', 'prop-list');
    props.appendChild(propRow('Melting point', formatCelsius(pureEntry.meltingPointC)));
    props.appendChild(propRow('Boiling point', formatCelsius(pureEntry.boilingPointC)));
    detail.appendChild(props);
  }

  const divider2 = el('div', 'divider');
  detail.appendChild(divider2);

  const pickableTitle = el('div', 'pt-detail-pickable-title');
  pickableTitle.textContent = 'PICKABLE IN PIXISTRY';
  detail.appendChild(pickableTitle);

  const speciesList = el('div', 'pt-species-list');
  for (const entry of speciesFor(selectedElement.symbol, byLabel)) {
    const isCompound = entry.label !== pureLabel;
    const locked = !!cb.isPaintLocked?.(entry.specId);
    const row = el('div', 'pt-species-row');

    const pickButton = el('button', 'pt-species-btn');
    pickButton.style.setProperty('--swatch', entry.color);
    pickButton.style.color = contrastTextColor(entry.color);
    pickButton.style.textShadow = contrastTextShadow(entry.color);
    pickButton.textContent = `${locked ? '🔒 ' : ''}${entry.label} — ${isCompound ? 'compound' : 'pure element'}`;
    pickButton.disabled = locked;
    if (locked) {
      pickButton.classList.add('locked');
      pickButton.title = 'Not available in this experiment';
    }
    pickButton.onclick = () => cb.onSelectSpecies(entry.specId);
    row.appendChild(pickButton);

    if (cb.pinnable === false) {
      speciesList.appendChild(row);
      continue;
    }
    const pinned = cb.isPinned(entry.label);
    const pinButton = el('button', 'pin-btn');
    pinButton.classList.toggle('pinned', pinned);
    pinButton.title = pinned ? 'Unpin from toolbar' : 'Pin to toolbar';
    pinButton.textContent = '📌';
    pinButton.onclick = () => cb.onTogglePin(entry.label);
    row.appendChild(pinButton);

    speciesList.appendChild(row);
  }
  detail.appendChild(speciesList);
}

/** Every paintable species an element participates in -- its pure form first,
 * then its compounds -- resolved against the live palette by label (entries
 * periodic-data.ts names but the palette doesn't carry are skipped). Shared by
 * the detail pane and the grid's "is anything here still unlocked?" check so
 * the two can't disagree about what an element offers. */
function speciesFor(symbol: string, byLabel: Map<string, PaletteEntry>): PaletteEntry[] {
  const pureLabel = PURE_FOR_ELEMENT[symbol];
  const labels = [...(pureLabel ? [pureLabel] : []), ...(COMPOUNDS_FOR_ELEMENT[symbol] ?? [])];
  return labels.flatMap((label) => {
    const entry = byLabel.get(label);
    return entry ? [entry] : [];
  });
}
