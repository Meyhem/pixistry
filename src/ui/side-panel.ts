// The right-hand card describing the active tool: swatch/label/category
// chip, species melt/boil/phase readout when relevant, brush width, brush
// temperature, and (for the radiator tool) radiation radius + target
// temperature. The addition-funnel tool and the select-apparatus tool
// (see app.ts) share a "funnel panel" section here -- the same field set is
// used both to configure a funnel before placement and to live-edit an
// already-placed one, the only difference being whether a Reset button and
// a remaining-supply readout are shown (meta.funnelPanel). Rebuilt wholesale
// whenever the active tool or any of its settings change -- see app.ts's
// render().
import { formatCelsius } from './format';
import { contrastTextColor, contrastTextShadow } from './contrast';

export interface ToolMeta {
  label: string;
  color: string;
  category: string;
  isSpecies: boolean;
  meltLabel: string;
  boilLabel: string;
  phaseLabel: string;
  isThermal: boolean;
  showBrushTemp: boolean;
  showBrushWidth: boolean;
  /** 'none': no funnel section. 'config': pre-placement settings (the
   * funnel tool). 'edit-empty': select-apparatus tool with nothing selected
   * yet. 'edit': select-apparatus tool with a placed funnel selected. */
  funnelPanel: 'none' | 'config' | 'edit-empty' | 'edit';
}

export interface FunnelFieldValues {
  specLabel: string;
  specColor: string;
  tempC: number;
  ratePerMinute: number;
  totalMode: 'finite' | 'infinite';
  totalAmount: number;
  /** Only meaningful when funnelPanel === 'edit'. */
  remaining: number | null;
}

export interface SidePanelCallbacks {
  brushWidth: number;
  onSetBrushWidth(value: number): void;
  brushTempC: number;
  onSetBrushTemp(value: number): void;
  radiationRadius: number;
  onSetRadiationRadius(value: number): void;
  targetTempC: number;
  onSetTargetTemp(value: number): void;
  funnelFields: FunnelFieldValues;
  onOpenFunnelSpeciesPicker(): void;
  onSetFunnelTemp(value: number): void;
  onSetFunnelRate(value: number): void;
  onSetFunnelTotalMode(mode: 'finite' | 'infinite'): void;
  onSetFunnelTotalAmount(value: number): void;
  onResetFunnel(): void;
}

const MIN_RADIUS = 1;
const MAX_RADIUS = 12;
const MIN_RADIATION_RADIUS = 1;
const MAX_RADIATION_RADIUS = 15;
const MIN_TEMP_C = -250;
const MAX_TEMP_C = 1500;
const TEMP_STEP_C = 5;
const MIN_FUNNEL_RATE = 1;
const MAX_FUNNEL_RATE = 600;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function addSlider(
  container: HTMLElement,
  label: string,
  min: number,
  max: number,
  step: number,
  value: number,
  formatValue: (v: number) => string,
  onChange: (v: number) => void,
): void {
  const wrap = el('div', 'setting');
  const row = el('div', 'setting-row');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = label;
  const valueEl = el('span', 'setting-value');
  valueEl.textContent = formatValue(value);
  row.appendChild(labelEl);
  row.appendChild(valueEl);

  const slider = el('input', 'setting-slider');
  slider.type = 'range';
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  slider.value = String(value);
  slider.oninput = () => {
    const next = Number(slider.value);
    valueEl.textContent = formatValue(next);
    onChange(next);
  };

  wrap.appendChild(row);
  wrap.appendChild(slider);
  container.appendChild(wrap);
}

function addNumberField(container: HTMLElement, label: string, value: number, min: number, step: number, onChange: (v: number) => void): void {
  const wrap = el('div', 'setting');
  const row = el('div', 'setting-row');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = label;
  row.appendChild(labelEl);
  wrap.appendChild(row);

  const input = el('input', 'setting-number');
  input.type = 'number';
  input.min = String(min);
  input.step = String(step);
  input.value = String(value);
  input.oninput = () => {
    const next = Number(input.value);
    if (Number.isFinite(next)) onChange(next);
  };
  wrap.appendChild(input);
  container.appendChild(wrap);
}

function addDivider(container: HTMLElement): void {
  container.appendChild(el('div', 'divider'));
}

function addFunnelSpeciesButton(container: HTMLElement, label: string, color: string, onClick: () => void): void {
  const wrap = el('div', 'setting');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = 'Species';
  wrap.appendChild(labelEl);

  const button = el('button', 'funnel-species-btn');
  button.style.setProperty('--swatch', color);
  button.style.color = contrastTextColor(color);
  button.style.textShadow = contrastTextShadow(color);
  button.textContent = label;
  button.onclick = onClick;
  wrap.appendChild(button);
  container.appendChild(wrap);
}

function addTotalModeToggle(container: HTMLElement, mode: 'finite' | 'infinite', onChange: (mode: 'finite' | 'infinite') => void): void {
  const wrap = el('div', 'setting');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = 'Total amount';
  wrap.appendChild(labelEl);

  const row = el('div', 'funnel-toggle-row');
  const finiteBtn = el('button', 'funnel-toggle-btn');
  finiteBtn.textContent = 'Finite';
  finiteBtn.classList.toggle('active', mode === 'finite');
  finiteBtn.onclick = () => onChange('finite');
  const infiniteBtn = el('button', 'funnel-toggle-btn');
  infiniteBtn.textContent = 'Infinite';
  infiniteBtn.classList.toggle('active', mode === 'infinite');
  infiniteBtn.onclick = () => onChange('infinite');
  row.appendChild(finiteBtn);
  row.appendChild(infiniteBtn);
  wrap.appendChild(row);
  container.appendChild(wrap);
}

