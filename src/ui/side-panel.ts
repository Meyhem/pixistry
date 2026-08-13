// The right-hand card describing the active tool: swatch/label/category
// chip, species melt/boil/phase readout when relevant, brush width, brush
// temperature, and (for the heater/cooler radiator tools) radiation radius +
// target temperature. Rebuilt wholesale whenever the active tool or any of
// its settings change -- see app.ts's render().
import { formatCelsius } from './format';

export interface ToolMeta {
  label: string;
  color: string;
  category: string;
  isSpecies: boolean;
  meltLabel: string;
  boilLabel: string;
  phaseLabel: string;
  isThermal: boolean;
  isHeater: boolean;
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
}

const MIN_RADIUS = 1;
const MAX_RADIUS = 12;
const MIN_RADIATION_RADIUS = 1;
const MAX_RADIATION_RADIUS = 15;
const MIN_TEMP_C = -250;
const MAX_TEMP_C = 1500;
const TEMP_STEP_C = 5;

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

function addDivider(container: HTMLElement): void {
  container.appendChild(el('div', 'divider'));
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

  addSlider(container, 'Brush width', MIN_RADIUS, MAX_RADIUS, 1, cb.brushWidth, (v) => String(v), cb.onSetBrushWidth);
  addSlider(container, 'Brush temperature', MIN_TEMP_C, MAX_TEMP_C, TEMP_STEP_C, cb.brushTempC, formatCelsius, cb.onSetBrushTemp);

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
    hintBody.textContent = meta.isHeater
      ? 'Placed radiator heats nearby cells every tick, up to the target temperature -- pure radiation, no collision.'
      : 'Placed radiator cools nearby cells every tick, down to the target temperature -- pure radiation, no collision.';
    hint.appendChild(hintTitle);
    hint.appendChild(hintBody);
    container.appendChild(hint);
  }
}
