// The floating HUD: the only chrome that stays on screen while you work.
// It replaces the old always-docked toolbar card (~170px tall) and side panel
// (260px wide) with two translucent strips that hover over the corners of a
// full-bleed canvas -- top strip for identity/transport/modal entry points,
// bottom strip for the two controls that genuinely get adjusted mid-experiment
// (brush width and brush temperature) plus the temperature legend.
//
// Everything else -- picking a tool (tool-rail.ts's left rail, and
// tool-chest.ts for species), per-tool configuration
// (side-panel.ts rendered into a modal), the periodic table, comfort settings,
// save/restore/clear -- lives behind a modal, so no pixel of bench is spent on
// a control the player isn't using right now.
import { contrastTextColor, contrastTextShadow } from './contrast';
import { el } from './dom';
import { formatCelsius } from './format';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export interface HudCallbacks {
  /** Active tool -- label/swatch come straight from side-panel.ts's ToolMeta,
   * so the readout, the rail's highlighted slot and the tool-settings modal
   * all agree. */
  toolLabel: string;
  toolColor: string;
  toolCategory: string;
  /** Whether the active tool has any configuration beyond the two brush
   * sliders below; the ⚙ button is hidden entirely when it doesn't, rather
   * than opening an empty modal. */
  hasToolSettings: boolean;
  onOpenToolSettings(): void;

  running: boolean;
  speed: number;
  onTogglePause(): void;
  onStep(): void;
  onSetSpeed(speed: number): void;

  onOpenBenchMenu(): void;

  campaign: boolean;

  showBrushWidth: boolean;
  brushWidth: number;
  onSetBrushWidth(value: number): void;
  showBrushTemp: boolean;
  brushTempC: number;
  onSetBrushTemp(value: number): void;

  hotLabel: string;
  coldLabel: string;
}

// Kept in lockstep with side-panel.ts's own constants: the same two values
// are still editable there (in the tool-settings modal) for tools whose panel
// shows them, and a mismatched range would silently clamp differently
// depending on which control the player happened to reach for.
const MIN_RADIUS = 1;
const MAX_RADIUS = 12;
const MIN_TEMP_C = -250;
const MAX_TEMP_C = 1500;
const TEMP_STEP_C = 5;

/** A compact labelled slider for the bottom strip. Unlike side-panel.ts's
 * `addSlider` this puts label, track and value on one line -- the strip is
 * ~34px tall and can't afford a stacked row. The value readout is patched in
 * place on input (never a rebuild), so dragging isn't interrupted. */
function inlineSlider(
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  format: (v: number) => string,
  onInput: (v: number) => void,
): HTMLDivElement {
  const wrap = el('div', 'hud-slider');
  const labelEl = el('span', 'hud-slider-label');
  labelEl.textContent = label;
  const input = el('input', 'hud-slider-input');
  input.type = 'range';
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  const valueEl = el('span', 'hud-slider-value');
  valueEl.textContent = format(value);
  input.oninput = () => {
    const next = Number(input.value);
    valueEl.textContent = format(next);
    onInput(next);
  };
  wrap.appendChild(labelEl);
  wrap.appendChild(input);
  wrap.appendChild(valueEl);
  return wrap;
}