function addFunnelPanel(container: HTMLElement, meta: ToolMeta, cb: SidePanelCallbacks): void {
  if (meta.funnelPanel === 'none') return;
  addDivider(container);

  if (meta.funnelPanel === 'edit-empty') {
    const hint = el('div', 'setting-hint-box');
    const body = el('p', 'setting-hint');
    body.textContent = 'Click a placed apparatus on the grid to select it.';
    hint.appendChild(body);
    container.appendChild(hint);
    return;
  }

  const f = cb.funnelFields;
  addFunnelSpeciesButton(container, f.specLabel, f.specColor, cb.onOpenFunnelSpeciesPicker);
  addSlider(container, 'Spawn temperature', MIN_TEMP_C, MAX_TEMP_C, TEMP_STEP_C, f.tempC, formatCelsius, cb.onSetFunnelTemp);
  addSlider(container, 'Rate (px/min)', MIN_FUNNEL_RATE, MAX_FUNNEL_RATE, 1, f.ratePerMinute, (v) => String(v), cb.onSetFunnelRate);
  addTotalModeToggle(container, f.totalMode, cb.onSetFunnelTotalMode);
  if (f.totalMode === 'finite') {
    addNumberField(container, 'Amount', f.totalAmount, 1, 1, cb.onSetFunnelTotalAmount);
  }

  if (meta.funnelPanel === 'edit') {
    const status = el('div', 'prop-row');
    const l = el('span', 'prop-label');
    l.textContent = 'Remaining';
    const v = el('span', 'prop-value');
    v.textContent = f.remaining === null ? 'infinite' : String(f.remaining);
    status.appendChild(l);
    status.appendChild(v);
    container.appendChild(status);

    const resetBtn = el('button', 'funnel-reset-btn');
    resetBtn.textContent = 'Reset';
    resetBtn.onclick = cb.onResetFunnel;
    container.appendChild(resetBtn);
  }

  const hint = el('div', 'setting-hint-box');
  const hintTitle = el('div', 'setting-hint-title');
  hintTitle.textContent = 'HOW IT WORKS';
  const hintBody = el('p', 'setting-hint');
  hintBody.textContent =
    meta.funnelPanel === 'config'
      ? 'Rotate with the scroll wheel while hovering the grid, then click to place. Drips one pixel at a fixed interval; pauses automatically if its outlet is blocked, and resumes once it clears.'
      : "Editing a placed funnel's settings only affects future drips -- Reset refills it back to its full total (or infinite) and un-pauses it.";
  hint.appendChild(hintTitle);
  hint.appendChild(hintBody);
  container.appendChild(hint);
}

export function buildSidePanel(container: HTMLElement, meta: ToolMeta, cb: SidePanelCallbacks): void {
  container.innerHTML = '';

  const header = el('div', 'side-panel-header');
  const swatch = el('div', 'side-panel-swatch');
  swatch.style.background = meta.color;
  header.appendChild(swatch);

  const headerText = el('div', 'side-panel-header-text');
  const title = el('div', 'side-panel-title');
  title.textContent = meta.label;
  const chip = el('div', 'category-chip');
  chip.textContent = meta.category;
  headerText.appendChild(title);
  headerText.appendChild(chip);
  header.appendChild(headerText);
  container.appendChild(header);

  addDivider(container);

  if (meta.isSpecies) {
    const props = el('div', 'prop-list');
    for (const [label, value] of [
      ['Melting point', meta.meltLabel],
      ['Boiling point', meta.boilLabel],
      ['Phase at 20°C', meta.phaseLabel],
    ] as const) {
      const row = el('div', 'prop-row');
      const l = el('span', 'prop-label');
      l.textContent = label;
      const v = el('span', 'prop-value');
      v.textContent = value;
      row.appendChild(l);
      row.appendChild(v);
      props.appendChild(row);
    }
    container.appendChild(props);
    addDivider(container);
  }

  if (meta.showBrushWidth) {
    addSlider(container, 'Brush width', MIN_RADIUS, MAX_RADIUS, 1, cb.brushWidth, (v) => String(v), cb.onSetBrushWidth);
  }
  if (meta.showBrushTemp) {
    addSlider(container, 'Brush temperature', MIN_TEMP_C, MAX_TEMP_C, TEMP_STEP_C, cb.brushTempC, formatCelsius, cb.onSetBrushTemp);
  }

  if (meta.isThermal) {
    addSlider(
      container,
      'Radiation radius',
      MIN_RADIATION_RADIUS,
      MAX_RADIATION_RADIUS,
      1,
      cb.radiationRadius,
      (v) => String(v),
      cb.onSetRadiationRadius,
    );
    addSlider(container, 'Target temperature', MIN_TEMP_C, MAX_TEMP_C, TEMP_STEP_C, cb.targetTempC, formatCelsius, cb.onSetTargetTemp);

    const hint = el('div', 'setting-hint-box');
    const hintTitle = el('div', 'setting-hint-title');
    hintTitle.textContent = 'HOW IT WORKS';
    const hintBody = el('p', 'setting-hint');
    hintBody.textContent =
      'Radiates toward the target temperature every tick, within the radiation radius -- heats cells below it, cools cells above it. Pure radiation, no collision. These settings are captured when you paint, so changing them afterward won\'t affect radiators already placed.';
    hint.appendChild(hintTitle);
    hint.appendChild(hintBody);
    container.appendChild(hint);
  }

  addFunnelPanel(container, meta, cb);
}
