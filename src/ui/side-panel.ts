// The settings dock's contents: the card describing the active tool --
// swatch/label/category chip, species melt/boil/phase readout when relevant,
// brush width, brush temperature, and (for the radiator) radiation radius + target
// temperature. The addition-funnel tool and the select-apparatus tool
// (see app.ts) share a "funnel panel" section here -- the same field set is
// used both to configure a funnel before placement and to live-edit an
// already-placed one, the only difference being whether a Reset button and
// a remaining-supply readout are shown (meta.funnelPanel). Rebuilt wholesale
// whenever the active tool or any of its settings change -- see app.ts's
// render().
import type { PaletteEntry } from '../sim/species';
import { formatCelsius } from './format';
import { contrastTextColor, contrastTextShadow } from './contrast';
import { el, hintBox, propRow } from './dom';
import { buildSpeciesChipList } from './species-chip-list';
import { MAX_FLASK_SIZE_SCALE, MIN_FLASK_SIZE_SCALE, type FlaskKind } from '../sim/flask-shapes';

export interface ToolMeta {
  label: string;
  color: string;
  category: string;
  isSpecies: boolean;
  meltLabel: string;
  boilLabel: string;
  phaseLabel: string;
  /** The radiator's reach/target sliders -- same 3-state convention as
   * funnelPanel: 'config' is the next-line-drawn draft, 'edit' is a placed
   * radiator selected with the select-apparatus tool (whose edits go live
   * immediately, see radiators.ts's updateRadiatorInstance). */
  radiatorPanel: 'none' | 'config' | 'edit';
  showBrushTemp: boolean;
  showBrushWidth: boolean;
  /** 'none': no funnel section. 'config': pre-placement settings (the
   * funnel tool). 'edit-empty': select-apparatus tool with nothing selected
   * yet. 'edit': select-apparatus tool with a placed funnel selected. */
  funnelPanel: 'none' | 'config' | 'edit-empty' | 'edit';
  /** Same 3-state convention as funnelPanel, for the conveyor-tube tool --
   * 'edit-empty' is shared between the two apparatus types (select-
   * apparatus with nothing selected looks the same regardless of which
   * kind of apparatus the player might click next). */
  tubePanel: 'none' | 'config' | 'edit';
  /** The Filter apparatus's allow-list panel -- same 3-state convention as
   * funnelPanel/tubePanel now that a drawn line is a tracked instance with
   * its own allow-list (see filter.ts): 'config' is the next-line-drawn
   * draft, 'edit' is a placed line selected with the select-apparatus
   * tool. */
  filterPanel: 'none' | 'config' | 'edit';
  /** The flask tool's size/stirred panel -- same 3-state convention as
   * funnelPanel: 'config' is the pre-placement draft, 'edit' is a placed
   * flask selected with the select-apparatus tool (see flask.ts, which
   * re-stamps the vessel on every edit). */
  flaskPanel: 'none' | 'config' | 'edit';
  /** The Glass tool's polygon-draw panel -- explains the click/right-click
   * interaction, which is the tool's only "setting" (glass lines are always
   * one cell wide and stamped at ambient temperature). 'edit' is a placed
   * polygon selected with the select-apparatus tool, which has no settings
   * either: it moves and rotates, and that's all. */
  glassPanel: 'none' | 'config' | 'edit';
  /** The Sink tool's live tally panel -- same 2-state convention as
   * filterPanel/flaskPanel: a sink line isn't a tracked instance (there's
   * one global counter shared by every sink drawn on the grid, see
   * sink.ts's SinkCounter), so there's no "edit" mode either. */
  /** Which collection-port tally to show, if any -- a Sink shows what it
   * has collected, a Vent what it has thrown away (see grid.ts's
   * SinkMaskValue). Same panel, different wording and different tally. */
  sinkPanel: 'none' | 'sink' | 'vent';
}

/** One species' running total for the Sink tool's tally panel. */
export interface SinkTallyEntry {
  readonly label: string;
  readonly color: string;
  readonly count: number;
}

