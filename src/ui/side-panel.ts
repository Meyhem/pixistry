// The settings dock's contents: the card describing the active tool --
// swatch/label/category chip, species melt/boil/phase readout when relevant,
// brush width and brush temperature -- plus, for anything apparatus, the
// entity panel.
//
// That panel is *schema-driven*: each apparatus kind declares its fields once
// in sim/entity.ts, and renderEntityPanel renders whatever it's handed. The
// same schema drives both pre-placement tool config and selected-entity
// editing (the two differ only by the `mode` the kind is asked for), which is
// what makes "select a piece and its settings are editable here, live" true
// for every kind at once rather than six times over. This replaced six
// per-kind panel builders behind six per-kind ToolMeta enums, whose field
// sets and hint copy had already drifted apart from each other.
//
// Rebuilt wholesale whenever the active tool or any of its settings change --
// see app.ts's render().
import type { PaletteEntry } from '../sim/species';
import { formatCelsius } from './format';
import { contrastTextColor, contrastTextShadow } from './contrast';
import { el, hintBox, propRow } from './dom';
import { buildSpeciesChipList } from './species-chip-list';
import { entityPanelHint, entitySettingsSchema, type EntityField, type EntityKind, type EntityPanelMode } from '../sim/entity';
import type { EntityAction } from '../sim/protocol';

export interface ToolMeta {
  label: string;
  color: string;
  category: string;
  isSpecies: boolean;
  meltLabel: string;
  boilLabel: string;
  phaseLabel: string;
  showBrushTemp: boolean;
  showBrushWidth: boolean;
  /** Which apparatus kind's settings to render, and whether they configure
   * the next placement ('config') or edit the selected instance ('edit').
   * Null for a non-apparatus tool. One field where there used to be six
   * per-kind enums, because the panel no longer needs to know which kind it
   * is looking at -- see sim/entity.ts's settingsSchema. */
  entityPanel: { kind: EntityKind; mode: EntityPanelMode } | null;
  /** The Select tool with nothing selected: explains the interaction instead
   * of showing an empty panel. */
  selectHint: boolean;
  /** Which collection-port tally to show, if any -- a Sink shows what it
   * has collected, a Vent what it has thrown away (see grid.ts's
   * SinkMaskValue). Same panel, different wording and different tally. Ports
   * aren't entities yet (phase 6e of the overhaul plan), so this stays its
   * own flag rather than an entity kind. */
  sinkPanel: 'none' | 'sink' | 'vent';
  /** Whether the panel is editing a placed entity, which can be removed or
   * duplicated -- shows those two buttons. Deleting is the *only* way
   * apparatus comes off the bench now that the eraser is matter-only. */
  canDelete: boolean;
  /** The eraser's "this only takes matter" note. Worth spelling out because
   * erasing used to be how apparatus came off the bench. */
  eraseHint: boolean;
}

/** One species' running total for the Sink tool's tally panel. */
export interface SinkTallyEntry {
  readonly label: string;
  readonly color: string;
  readonly count: number;
}

/** The values the entity panel renders, keyed by the schema's `key` fields
 * -- in practice one of ui/entity-selection.ts's draft objects (a selected
 * entity's, or the tool's pre-placement one). Untyped per key on purpose:
 * the schema decides what each key means, and the panel only ever hands a
 * value straight back to the callback that owns it. */
export type EntityValues = Record<string, unknown>;

/** Everything the panel needs that isn't a value: how to render a species,
 * and what to do when a field changes. */
export interface EntityPanelContext {
  /** Every paintable species, for the chip-list pickers. */
  palette: readonly PaletteEntry[];
  speciesLabel(specId: number): string;
  speciesColor(specId: number): string;
  /** Opens the periodic-table picker for a 'species-pick' or the "+" of a
   * 'species-set' field. */
  onOpenSpeciesPicker(key: string): void;
  onRemoveSpecies(key: string, specId: number): void;
  /** A field's new value. `render` asks the caller to rebuild the panel --
   * true only for fields whose own value changes the panel's shape (a
   * segmented toggle that reveals another field), never for a slider, whose
   * DOM node must survive the browser's in-flight drag gesture. */
  onChange(key: string, value: unknown, opts: { render: boolean }): void;
  onAction(action: EntityAction): void;
}

