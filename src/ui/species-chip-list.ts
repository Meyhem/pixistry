// Reusable "removable chip per selected species, plus an Add button" list --
// shared by the conveyor-tube's species filter panel and the Filter
// apparatus's allow-list panel (see side-panel.ts's addTubePanel/
// addFilterPanel). Rendering only: callers own what the selected set means
// (accept-all vs deny-all when empty) and how Add opens the periodic-table
// modal (see app.ts's ptTarget dispatch) -- this component just draws
// whatever specIds it's given and reports add/remove clicks back.
import type { PaletteEntry } from '../sim/species';
import { contrastTextColor, contrastTextShadow } from './contrast';
import { el } from './dom';

export interface SpeciesChipListCallbacks {
  onAdd(): void;
  onRemove(specId: number): void;
}

export function buildSpeciesChipList(
  container: HTMLElement,
  palette: readonly PaletteEntry[],
  selectedSpecIds: ReadonlySet<number>,
  cb: SpeciesChipListCallbacks,
): void {
  const byId = new Map(palette.map((entry) => [entry.specId, entry]));

  const list = el('div', 'species-chip-list');
  for (const specId of selectedSpecIds) {
    const entry = byId.get(specId);
    if (!entry) continue;

    const chip = el('div', 'species-chip');
    chip.style.setProperty('--swatch', entry.color);
    chip.style.color = contrastTextColor(entry.color);
    chip.style.textShadow = contrastTextShadow(entry.color);

    const name = el('span', 'species-chip-name');
    name.textContent = entry.label;
    chip.appendChild(name);

    const removeBtn = el('button', 'species-chip-remove');
    removeBtn.textContent = '×';
    removeBtn.title = `Remove ${entry.label}`;
    removeBtn.onclick = () => cb.onRemove(specId);
    chip.appendChild(removeBtn);

    list.appendChild(chip);
  }

  const addBtn = el('button', 'species-chip-add-btn');
  addBtn.textContent = '+ Add species';
  addBtn.onclick = cb.onAdd;
  list.appendChild(addBtn);

  container.appendChild(list);
}
