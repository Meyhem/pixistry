// The periodic-table modal: a full periods-1-5 grid (Z 1-54), with every
// element the sim actually simulates clickable and everything else shown
// dimmed for context. Picking a clickable element shows its melt/boil point
// and the paintable species it participates in (pure element, plus any
// paintable compounds from periodic-data.ts's COMPOUNDS_FOR_ELEMENT), each
// pickable and pinnable from right there.
import type { PaletteEntry } from '../sim/species';
import { contrastTextColor, contrastTextShadow } from './contrast';
import { formatCelsius } from './format';
import { CATEGORY_HUE, CATEGORY_LABEL, COMPOUNDS_FOR_ELEMENT, ELEMENTS, PURE_FOR_ELEMENT } from './periodic-data';
import { el, propRow } from './dom';

export interface PeriodicTableCallbacks {
  selectedSymbol: string | null;
  isPinned(label: string): boolean;
  onSelectElement(symbol: string): void;
  onSelectSpecies(specId: number): void;
  onTogglePin(label: string): void;
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
  closeButton.onclick = cb.onClose;
  header.appendChild(closeButton);
  modal.appendChild(header);

  const body = el('div', 'pt-modal-body');
  modal.appendChild(body);

  const grid = el('div', 'pt-grid');
  const byLabel = new Map(palette.map((entry) => [entry.label, entry]));

  for (const element of ELEMENTS) {
    const supported = element.symbol in PURE_FOR_ELEMENT;
    const hue = CATEGORY_HUE[element.category];
    const isSelected = element.symbol === cb.selectedSymbol;

    const cell = el('button', 'pt-cell');
    cell.style.gridColumn = String(element.group);
    cell.style.gridRow = String(element.period);
    cell.style.setProperty('--hue', String(hue));
    cell.classList.toggle('supported', supported);
    cell.classList.toggle('selected', isSelected);
    cell.title = `${element.name} (${CATEGORY_LABEL[element.category]})${supported ? '' : ' — not simulated'}`;
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
  const compoundLabels = COMPOUNDS_FOR_ELEMENT[selectedElement.symbol] ?? [];
  const speciesLabels = pureLabel ? [pureLabel, ...compoundLabels] : compoundLabels;
  for (const label of speciesLabels) {
    const entry = byLabel.get(label);
    if (!entry) continue;
    const isCompound = label !== pureLabel;
    const row = el('div', 'pt-species-row');

    const pickButton = el('button', 'pt-species-btn');
    pickButton.style.setProperty('--swatch', entry.color);
    pickButton.style.color = contrastTextColor(entry.color);
    pickButton.style.textShadow = contrastTextShadow(entry.color);
    pickButton.textContent = `${entry.label} — ${isCompound ? 'compound' : 'pure element'}`;
    pickButton.onclick = () => cb.onSelectSpecies(entry.specId);
    row.appendChild(pickButton);

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