export interface SidePanelCallbacks {
  brushWidth: number;
  onSetBrushWidth(value: number): void;
  brushTempC: number;
  onSetBrushTemp(value: number): void;
  /** The values behind meta.entityPanel's schema, and how to act on them.
   * Absent for a tool with no entity panel. */
  entityValues?: EntityValues;
  entityContext?: EntityPanelContext;
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
  /** Removes the entity the panel is editing (see ToolMeta.canDelete). */
  onDeleteEntity?(): void;
  /** Places a copy of it, offset a little, and selects the copy. */
  onDuplicateEntity?(): void;
}

// The brush's own range stays here -- it belongs to the paint/erase tools,
// not to any apparatus kind (whose ranges live with them in sim/entity.ts).
const MIN_RADIUS = 1;
const MAX_RADIUS = 12;
const MIN_TEMP_C = -250;
const MAX_TEMP_C = 1500;
const TEMP_STEP_C = 5;

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

/** A segmented row of mutually exclusive buttons -- the schema's only
 * multiple-choice control, used for everything from Finite/Infinite to
 * Erlenmeyer/Beaker. */
function addSegmented(
  container: HTMLElement,
  label: string,
  options: readonly { value: string | boolean; label: string }[],
  current: unknown,
  onPick: (value: string | boolean) => void,
): void {
  const wrap = el('div', 'setting');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  const row = el('div', 'funnel-toggle-row');
  for (const option of options) {
    const button = el('button', 'funnel-toggle-btn');
    button.textContent = option.label;
    button.classList.toggle('active', current === option.value);
    button.onclick = () => onPick(option.value);
    row.appendChild(button);
  }
  wrap.appendChild(row);
  container.appendChild(wrap);
}

function addSpeciesButton(container: HTMLElement, label: string, swatch: string, color: string, onClick: () => void): void {
  const wrap = el('div', 'setting');
  const labelEl = el('span', 'setting-label');
  labelEl.textContent = label;
  wrap.appendChild(labelEl);

  const button = el('button', 'funnel-species-btn');
  button.style.setProperty('--swatch', color);
  button.style.color = contrastTextColor(color);
  button.style.textShadow = contrastTextShadow(color);
  button.textContent = swatch;
  button.onclick = onClick;
  wrap.appendChild(button);
  container.appendChild(wrap);
}

/** Whether a field applies given the current values. The one conditional the
 * schema needs so far: a funnel's Amount is meaningless while its supply is
 * infinite, and showing a number you can edit but that can't apply is worse
 * than hiding it. */
function fieldApplies(field: EntityField, values: EntityValues): boolean {
  return !(field.field === 'number' && field.key === 'totalAmount' && values['totalMode'] === 'infinite');
}

function formatFieldValue(format: 'plain' | 'celsius' | 'scale', value: number): string {
  if (format === 'celsius') return formatCelsius(value);
  if (format === 'scale') return `${value.toFixed(1)}x`;
  return String(value);
}

/** Renders one apparatus kind's settings from its schema (see
 * sim/entity.ts). Knows nothing about which kind it's drawing: every field is
 * looked up in `values` by the schema's own key and handed straight back to
 * ctx.onChange, which is what lets one function serve all six kinds in both
 * modes. */