export interface TubeFieldValues {
  coneSize: number;
  /** null = accept every species (the default). */
  filter: ReadonlySet<number> | null;
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
  /** Only meaningful when funnelPanel === 'edit' -- a newly placed funnel
   * always starts false (see FunnelInstance.enabled's doc comment). */
  enabled: boolean;
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
  onSetFunnelEnabled(enabled: boolean): void;
  onResetFunnel(): void;
  tubeFields: TubeFieldValues;
  /** Every paintable species, for the filter's chip-list picker. */
  tubePalette: readonly PaletteEntry[];
  onSetTubeConeSize(value: number): void;
  onOpenTubeFilterPicker(): void;
  onRemoveTubeFilterSpecies(specId: number): void;
  /** The allow-list being edited: the selected line's when one is selected,
   * otherwise the Filter tool's pre-placement draft. */
  filterSpecies: ReadonlySet<number>;
  /** Every paintable species, for the Filter apparatus's chip-list picker. */
  filterPalette: readonly PaletteEntry[];
  onOpenFilterSpeciesPicker(): void;
  onRemoveFilterSpecies(specId: number): void;
  flaskSizeScale: number;
  onSetFlaskSize(value: number): void;
  /** Whether the flask tool stamps a stirrer over the vessel's interior --
   * one setting shared by both glassware shapes, replacing what used to be a
   * separate "Erlenmeyer (stirred)" tool. */
  flaskStirred: boolean;
  onSetFlaskStirred(value: boolean): void;
  /** Which glassware shape the panel is editing. Only shown in 'edit' mode
   * -- pre-placement the shape is what you picked in the Tool Chest. */
  flaskShape: FlaskKind;
  onSetFlaskShape(kind: FlaskKind): void;
  /** Non-zero running totals only, already sorted highest-first -- see
   * app.ts's sinkTallyEntries. */
  sinkTally: readonly SinkTallyEntry[];
  sinkGrandTotal: number;
  onResetSinkCounts(): void;
  /** The renderer's hot/cold border-tint thresholds, for the legend at the
   * foot of the dock -- it used to sit in the bottom HUD strip, which no
   * longer exists (see hud.ts). Global information rather than a tool
   * setting, hence its own divider at the very bottom. */
  hotLabel: string;
  coldLabel: string;
  /** Folds the dock away (app.ts's settingsDockOpen). Optional so the builder
   * stays usable outside the dock, but in practice always supplied -- the
   * header's » button is the only pointer-driven way back to a full-width
   * bench, since the "⚙ Tool settings" button that used to advertise the E
   * shortcut is gone. */
  onFoldDock?(): void;
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
const MIN_TUBE_CONE_SIZE = 0;
const MAX_TUBE_CONE_SIZE = 10;

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

function addFunnelEnabledToggle(container: HTMLElement, enabled: boolean, onChange: (enabled: boolean) => void): void {
  const wrap = el('div', 'setting');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = 'State';
  wrap.appendChild(labelEl);

  const row = el('div', 'funnel-toggle-row');
  const runningBtn = el('button', 'funnel-toggle-btn');
  runningBtn.textContent = 'Running';
  runningBtn.classList.toggle('active', enabled);
  runningBtn.onclick = () => onChange(true);
  const stoppedBtn = el('button', 'funnel-toggle-btn');
  stoppedBtn.textContent = 'Stopped';
  stoppedBtn.classList.toggle('active', !enabled);
  stoppedBtn.onclick = () => onChange(false);
  row.appendChild(runningBtn);
  row.appendChild(stoppedBtn);
  wrap.appendChild(row);
  container.appendChild(wrap);
}

function addFunnelPanel(container: HTMLElement, meta: ToolMeta, cb: SidePanelCallbacks): void {
  if (meta.funnelPanel === 'none') return;
  addDivider(container);

  if (meta.funnelPanel === 'edit-empty') {
    container.appendChild(hintBox('Click a placed apparatus on the grid to select it.'));
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
    addFunnelEnabledToggle(container, f.enabled, cb.onSetFunnelEnabled);
    container.appendChild(propRow('Remaining', f.remaining === null ? 'infinite' : String(f.remaining)));

    const resetBtn = el('button', 'funnel-reset-btn');
    resetBtn.textContent = 'Reset';
    resetBtn.onclick = cb.onResetFunnel;
    container.appendChild(resetBtn);
  }

  container.appendChild(
    hintBox(
      meta.funnelPanel === 'config'
        ? 'Rotate with the scroll wheel while hovering the grid, then click to place. A placed funnel starts Stopped -- switch it to Running here once placed. Drips one pixel at a fixed interval; pauses automatically if its outlet is blocked, and resumes once it clears.'
        : "Drag the funnel to move it, or rotate it with the scroll wheel over the grid, same as before placement. Editing its settings only affects future drips -- Reset refills it back to its full total (or infinite) and un-pauses it, without changing Running/Stopped.",
      'HOW IT WORKS',
    ),
  );
}

function addTubePanel(container: HTMLElement, meta: ToolMeta, cb: SidePanelCallbacks): void {
  if (meta.tubePanel === 'none') return;
  addDivider(container);

  const f = cb.tubeFields;
  addSlider(container, 'Suction cone size', MIN_TUBE_CONE_SIZE, MAX_TUBE_CONE_SIZE, 1, f.coneSize, (v) => String(v), cb.onSetTubeConeSize);

  const filterWrap = el('div', 'setting');
  const filterLabel = el('span', 'setting-label');
  filterLabel.textContent = 'Species filter';
  filterWrap.appendChild(filterLabel);
  if (f.filter === null) {
    filterWrap.appendChild(hintBox('No species added -- every species passes through.'));
  }
  buildSpeciesChipList(filterWrap, cb.tubePalette, f.filter ?? new Set(), {
    onAdd: cb.onOpenTubeFilterPicker,
    onRemove: cb.onRemoveTubeFilterSpecies,
  });
  container.appendChild(filterWrap);

  container.appendChild(
    hintBox(
      meta.tubePanel === 'config'
        ? 'Click to place each knee, right-click to finish at the last knee placed (or cancel if only the mouth is placed). Matching pixels within the cone get pulled in at the mouth and ejected at the far end; a blocked exit stalls the whole tube.'
        : "Drag a knee to move it, or drag a segment to slide it -- connected knees follow, their far ends stay put. These settings only affect this tube's future suction, not cargo already inside.",
      'HOW IT WORKS',
    ),
  );
}

function addFilterPanel(container: HTMLElement, meta: ToolMeta, cb: SidePanelCallbacks): void {
  if (meta.filterPanel === 'none') return;
  addDivider(container);

  const wrap = el('div', 'setting');
  const label = el('span', 'setting-label');
  label.textContent = 'Allowed species';
  wrap.appendChild(label);
  if (cb.filterSpecies.size === 0) {
    wrap.appendChild(hintBox('No species added -- every species is blocked.'));
  }
  buildSpeciesChipList(wrap, cb.filterPalette, cb.filterSpecies, {
    onAdd: cb.onOpenFilterSpeciesPicker,
    onRemove: cb.onRemoveFilterSpecies,
  });
  container.appendChild(wrap);

  container.appendChild(
    hintBox(
      meta.filterPanel === 'config'
        ? 'Drag from one end to the other to draw a single one-cell-wide line. Species in the allowed list pass through it in either direction; everything else is blocked, same as glass. Each line keeps the list it was drawn with -- pick it up with the Select tool to change it later.'
        : "This line's own allow-list -- other filter lines keep theirs. Drag the line to slide it, or drag either end to re-aim it; erase any part of it to take it out (the rest keeps filtering until the last cell is gone).",
      'HOW IT WORKS',
    ),
  );
}

function addFlaskPanel(container: HTMLElement, meta: ToolMeta, cb: SidePanelCallbacks): void {
  if (meta.flaskPanel === 'none') return;
  addDivider(container);

  if (meta.flaskPanel === 'edit') addShapeToggle(container, cb.flaskShape, cb.onSetFlaskShape);
  addSlider(container, 'Size', MIN_FLASK_SIZE_SCALE, MAX_FLASK_SIZE_SCALE, 0.1, cb.flaskSizeScale, (v) => `${v.toFixed(1)}x`, cb.onSetFlaskSize);
  addStirredToggle(container, cb.flaskStirred, cb.onSetFlaskStirred);

  container.appendChild(
    hintBox(
      meta.flaskPanel === 'config'
        ? 'Rotate with the scroll wheel while hovering the grid (45-degree steps), then click to place. A placed flask is a fixed glass vessel -- pour reagents in through its mouth with the paint tool, a funnel, or a conveyor. Stirred stamps a stirrer over the whole interior, agitating whatever settles inside.'
        : 'Drag the vessel to move it, or rotate it with the scroll wheel over the grid (45-degree steps), same as before placement. Changing shape, size or facing re-draws the glass in place -- whatever it was holding stays where it is, so a big change can leave contents outside the new outline.',
      'HOW IT WORKS',
    ),
  );
}

function addShapeToggle(container: HTMLElement, shape: FlaskKind, onChange: (kind: FlaskKind) => void): void {
  const wrap = el('div', 'setting');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = 'Shape';
  wrap.appendChild(labelEl);

  const row = el('div', 'funnel-toggle-row');
  for (const [kind, label] of [
    ['erlenmeyer', 'Erlenmeyer'],
    ['beaker', 'Beaker'],
  ] as const) {
    const button = el('button', 'funnel-toggle-btn');
    button.textContent = label;
    button.classList.toggle('active', shape === kind);
    button.onclick = () => onChange(kind);
    row.appendChild(button);
  }
  wrap.appendChild(row);
  container.appendChild(wrap);
}

function addStirredToggle(container: HTMLElement, stirred: boolean, onChange: (stirred: boolean) => void): void {
  const wrap = el('div', 'setting');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = 'Stirring';
  wrap.appendChild(labelEl);

  const row = el('div', 'funnel-toggle-row');
  const plainBtn = el('button', 'funnel-toggle-btn');
  plainBtn.textContent = 'Plain';
  plainBtn.classList.toggle('active', !stirred);
  plainBtn.onclick = () => onChange(false);
  const stirredBtn = el('button', 'funnel-toggle-btn');
  stirredBtn.textContent = 'Stirred';
  stirredBtn.classList.toggle('active', stirred);
  stirredBtn.onclick = () => onChange(true);
  row.appendChild(plainBtn);
  row.appendChild(stirredBtn);
  wrap.appendChild(row);
  container.appendChild(wrap);
}

function addGlassPanel(container: HTMLElement, meta: ToolMeta): void {
  if (meta.glassPanel === 'none') return;
  addDivider(container);
  container.appendChild(
    hintBox(
      meta.glassPanel === 'config'
        ? 'Click to place each corner, right-click to finish at the last corner placed (the segment still following the cursor is dropped), Escape to discard. Segments snap to the 8 compass directions and are drawn one cell wide, so vessel walls always join cleanly at a corner. Click back on the first corner to close the shape into a sealed vessel, or stop short to leave a mouth.'
        : 'Drag any wall to slide the whole shape, or rotate it with the scroll wheel over the grid (45-degree steps about its own middle). Whatever it was holding stays where it is, so a big turn can leave contents outside the new outline. Erase any part of it to take it out -- the rest stays until the last cell is gone.',
      'HOW IT WORKS',
    ),
  );
}

function addSinkPanel(container: HTMLElement, meta: ToolMeta, cb: SidePanelCallbacks): void {
  if (meta.sinkPanel === 'none') return;
  addDivider(container);
  const isVent = meta.sinkPanel === 'vent';

  const wrap = el('div', 'setting');
  const label = el('span', 'setting-label');
  label.textContent = isVent ? 'Vented' : 'Collected';
  wrap.appendChild(label);

  if (cb.sinkTally.length === 0) {
    wrap.appendChild(
      hintBox(
        isVent
          ? 'Nothing vented yet -- draw a line where you want waste to escape.'
          : 'Nothing collected yet -- draw a line and let matter fall onto it.',
      ),
    );
  } else {
    const list = el('div', 'species-chip-list');
    for (const entry of cb.sinkTally) {
      const chip = el('div', 'species-chip');
      chip.style.setProperty('--swatch', entry.color);
      chip.style.color = contrastTextColor(entry.color);
      chip.style.textShadow = contrastTextShadow(entry.color);
      const name = el('span', 'species-chip-name');
      name.textContent = `${entry.label} ×${entry.count}`;
      chip.appendChild(name);
      list.appendChild(chip);
    }
    wrap.appendChild(list);
  }
  container.appendChild(wrap);
  container.appendChild(propRow('Total', String(cb.sinkGrandTotal)));

  const resetBtn = el('button', 'funnel-reset-btn');
  resetBtn.textContent = 'Reset count';
  resetBtn.onclick = cb.onResetSinkCounts;
  container.appendChild(resetBtn);

  container.appendChild(
    hintBox(
      'Draw a straight line like a wall. Anything that touches it is consumed and tallied here -- one shared count for every sink line on the grid.',
      'HOW IT WORKS',
    ),
  );
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

  if (cb.onFoldDock) {
    const fold = el('button', 'dock-fold-btn');
    fold.textContent = '»';
    fold.title = 'Hide these settings (E)';
    fold.onclick = cb.onFoldDock;
    header.appendChild(fold);
  }
  container.appendChild(header);

  addDivider(container);

  if (meta.isSpecies) {
    const props = el('div', 'prop-list');
    props.appendChild(propRow('Melting point', meta.meltLabel));
    props.appendChild(propRow('Boiling point', meta.boilLabel));
    props.appendChild(propRow('Phase at 20°C', meta.phaseLabel));
    container.appendChild(props);
    addDivider(container);
  }

  if (meta.showBrushWidth) {
    addSlider(container, 'Brush width', MIN_RADIUS, MAX_RADIUS, 1, cb.brushWidth, (v) => String(v), cb.onSetBrushWidth);
  }
  if (meta.showBrushTemp) {
    addSlider(container, 'Brush temperature', MIN_TEMP_C, MAX_TEMP_C, TEMP_STEP_C, cb.brushTempC, formatCelsius, cb.onSetBrushTemp);
  }

  if (meta.radiatorPanel !== 'none') {
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

    container.appendChild(
      hintBox(
        meta.radiatorPanel === 'config'
          ? "Drag from one end to the other to draw a single one-cell-wide line. Every cell of it radiates toward the target temperature each tick, within the radiation radius -- heating cells below it, cooling cells above it. Pure radiation, no collision. These settings are captured when you draw, so changing them afterward won't affect radiators already placed -- pick one up with the Select tool to change it."
          : "This radiator's own settings, applied the moment you move a slider. Drag the line to slide it, or drag either end to re-aim it; erase any part of it to take it out (the rest keeps radiating until the last cell is gone).",
        'HOW IT WORKS',
      ),
    );
  }

  addFunnelPanel(container, meta, cb);
  addTubePanel(container, meta, cb);
  addFilterPanel(container, meta, cb);
  addFlaskPanel(container, meta, cb);
  addGlassPanel(container, meta);
  addSinkPanel(container, meta, cb);
  addTemperatureLegend(container, cb);
}

/** What the renderer's cell tinting means, at the foot of every tool's
 * panel. */
function addTemperatureLegend(container: HTMLElement, cb: SidePanelCallbacks): void {
  addDivider(container);
  const legend = el('div', 'dock-legend');
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
  container.appendChild(legend);
}
