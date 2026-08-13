// The top control card: four labelled rows (ELEMENTS/APPARATUS/TOOLS/
// SIMULATION). Species get a "pinned quick row" (see app.ts's pin
// persistence) rather than listing all 18 paintable species at once -- the
// full set is reachable through the periodic-table modal (periodic-table.ts).
// Rebuilt wholesale on every state change (tool selection, pin toggle, sim
// controls) rather than patched in place -- plain DOM, but declarative like
// the rest of src/ui, and cheap at this element count.
import type { PaletteEntry } from '../sim/species';
import type { WallMaterial } from '../sim/walls';
import { RADIATOR_COLOR, RADIATOR_LABEL } from '../sim/radiators';
import { contrastTextColor, contrastTextShadow } from './contrast';

export interface ToolbarCallbacks {
  isPaintActive(specId: number): boolean;
  isWallActive(specId: number): boolean;
  isToolActive(kind: 'radiator' | 'erase' | 'mixer' | 'grabber'): boolean;
  isPinned(label: string): boolean;
  onSelectPaint(specId: number): void;
  onSelectWall(specId: number): void;
  onSelectTool(kind: 'radiator' | 'erase' | 'mixer' | 'grabber'): void;
  onTogglePin(label: string): void;
  onOpenPeriodicTable(): void;
  running: boolean;
  speed: number;
  onTogglePause(): void;
  onStep(): void;
  onSetSpeed(speed: number): void;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function makeRow(label: string): { row: HTMLDivElement; items: HTMLDivElement } {
  const row = el('div', 'control-row');
  const labelEl = el('div', 'control-row-label');
  labelEl.textContent = label;
  const items = el('div', 'control-row-items');
  row.appendChild(labelEl);
  row.appendChild(items);
  return { row, items };
}

function makePaletteButton(label: string, swatch: string | null, active: boolean, onClick: () => void): HTMLButtonElement {
  const button = el('button', 'palette-btn');
  if (active) button.classList.add('active');
  if (swatch) {
    button.style.setProperty('--swatch', swatch);
    button.style.color = contrastTextColor(swatch);
    button.style.textShadow = contrastTextShadow(swatch);
  } else {
    button.classList.add('erase-btn');
  }
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

function makeQuickSpeciesButton(entry: PaletteEntry, active: boolean, pinned: boolean, cb: ToolbarCallbacks): HTMLDivElement {
  const wrap = el('div', 'quick-item');
  const button = makePaletteButton(entry.label, entry.color, active, () => cb.onSelectPaint(entry.specId));
  wrap.appendChild(button);

  const pinButton = el('button', 'pin-btn');
  pinButton.title = pinned ? 'Unpin' : 'Pin';
  pinButton.classList.toggle('pinned', pinned);
  pinButton.textContent = '📌';
  pinButton.onclick = (event) => {
    event.stopPropagation();
    cb.onTogglePin(entry.label);
  };
  wrap.appendChild(pinButton);

  return wrap;
}

export function buildToolbar(
  container: HTMLElement,
  palette: PaletteEntry[],
  walls: readonly WallMaterial[],
  pinnedLabels: readonly string[],
  cb: ToolbarCallbacks,
): void {
  container.innerHTML = '';

  const byLabel = new Map(palette.map((entry) => [entry.label, entry]));

  const elements = makeRow('ELEMENTS');
  for (const label of pinnedLabels) {
    const entry = byLabel.get(label);
    if (!entry) continue;
    elements.items.appendChild(makeQuickSpeciesButton(entry, cb.isPaintActive(entry.specId), true, cb));
  }
  const ptButton = el('button', 'pt-open-btn');
  const dots = el('span', 'pt-dots');
  for (let i = 0; i < 9; i++) dots.appendChild(el('span', 'pt-dot'));
  ptButton.appendChild(dots);
  ptButton.appendChild(document.createTextNode('Periodic table'));
  ptButton.onclick = cb.onOpenPeriodicTable;
  elements.items.appendChild(ptButton);
  container.appendChild(elements.row);

  const apparatus = makeRow('APPARATUS');
  for (const wall of walls) {
    apparatus.items.appendChild(makePaletteButton(wall.label, wall.color, cb.isWallActive(wall.specId), () => cb.onSelectWall(wall.specId)));
  }
  apparatus.items.appendChild(
    makePaletteButton(RADIATOR_LABEL, RADIATOR_COLOR, cb.isToolActive('radiator'), () => cb.onSelectTool('radiator')),
  );
  container.appendChild(apparatus.row);

  const tools = makeRow('TOOLS');
  tools.items.appendChild(makePaletteButton('Erase', null, cb.isToolActive('erase'), () => cb.onSelectTool('erase')));
  tools.items.appendChild(makePaletteButton('Mixer', '#c9a8ff', cb.isToolActive('mixer'), () => cb.onSelectTool('mixer')));
  tools.items.appendChild(makePaletteButton('Grabber', '#f2d94e', cb.isToolActive('grabber'), () => cb.onSelectTool('grabber')));
  container.appendChild(tools.row);

  const sim = makeRow('SIMULATION');
  const pauseButton = el('button', 'pause-btn');
  pauseButton.classList.toggle('active', !cb.running);
  pauseButton.textContent = cb.running ? 'Pause' : 'Resume';
  pauseButton.onclick = cb.onTogglePause;
  sim.items.appendChild(pauseButton);

  const stepButton = el('button', 'step-btn');
  stepButton.textContent = 'Step';
  stepButton.onclick = cb.onStep;
  sim.items.appendChild(stepButton);

  const speedSelect = el('select', 'speed-select');
  for (const s of SPEEDS) {
    const option = el('option');
    option.value = String(s);
    option.textContent = `${s}x`;
    if (s === cb.speed) option.selected = true;
    speedSelect.appendChild(option);
  }
  speedSelect.onchange = () => cb.onSetSpeed(Number(speedSelect.value));
  sim.items.appendChild(speedSelect);
  container.appendChild(sim.row);
}
