// The top control card: four labelled rows (ELEMENTS/APPARATUS/TOOLS/
// SIMULATION). Species get a "pinned quick row" (see app.ts's pin
// persistence) rather than listing all 18 paintable species at once -- the
// full set is reachable through the periodic-table modal (periodic-table.ts).
// Rebuilt wholesale on every state change (tool selection, pin toggle, sim
// controls) rather than patched in place -- plain DOM, but declarative like
// the rest of src/ui, and cheap at this element count.
import type { PaletteEntry } from '../sim/species';
import type { WallMaterial } from '../sim/walls';
import { RADIATOR_LABEL } from '../sim/radiators';
import { FUNNEL_LABEL } from '../sim/funnel';
import { STIRRER_LABEL } from '../sim/stirrer';
import { TUBE_LABEL } from '../sim/tube';
import { FILTER_LABEL } from '../sim/filter-apparatus';
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
  | 'flask-erlenmeyer'
  | 'flask-erlenmeyer-stirred'
  | 'select-apparatus';

export const SELECT_APPARATUS_LABEL = 'Select';
export const SELECT_APPARATUS_COLOR = '#4da3ff';

export interface ToolbarCallbacks {
  isPaintActive(specId: number): boolean;
  isWallActive(specId: number): boolean;
  isToolActive(kind: ToolKind): boolean;
  isPinned(label: string): boolean;
  onSelectPaint(specId: number): void;
  onSelectWall(specId: number): void;
  onSelectTool(kind: ToolKind): void;
  onTogglePin(label: string): void;
  onOpenPeriodicTable(): void;
  running: boolean;
  speed: number;
  onTogglePause(): void;
  onStep(): void;
  onSetSpeed(speed: number): void;
}

const SPEEDS = [0.25, 0.5, 1, 2, 4];

function makeRow(label: string): { row: HTMLDivElement; items: HTMLDivElement } {
  const row = el('div', 'control-row');
  const labelEl = el('div', 'control-row-label');
  labelEl.textContent = label;
  const items = el('div', 'control-row-items');
  row.appendChild(labelEl);
  row.appendChild(items);
  return { row, items };
}

function makePaletteButton(label: string, swatch: string | null, active: boolean, onClick: () => void, disabled = false): HTMLButtonElement {
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
  button.disabled = disabled;
  button.onclick = onClick;
  return button;
}

interface DropdownOption {
  value: string;
  label: string;
  active: boolean;
  onSelect: () => void;
}

function makeDropdown(placeholder: string, options: DropdownOption[]): HTMLSelectElement {
  const select = el('select', 'dropdown-select');
  const ph = el('option');
  ph.value = '';
  ph.textContent = placeholder;
  ph.disabled = true;
  select.appendChild(ph);
  for (const opt of options) {
    const option = el('option');
    option.value = opt.value;
    option.textContent = opt.label;
    select.appendChild(option);
  }
  const activeOpt = options.find((opt) => opt.active);
  select.value = activeOpt ? activeOpt.value : '';
  select.onchange = () => {
    const chosen = options.find((opt) => opt.value === select.value);
    chosen?.onSelect();
  };
  return select;
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
  const glassWall = walls.find((w) => w.kind === 'glass');
  const insulatorWall = walls.find((w) => w.kind === 'insulator');

  const glasswareOptions: DropdownOption[] = [
    {
      value: 'flask-erlenmeyer',
      label: 'Erlenmeyer',
      active: cb.isToolActive('flask-erlenmeyer'),
      onSelect: () => cb.onSelectTool('flask-erlenmeyer'),
    },
    {
      value: 'flask-erlenmeyer-stirred',
      label: 'Erlenmeyer (stirred)',
      active: cb.isToolActive('flask-erlenmeyer-stirred'),
      onSelect: () => cb.onSelectTool('flask-erlenmeyer-stirred'),
    },
  ];
  if (glassWall) {
    glasswareOptions.push({
      value: `wall-${glassWall.specId}`,
      label: 'Free Draw',
      active: cb.isWallActive(glassWall.specId),
      onSelect: () => cb.onSelectWall(glassWall.specId),
    });
  }
  apparatus.items.appendChild(makeDropdown('Glassware', glasswareOptions));

  const thermalOptions: DropdownOption[] = [];
  if (insulatorWall) {
    thermalOptions.push({
      value: `wall-${insulatorWall.specId}`,
      label: 'Insulator',
      active: cb.isWallActive(insulatorWall.specId),
      onSelect: () => cb.onSelectWall(insulatorWall.specId),
    });
  }
  thermalOptions.push(
    { value: 'radiator', label: RADIATOR_LABEL, active: cb.isToolActive('radiator'), onSelect: () => cb.onSelectTool('radiator') },
    { value: 'stirrer', label: STIRRER_LABEL, active: cb.isToolActive('stirrer'), onSelect: () => cb.onSelectTool('stirrer') },
  );
  apparatus.items.appendChild(makeDropdown('Thermal & Mixing', thermalOptions));

  const flowOptions: DropdownOption[] = [
    { value: 'funnel', label: FUNNEL_LABEL, active: cb.isToolActive('funnel'), onSelect: () => cb.onSelectTool('funnel') },
    { value: 'tube', label: TUBE_LABEL, active: cb.isToolActive('tube'), onSelect: () => cb.onSelectTool('tube') },
    { value: 'filter', label: FILTER_LABEL, active: cb.isToolActive('filter'), onSelect: () => cb.onSelectTool('filter') },
  ];
  apparatus.items.appendChild(makeDropdown('Flow Control', flowOptions));

  container.appendChild(apparatus.row);

  const tools = makeRow('TOOLS');
  tools.items.appendChild(makePaletteButton('Erase', null, cb.isToolActive('erase'), () => cb.onSelectTool('erase')));
  tools.items.appendChild(makePaletteButton('Mix', '#c9a8ff', cb.isToolActive('mixer'), () => cb.onSelectTool('mixer')));
  tools.items.appendChild(makePaletteButton('Grab', '#f2d94e', cb.isToolActive('grabber'), () => cb.onSelectTool('grabber')));
  tools.items.appendChild(
    makePaletteButton(SELECT_APPARATUS_LABEL, SELECT_APPARATUS_COLOR, cb.isToolActive('select-apparatus'), () =>
      cb.onSelectTool('select-apparatus'),
    ),
  );
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