export function renderEntityPanel(container: HTMLElement, schema: readonly EntityField[], values: EntityValues, ctx: EntityPanelContext): void {
  for (const field of schema) {
    if (!fieldApplies(field, values)) continue;
    switch (field.field) {
      case 'slider':
        addSlider(container, field.label, field.min, field.max, field.step, Number(values[field.key] ?? field.min), (v) => formatFieldValue(field.format, v), (v) =>
          ctx.onChange(field.key, v, { render: false }),
        );
        break;
      case 'number':
        addNumberField(container, field.label, Number(values[field.key] ?? field.min), field.min, field.step, (v) => ctx.onChange(field.key, v, { render: false }));
        break;
      case 'segmented':
        // Rebuilds: a segmented choice is what reveals or hides other fields
        // (and its own active state has to redraw), unlike a slider mid-drag.
        addSegmented(container, field.label, field.options, values[field.key], (v) => ctx.onChange(field.key, v, { render: true }));
        break;
      case 'species-pick': {
        const specId = Number(values[field.key] ?? 0);
        addSpeciesButton(container, field.label, ctx.speciesLabel(specId), ctx.speciesColor(specId), () => ctx.onOpenSpeciesPicker(field.key));
        break;
      }
      case 'species-set': {
        const set = values[field.key] as ReadonlySet<number> | null | undefined;
        const wrap = el('div', 'setting');
        const label = el('span', 'setting-label');
        label.textContent = field.label;
        wrap.appendChild(label);
        // null (a tube's "everything passes") and empty (a filter's "nothing
        // passes") both render as no chips, so each kind supplies its own
        // sentence saying which of the two this is.
        if (!set || set.size === 0) wrap.appendChild(hintBox(field.emptyHint));
        buildSpeciesChipList(wrap, ctx.palette, set ?? new Set(), {
          onAdd: () => ctx.onOpenSpeciesPicker(field.key),
          onRemove: (specId) => ctx.onRemoveSpecies(field.key, specId),
        });
        container.appendChild(wrap);
        break;
      }
      case 'readout': {
        const value = values[field.key];
        container.appendChild(propRow(field.label, value === null || value === undefined ? 'infinite' : String(value)));
        break;
      }
      case 'action': {
        const button = el('button', 'funnel-reset-btn');
        button.textContent = field.label;
        button.onclick = () => ctx.onAction(field.action);
        container.appendChild(button);
        break;
      }
    }
  }
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

  if (meta.canDelete) {
    const row = el('div', 'entity-action-row');
    if (cb.onDuplicateEntity) {
      const copy = el('button', 'entity-copy-btn');
      copy.textContent = 'Duplicate';
      copy.title = 'Place a copy of this apparatus beside it (Ctrl+D)';
      copy.onclick = cb.onDuplicateEntity;
      row.appendChild(copy);
    }
    if (cb.onDeleteEntity) {
      const remove = el('button', 'entity-delete-btn');
      remove.textContent = 'Delete';
      remove.title = 'Remove this apparatus from the bench (Delete)';
      remove.onclick = cb.onDeleteEntity;
      row.appendChild(remove);
    }
    container.appendChild(row);
  }

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

  if (meta.eraseHint) {
    container.appendChild(
      hintBox(
        'Clears matter and painted overlays -- pixels, stirrer patches, catalyst pads, collection ports. Apparatus is indestructible: to take a vessel, tube, filter or radiator off the bench, pick it up with the Select tool and press Delete.',
        'HOW IT WORKS',
      ),
    );
  }

  if (meta.selectHint) {
    addDivider(container);
    container.appendChild(
      hintBox(
        'Click a placed apparatus on the grid to select it -- what the cursor is over is highlighted before you click. Drag it to move it, or drag a knee, an end or a corner to reshape it. Once selected: its settings appear here and apply as you change them, arrow keys nudge it (Shift for 5 cells), R rotates it where the shape allows, the scroll wheel does the same over the grid, Ctrl+D duplicates it, Delete takes it off the bench, and Escape deselects.',
      ),
    );
  }

  const panel = meta.entityPanel;
  if (panel && cb.entityValues && cb.entityContext) {
    const schema = entitySettingsSchema(panel.kind, panel.mode);
    const hint = entityPanelHint(panel.kind, panel.mode);
    if (schema.length > 0 || hint) addDivider(container);
    renderEntityPanel(container, schema, cb.entityValues, cb.entityContext);
    if (hint) container.appendChild(hintBox(hint, 'HOW IT WORKS'));
  }

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