export function buildHud(top: HTMLElement, bottom: HTMLElement, cb: HudCallbacks): void {
  top.innerHTML = '';
  bottom.innerHTML = '';

  // --- top strip -----------------------------------------------------------
  const left = el('div', 'hud-cluster');

  const mark = el('div', 'hud-mark');
  mark.textContent = 'PIXISTRY';
  left.appendChild(mark);
  if (cb.campaign) {
    const badge = el('span', 'mode-badge');
    badge.textContent = 'CAMPAIGN';
    left.appendChild(badge);
  }

  // A readout, not a button: picking a tool is the rail's job now (see
  // tool-rail.ts, which highlights the active slot). This says *what* is
  // selected in words, which fifteen icons on their own can't.
  const chip = el('div', 'hud-active-tool');
  const swatch = el('span', 'hud-active-swatch');
  swatch.style.background = cb.toolColor || '#3a3d3a';
  const chipText = el('span', 'hud-active-text');
  const chipLabel = el('span', 'hud-active-label');
  chipLabel.textContent = cb.toolLabel;
  chipText.appendChild(chipLabel);
  if (cb.toolCategory) {
    const chipCategory = el('span', 'hud-active-category');
    chipCategory.textContent = cb.toolCategory;
    chipText.appendChild(chipCategory);
  }
  chip.appendChild(swatch);
  chip.appendChild(chipText);
  left.appendChild(chip);
  top.appendChild(left);

  const right = el('div', 'hud-cluster');

  const pauseButton = el('button', 'hud-btn pause-btn');
  pauseButton.classList.toggle('active', !cb.running);
  pauseButton.textContent = cb.running ? '⏸' : '▶';
  pauseButton.title = cb.running ? 'Pause (Space)' : 'Resume (Space)';
  pauseButton.onclick = cb.onTogglePause;
  right.appendChild(pauseButton);

  const stepButton = el('button', 'hud-btn');
  stepButton.textContent = '⏭';
  stepButton.title = 'Step one tick (.)';
  stepButton.onclick = cb.onStep;
  right.appendChild(stepButton);

  const speedSelect = el('select', 'speed-select hud-select');
  speedSelect.title = 'Simulation speed';
  for (const s of SPEEDS) {
    const option = el('option');
    option.value = String(s);
    option.textContent = `${s}x`;
    if (s === cb.speed) option.selected = true;
    speedSelect.appendChild(option);
  }
  speedSelect.onchange = () => cb.onSetSpeed(Number(speedSelect.value));
  right.appendChild(speedSelect);

  right.appendChild(el('span', 'hud-sep'));

  const benchButton = el('button', 'hud-btn');
  benchButton.textContent = '⋯';
  benchButton.title = 'Bench menu -- save, restore, clear, settings (M)';
  benchButton.onclick = cb.onOpenBenchMenu;
  right.appendChild(benchButton);

  top.appendChild(right);

  // --- bottom strip --------------------------------------------------------
  const brush = el('div', 'hud-cluster');
  if (cb.showBrushWidth) {
    brush.appendChild(
      inlineSlider('Width', cb.brushWidth, MIN_RADIUS, MAX_RADIUS, 1, (v) => `${v}px`, cb.onSetBrushWidth),
    );
  }
  if (cb.showBrushTemp) {
    brush.appendChild(
      inlineSlider('Temp', cb.brushTempC, MIN_TEMP_C, MAX_TEMP_C, TEMP_STEP_C, (v) => formatCelsius(v), cb.onSetBrushTemp),
    );
  }
  if (cb.hasToolSettings) {
    const settingsButton = el('button', 'hud-btn hud-btn-labelled');
    settingsButton.textContent = '⚙ Tool settings';
    settingsButton.title = `Configure ${cb.toolLabel} (E)`;
    settingsButton.style.setProperty('--swatch', cb.toolColor || '#3a3d3a');
    settingsButton.style.color = contrastTextColor(cb.toolColor || '#3a3d3a');
    settingsButton.style.textShadow = contrastTextShadow(cb.toolColor || '#3a3d3a');
    settingsButton.classList.add('hud-btn-swatch');
    settingsButton.onclick = cb.onOpenToolSettings;
    brush.appendChild(settingsButton);
  }
  // An empty cluster would still paint its background pill over the bench.
  if (brush.childElementCount > 0) bottom.appendChild(brush);

  const legend = el('div', 'hud-cluster hud-legend');
  for (const [cls, text] of [
    ['normal', 'NORMAL'],
    ['hot', `HOT · >${cb.hotLabel}`],
    ['cold', `COLD · <${cb.coldLabel}`],
  ] as const) {
    const item = el('div', 'legend-item');
    item.appendChild(el('span', `legend-swatch ${cls}`));
    const label = el('span', 'legend-label');
    label.textContent = text;
    item.appendChild(label);
    legend.appendChild(item);
  }
  bottom.appendChild(legend);
}

export interface BenchMenuCallbacks {
  hasSnapshot: boolean;
  onSnapshotWorld(): void;
  onRestoreWorld(): void;
  resetWorldLabel: string;
  onResetWorld(): void;
  onOpenComfortSettings(): void;
  onExitToMenu?(): void;
  onClose(): void;
}

/** The ⋯ menu: the session-level actions that used to sit in the toolbar's
 * SIMULATION row. All of them are either rare (save/restore/clear) or leave
 * the bench entirely (settings/menu), so none of them earn permanent space. */
export function buildBenchMenu(container: HTMLElement, cb: BenchMenuCallbacks): void {
  container.innerHTML = '';

  const modal = el('div', 'pt-modal bench-menu-modal');
  container.appendChild(modal);

  const header = el('div', 'pt-modal-header');
  const title = el('div', 'pt-modal-title');
  title.textContent = 'Bench';
  header.appendChild(title);
  const closeButton = el('button', 'pt-close-btn');
  closeButton.textContent = '✕';
  closeButton.title = 'Close (Esc)';
  closeButton.onclick = cb.onClose;
  header.appendChild(closeButton);
  modal.appendChild(header);

  const list = el('div', 'bench-menu-list');
  const add = (label: string, hint: string, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}): void => {
    const row = el('button', 'bench-menu-item');
    if (opts.danger) row.classList.add('danger');
    row.disabled = !!opts.disabled;
    const rowLabel = el('span', 'bench-menu-label');
    rowLabel.textContent = label;
    const rowHint = el('span', 'bench-menu-hint');
    rowHint.textContent = hint;
    row.appendChild(rowLabel);
    row.appendChild(rowHint);
    row.onclick = () => {
      onClick();
      cb.onClose();
    };
    list.appendChild(row);
  };

  add('Save', 'Snapshot the grid so you can come back to it', cb.onSnapshotWorld);
  add('Restore', cb.hasSnapshot ? 'Go back to the last saved grid' : 'Save first -- nothing saved yet', cb.onRestoreWorld, {
    disabled: !cb.hasSnapshot,
  });
  add(cb.resetWorldLabel, 'Wipe the grid and start over', cb.onResetWorld, { danger: true });
  add('Comfort settings', 'Quiet mode, reduced motion, high contrast, bigger UI', cb.onOpenComfortSettings);
  if (cb.onExitToMenu) add('Back to the title screen', 'Leaves the bench -- unsaved work is lost', cb.onExitToMenu, { danger: true });

  modal.appendChild(list);
}
