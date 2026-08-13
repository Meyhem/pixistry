// M4+ UI: the full v1 tool set (paint, erase, wall materials, heater/cooler
// radiators, probe, mixer, grabber) plus time controls (pause, single-step,
// speed multiplier), a pinned-species quick row backed by a full
// periodic-table modal, and a hover inspector -- all plain DOM per the
// design doc's "src/ui plain DOM/React panels", no framework. Visual layout
// follows the "Pixistry UI Refresh" design (see toolbar.ts, side-panel.ts,
// periodic-table.ts for the three panel builders this module wires
// together).
import { createRenderer, type Renderer } from '../render/renderer';
import { AMBIENT_TEMPERATURE_K, kelvinToCelsius } from '../sim/heat';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../sim/protocol';
import type { PaletteEntry } from '../sim/species';
import { EMPTY, PhaseCode } from '../sim/grid';
import { BORDER_RANGE_K } from '../render/renderer';
import { getWall, wallList } from '../sim/walls';
import { RADIATOR_COLOR, RADIATOR_LABEL } from '../sim/radiators';
import { FUNNEL_COLOR, FUNNEL_LABEL } from '../sim/funnel';
import { STIRRER_COLOR, STIRRER_LABEL } from '../sim/stirrer';
import { DEFAULT_TUBE_CONE_SIZE, TUBE_COLOR, TUBE_LABEL } from '../sim/tube';
import { funnelBounds, funnelShapeFor, nextFunnelFacing, type FunnelFacing } from '../sim/apparatus-shapes';
import { lumenWallCells, polylineToLumenPath, snapOctant, type Point } from '../sim/tube-shapes';
import { buildToolbar, SELECT_APPARATUS_COLOR, SELECT_APPARATUS_LABEL, type ToolbarCallbacks } from './toolbar';
import { buildSidePanel, type FunnelFieldValues, type SidePanelCallbacks, type ToolMeta, type TubeFieldValues } from './side-panel';
import { buildPeriodicTable, type PeriodicTableCallbacks } from './periodic-table';
import { ApparatusSelection } from './apparatus-selection';
import { isElementLabel } from './species-classify';
import { buildSpeciesLookup } from './species-lookup';
import { formatCelsius } from './format';

const DEFAULT_RADIUS = 2;
const DEFAULT_RADIATION_RADIUS = 3;
const DEFAULT_RADIATOR_TARGET_C = 100;
const DEFAULT_BRUSH_TEMP_C = 21;
const DEFAULT_FUNNEL_RATE_PER_MINUTE = 60;
const DEFAULT_FUNNEL_TOTAL_AMOUNT = 100;
const DEFAULT_PINNED_LABELS = ['H2O', 'NaCl', 'Fe', 'Cu', 'Na', 'Cl2', 'O2', 'C', 'Ag'];
const PINNED_STORAGE_KEY = 'pixistry.pinnedSpecies';

type Tool =
  | { kind: 'paint'; specId: number }
  | { kind: 'erase' }
  | { kind: 'wall'; specId: number }
  | { kind: 'radiator' }
  | { kind: 'mixer' }
  | { kind: 'grabber' }
  | { kind: 'funnel' }
  | { kind: 'stirrer' }
  | { kind: 'tube' }
  | { kind: 'select-apparatus' };

const PHASE_LABEL: Record<number, string> = {
  [PhaseCode.Empty]: 'empty',
  [PhaseCode.Solid]: 'solid',
  [PhaseCode.Liquid]: 'liquid',
  [PhaseCode.Gas]: 'gas',
};

/** Baseline every describeToolMeta branch starts from -- most fields are
 * "off"/empty for most tools, so each branch below only lists what it
 * overrides instead of spelling out all twelve fields every time. */
const TOOL_META_DEFAULTS: ToolMeta = {
  label: '',
  color: '',
  category: '',
  isSpecies: false,
  meltLabel: '',
  boilLabel: '',
  phaseLabel: '',
  isThermal: false,
  showBrushTemp: false,
  showBrushWidth: true,
  funnelPanel: 'none',
  tubePanel: 'none',
};

/** The three tools with no per-instance config of their own -- just a
 * label/swatch, everything else the same as TOOL_META_DEFAULTS. */
const SIMPLE_TOOL_META: Record<'erase' | 'mixer' | 'grabber', { label: string; color: string }> = {
  erase: { label: 'Erase', color: '#8a8a8a' },
  mixer: { label: 'Mix', color: '#c9a8ff' },
  grabber: { label: 'Grab', color: '#f2d94e' },
};

function loadPinnedLabels(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINNED_LABELS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) return [...DEFAULT_PINNED_LABELS];
    return parsed;
  } catch {
    return [...DEFAULT_PINNED_LABELS];
  }
}

function savePinnedLabels(labels: readonly string[]): void {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Storage unavailable (private browsing, quota) -- pins just won't
    // survive a reload, which is a fine degradation.
  }
}

export function mountApp(root: HTMLElement): void {
  root.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'app-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'app-title';
  titleEl.textContent = 'PIXISTRY';
  const subtitleEl = document.createElement('div');
  subtitleEl.className = 'app-subtitle';
  subtitleEl.textContent = 'falling-sand chemistry sandbox';
  header.appendChild(titleEl);
  header.appendChild(subtitleEl);
  root.appendChild(header);

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  root.appendChild(toolbar);

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  root.appendChild(workspace);

  const canvasCol = document.createElement('div');
  canvasCol.className = 'canvas-col';
  workspace.appendChild(canvasCol);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  canvasCol.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.className = 'sim-canvas';
  canvasWrap.appendChild(canvas);

  const inspector = document.createElement('div');
  inspector.className = 'inspector';
  const inspectorSwatch = document.createElement('span');
  inspectorSwatch.className = 'inspector-swatch';
  const inspectorText = document.createElement('span');
  inspectorText.className = 'inspector-text';
  inspectorText.textContent = 'Hover the canvas to inspect a cell';
  inspector.appendChild(inspectorSwatch);
  inspector.appendChild(inspectorText);
  inspector.classList.add('empty');
  canvasWrap.appendChild(inspector);

  const brushOutline = document.createElement('div');
  brushOutline.className = 'brush-outline';
  brushOutline.style.display = 'none';
  canvasWrap.appendChild(brushOutline);

  // Ghost preview for the funnel tool (see updateApparatusOverlay): a 2D
  // overlay canvas rather than the WebGL sim canvas, since it needs to draw
  // an unrotated-in-the-grid-sense but freely positioned pixel shape purely
  // client-side, redrawn on every mousemove/wheel without round-tripping
  // through the worker.
  const apparatusPreview = document.createElement('canvas');
  apparatusPreview.className = 'apparatus-preview';
  apparatusPreview.style.display = 'none';
  canvasWrap.appendChild(apparatusPreview);
  let previewCtx: CanvasRenderingContext2D | null = null;

  // Selection box for the select-apparatus tool: 4 corner brackets
  // positioned over the selected funnel's bounding box (see
  // updateSelectionBox).
  const selectBox = document.createElement('div');
  selectBox.className = 'apparatus-select-box';
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const cornerEl = document.createElement('div');
    cornerEl.className = `corner ${corner}`;
    selectBox.appendChild(cornerEl);
  }
  canvasWrap.appendChild(selectBox);

  const legend = document.createElement('div');
  legend.className = 'legend';
  const hotK = AMBIENT_TEMPERATURE_K + BORDER_RANGE_K;
  const coldK = AMBIENT_TEMPERATURE_K - BORDER_RANGE_K;
  legend.innerHTML = `
    <div class="legend-item"><span class="legend-swatch normal"></span><span class="legend-label">NORMAL</span></div>
    <div class="legend-item"><span class="legend-swatch hot"></span><span class="legend-label">HOT &middot; &gt;${formatCelsius(kelvinToCelsius(hotK))}</span></div>
    <div class="legend-item"><span class="legend-swatch cold"></span><span class="legend-label">COLD &middot; &lt;${formatCelsius(kelvinToCelsius(coldK))}</span></div>
  `;
  canvasCol.appendChild(legend);

  const sidePanel = document.createElement('div');
  sidePanel.className = 'side-panel';
  workspace.appendChild(sidePanel);

  const ptOverlay = document.createElement('div');
  ptOverlay.className = 'pt-overlay';
  ptOverlay.style.display = 'none';
  root.appendChild(ptOverlay);

  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const send = (message: MainToWorkerMessage): void => worker.postMessage(message);

  let gridWidth = 0;
  let gridHeight = 0;
  let renderer: Renderer | null = null;
  let palette: PaletteEntry[] = [];
  let tool: Tool | null = null;
  let running = true;
  let speed = 1;
  let brushWidth = DEFAULT_RADIUS;
  let brushTempC = DEFAULT_BRUSH_TEMP_C;
  let radiationRadius = DEFAULT_RADIATION_RADIUS;
  let targetTempC = DEFAULT_RADIATOR_TARGET_C;
  let pinnedLabels = loadPinnedLabels();
  let ptOpen = false;
  let ptSelectedSymbol: string | null = null;
  let ptTarget: 'paint' | 'funnel-config' | 'funnel-edit' = 'paint';
  let isPointerDown = false;
  let isGrabbing = false;
  // The mixer tool's active brush stroke: while held, position updates go
  // straight to the worker's stirState (stirStart/stirMove/stirEnd) instead
  // of through applyTool, since the worker re-stirs that position every
  // simulation tick on its own -- see worker.ts's runOneTick.
  let isMixing = false;

  // Addition-funnel tool config (pre-placement) -- captured into the
  // instance at placement time, same "settings are a snapshot, not
  // retroactive" convention as the radiator's sliders (see
  // describeToolMeta's radiator case).
  let funnelSpecId = 0;
  let funnelTempC = DEFAULT_BRUSH_TEMP_C;
  let funnelRatePerMinute = DEFAULT_FUNNEL_RATE_PER_MINUTE;
  let funnelTotalMode: 'finite' | 'infinite' = 'finite';
  let funnelTotalAmount = DEFAULT_FUNNEL_TOTAL_AMOUNT;
  let funnelFacing: FunnelFacing = 'down';
  let lastHoverX = 0;
  let lastHoverY = 0;

  // select-apparatus tool's selection/edit-draft/drag state for both
  // apparatus types -- see apparatus-selection.ts.
  const apparatusSelection = new ApparatusSelection();

  // Conveyor-tube tool config (pre-placement) -- same "captured at placement
  // time" convention as the funnel's config above.
  let tubeConeSize = DEFAULT_TUBE_CONE_SIZE;
  let tubeFilter: Set<number> | null = null; // null = accept every species

  // In-progress polygon draw (tool === 'tube'): points already committed by
  // a click, plus a live rubber-band preview point tracking the cursor
  // (snapped from the last committed point -- see updateTubeDrawPreview).
  // Cleared back to [] on right-click/Escape (see finishOrCancelTubeDraw).
  let tubeDrawPoints: Point[] = [];
  let tubeDrawPreview: Point | null = null;

  // Label/color/palette-entry lookup for the probe, funnel field display,
  // and debug hook (see species-lookup.ts).
  const speciesLookup = buildSpeciesLookup();

  // Latest frame data, kept around purely so the hover inspector can look
  // up a cell locally without a worker round trip.
  let lastSpecId: Uint16Array | null = null;
  let lastPhase: Uint8Array | null = null;
  let lastTempK: Float32Array | null = null;
  let lastRadiatorRadius: Uint8Array | null = null;
  let lastRadiatorTargetK: Float32Array | null = null;
  let lastTick = 0;

  function describeToolMeta(t: Tool | null): ToolMeta {
    if (!t) return { ...TOOL_META_DEFAULTS, label: 'No tool selected', color: '#3a3d3a' };
    if (t.kind === 'paint') {
      const entry = speciesLookup.paletteEntryOf(t.specId);
      if (!entry) return describeToolMeta(null);
      return {
        ...TOOL_META_DEFAULTS,
        label: entry.label,
        color: entry.color,
        category: isElementLabel(entry.label) ? 'ELEMENT' : 'COMPOUND',
        isSpecies: true,
        meltLabel: formatCelsius(entry.meltingPointC),
        boilLabel: formatCelsius(entry.boilingPointC),
        phaseLabel: PHASE_LABEL[entry.phase] ?? '',
        showBrushTemp: true,
      };
    }
    if (t.kind === 'wall') {
      const wall = getWall(t.specId);
      return { ...TOOL_META_DEFAULTS, label: wall.label, color: wall.color, category: 'APPARATUS', showBrushTemp: true };
    }
    if (t.kind === 'radiator') {
      return { ...TOOL_META_DEFAULTS, label: RADIATOR_LABEL, color: RADIATOR_COLOR, category: 'APPARATUS', isThermal: true };
    }
    if (t.kind === 'funnel') {
      return {
        ...TOOL_META_DEFAULTS,
        label: FUNNEL_LABEL,
        color: FUNNEL_COLOR,
        category: 'APPARATUS',
        showBrushWidth: false,
        funnelPanel: 'config',
      };
    }
    if (t.kind === 'tube') {
      return {
        ...TOOL_META_DEFAULTS,
        label: TUBE_LABEL,
        color: TUBE_COLOR,
        category: 'APPARATUS',
        showBrushWidth: false,
        tubePanel: 'config',
      };
    }
    if (t.kind === 'stirrer') {
      return { ...TOOL_META_DEFAULTS, label: STIRRER_LABEL, color: STIRRER_COLOR, category: 'APPARATUS' };
    }
    if (t.kind === 'select-apparatus') {
      // The only branch that depends on live selection state rather than
      // just the tool kind, so it stays logic instead of a static table row.
      const selectedFunnel = apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId);
      const selectedTube = selectedFunnel ? undefined : apparatusSelection.findTube(apparatusSelection.selectedTubeId);
      const nothingSelected = !selectedFunnel && !selectedTube;
      return {
        ...TOOL_META_DEFAULTS,
        label: selectedFunnel ? FUNNEL_LABEL : selectedTube ? TUBE_LABEL : SELECT_APPARATUS_LABEL,
        color: selectedFunnel ? FUNNEL_COLOR : selectedTube ? TUBE_COLOR : SELECT_APPARATUS_COLOR,
        category: nothingSelected ? 'TOOL' : 'APPARATUS',
        showBrushWidth: false,
        funnelPanel: selectedFunnel ? 'edit' : nothingSelected ? 'edit-empty' : 'none',
        tubePanel: selectedTube ? 'edit' : 'none',
      };
    }
    const info = SIMPLE_TOOL_META[t.kind];
    return { ...TOOL_META_DEFAULTS, label: info.label, color: info.color, category: 'TOOL' };
  }

  function setTool(next: Tool): void {
    // Switching away from the tube tool mid-draw discards whatever's been
    // clicked so far rather than leaving it to silently reappear (still
    // held in tubeDrawPoints) if the player switches back later.
    if (tool?.kind === 'tube' && next.kind !== 'tube' && tubeDrawPoints.length > 0) {
      tubeDrawPoints = [];
      tubeDrawPreview = null;
    }
    tool = next;
    render();
  }

  function togglePin(label: string): void {
    pinnedLabels = pinnedLabels.includes(label) ? pinnedLabels.filter((x) => x !== label) : [...pinnedLabels, label];
    savePinnedLabels(pinnedLabels);
    render();
  }

  /** Pushes the edit draft's full config to the worker as one message -- see
   * FunnelEditDraft's doc comment for why every field is sent together
   * rather than patched individually. */
  function sendFunnelUpdate(): void {
    const { selectedFunnelId, editDraft } = apparatusSelection;
    if (selectedFunnelId === null || !editDraft) return;
    send({
      type: 'updateFunnel',
      id: selectedFunnelId,
      specId: editDraft.specId,
      tempC: editDraft.tempC,
      ratePerMinute: editDraft.ratePerMinute,
      total: editDraft.totalMode === 'infinite' ? null : editDraft.totalAmount,
    });
  }

  function sendTubeUpdate(): void {
    const { selectedTubeId, tubeEditDraft } = apparatusSelection;
    if (selectedTubeId === null || !tubeEditDraft) return;
    send({
      type: 'updateTube',
      id: selectedTubeId,
      coneSize: tubeEditDraft.coneSize,
      filter: tubeEditDraft.filter ? [...tubeEditDraft.filter] : null,
    });
  }

  function render(): void {
    renderToolbar();
    renderSidePanel();
  }

  function renderToolbar(): void {
    const toolbarCallbacks: ToolbarCallbacks = {
      isPaintActive: (specId) => tool?.kind === 'paint' && tool.specId === specId,
      isWallActive: (specId) => tool?.kind === 'wall' && tool.specId === specId,
      isToolActive: (kind) => tool?.kind === kind,
      isPinned: (label) => pinnedLabels.includes(label),
      onSelectPaint: (specId) => setTool({ kind: 'paint', specId }),
      onSelectWall: (specId) => setTool({ kind: 'wall', specId }),
      onSelectTool: (kind) => setTool({ kind }),
      onTogglePin: togglePin,
      onOpenPeriodicTable: () => {
        ptTarget = 'paint';
        ptOpen = true;
        render();
      },
      running,
      speed,
      onTogglePause: () => {
        running = !running;
        send({ type: 'setRunning', running });
        render();
      },
      onStep: () => send({ type: 'step' }),
      onSetSpeed: (value) => {
        speed = value;
        send({ type: 'setSpeed', speed });
        render();
      },
    };
    buildToolbar(toolbar, palette, wallList(), pinnedLabels, toolbarCallbacks);
  }

  function renderSidePanel(): void {
    const meta = describeToolMeta(tool);
    const isEditMode = tool?.kind === 'select-apparatus';
    const selectedFunnel = isEditMode ? apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId) : undefined;
    const selectedTube = isEditMode && !selectedFunnel ? apparatusSelection.findTube(apparatusSelection.selectedTubeId) : undefined;
    // The select-apparatus tool's own selection can go stale (the selected
    // funnel/tube got erased) -- drop it rather than keep pointing an edit
    // panel at nothing.
    if (isEditMode && apparatusSelection.selectedFunnelId !== null && !selectedFunnel) apparatusSelection.selectFunnel(null);
    if (isEditMode && apparatusSelection.selectedTubeId !== null && !selectedTube) apparatusSelection.selectTube(null);
    if (isEditMode && selectedFunnel && !apparatusSelection.editDraft) {
      apparatusSelection.editDraft = {
        specId: selectedFunnel.specId,
        tempC: selectedFunnel.tempC,
        ratePerMinute: selectedFunnel.ratePerMinute,
        totalMode: selectedFunnel.total === null ? 'infinite' : 'finite',
        totalAmount: selectedFunnel.total ?? funnelTotalAmount,
      };
    }
    if (isEditMode && selectedTube && !apparatusSelection.tubeEditDraft) {
      apparatusSelection.tubeEditDraft = {
        coneSize: selectedTube.coneSize,
        filter: selectedTube.filter ? new Set(selectedTube.filter) : null,
      };
    }
    const isTubeEditMode = isEditMode && !!selectedTube;
    const tubeFields: TubeFieldValues =
      isTubeEditMode && apparatusSelection.tubeEditDraft ? apparatusSelection.tubeEditDraft : { coneSize: tubeConeSize, filter: tubeFilter };

    const funnelFields: FunnelFieldValues =
      isEditMode && apparatusSelection.editDraft
        ? {
            specLabel: speciesLookup.labelOf(apparatusSelection.editDraft.specId) ?? `spec ${apparatusSelection.editDraft.specId}`,
            specColor: speciesLookup.colorOf(apparatusSelection.editDraft.specId) ?? '#888',
            tempC: apparatusSelection.editDraft.tempC,
            ratePerMinute: apparatusSelection.editDraft.ratePerMinute,
            totalMode: apparatusSelection.editDraft.totalMode,
            totalAmount: apparatusSelection.editDraft.totalAmount,
            remaining: selectedFunnel?.remaining ?? null,
          }
        : {
            specLabel: speciesLookup.labelOf(funnelSpecId) ?? `spec ${funnelSpecId}`,
            specColor: speciesLookup.colorOf(funnelSpecId) ?? '#888',
            tempC: funnelTempC,
            ratePerMinute: funnelRatePerMinute,
            totalMode: funnelTotalMode,
            totalAmount: funnelTotalAmount,
            remaining: null,
          };

    // The radiator tool's settings are only ever read at paint time (see
    // applyTool's 'radiator' case) -- adjusting these sliders is local UI
    // state until the next paint, and never retroactively touches radiators
    // already placed on the grid (see grid.ts's radiatorRadius/
    // radiatorTargetK doc comment). The funnel tool's config works the same
    // way pre-placement; once placed, select-apparatus edits go live
    // instead (see sendFunnelUpdate).
    const sidePanelCallbacks: SidePanelCallbacks = {
      brushWidth,
      onSetBrushWidth: (value) => {
        brushWidth = value;
      },
      brushTempC,
      onSetBrushTemp: (value) => {
        brushTempC = value;
      },
      radiationRadius,
      onSetRadiationRadius: (value) => {
        radiationRadius = value;
      },
      targetTempC,
      onSetTargetTemp: (value) => {
        targetTempC = value;
      },
      funnelFields,
      onOpenFunnelSpeciesPicker: () => {
        ptTarget = isEditMode ? 'funnel-edit' : 'funnel-config';
        ptOpen = true;
        render();
      },
      onSetFunnelTemp: (value) => {
        if (isEditMode && apparatusSelection.editDraft) {
          apparatusSelection.editDraft.tempC = value;
          sendFunnelUpdate();
        } else {
          funnelTempC = value;
        }
      },
      onSetFunnelRate: (value) => {
        if (isEditMode && apparatusSelection.editDraft) {
          apparatusSelection.editDraft.ratePerMinute = value;
          sendFunnelUpdate();
        } else {
          funnelRatePerMinute = value;
        }
      },
      onSetFunnelTotalMode: (mode) => {
        if (isEditMode && apparatusSelection.editDraft) {
          apparatusSelection.editDraft.totalMode = mode;
          sendFunnelUpdate();
        } else {
          funnelTotalMode = mode;
        }
        render();
      },
      onSetFunnelTotalAmount: (value) => {
        if (isEditMode && apparatusSelection.editDraft) {
          apparatusSelection.editDraft.totalAmount = value;
          sendFunnelUpdate();
        } else {
          funnelTotalAmount = value;
        }
      },
      onResetFunnel: () => {
        if (apparatusSelection.selectedFunnelId !== null) send({ type: 'resetFunnel', id: apparatusSelection.selectedFunnelId });
      },
      tubeFields,
      tubePalette: palette,
      onSetTubeConeSize: (value) => {
        if (isTubeEditMode && apparatusSelection.tubeEditDraft) {
          apparatusSelection.tubeEditDraft.coneSize = value;
          sendTubeUpdate();
        } else {
          tubeConeSize = value;
        }
      },
      onToggleTubeFilterSpecies: (specId) => {
        if (isTubeEditMode && apparatusSelection.tubeEditDraft) {
          const draft = apparatusSelection.tubeEditDraft;
          if (draft.filter === null) draft.filter = new Set(palette.map((p) => p.specId));
          if (draft.filter.has(specId)) draft.filter.delete(specId);
          else draft.filter.add(specId);
          sendTubeUpdate();
        } else {
          if (tubeFilter === null) tubeFilter = new Set(palette.map((p) => p.specId));
          if (tubeFilter.has(specId)) tubeFilter.delete(specId);
          else tubeFilter.add(specId);
        }
        render();
      },
      onClearTubeFilter: () => {
        if (isTubeEditMode && apparatusSelection.tubeEditDraft) {
          apparatusSelection.tubeEditDraft.filter = null;
          sendTubeUpdate();
        } else {
          tubeFilter = null;
        }
        render();
      },
    };
    buildSidePanel(sidePanel, meta, sidePanelCallbacks);

    if (ptOpen) {
      ptOverlay.style.display = 'flex';
      const ptCallbacks: PeriodicTableCallbacks = {
        selectedSymbol: ptSelectedSymbol,
        isPinned: (label) => pinnedLabels.includes(label),
        onSelectElement: (symbol) => {
          ptSelectedSymbol = symbol;
          render();
        },
        onSelectSpecies: (specId) => {
          if (ptTarget === 'funnel-config') {
            funnelSpecId = specId;
          } else if (ptTarget === 'funnel-edit' && apparatusSelection.editDraft) {
            apparatusSelection.editDraft.specId = specId;
            sendFunnelUpdate();
          } else {
            setTool({ kind: 'paint', specId });
          }
          ptOpen = false;
          ptSelectedSymbol = null;
          render();
        },
        onTogglePin: togglePin,
        onClose: () => {
          ptOpen = false;
          ptSelectedSymbol = null;
          render();
        },
      };
      buildPeriodicTable(ptOverlay, palette, ptCallbacks);
    } else {
      ptOverlay.style.display = 'none';
      ptOverlay.innerHTML = '';
    }

    updateSelectionBox();
    updateApparatusOverlay(lastHoverX, lastHoverY);
  }

  function gridCoordsFromEvent(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * gridWidth);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * gridHeight);
    return { x, y };
  }

  // Mirrors worker.ts's paintCircle: a brush of "radius" covers every cell
  // within that many grid cells of the center, so the visible outline spans
  // (2*radius + 1) cells across, converted to CSS pixels via the canvas's
  // on-screen size (which can differ from the grid's cell size due to CSS
  // scaling).
  function updateBrushOutline(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    if (gridWidth === 0 || gridHeight === 0) return;
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    const { x, y } = gridCoordsFromEvent(event);
    const centerPxX = (x + 0.5) * cellPxX;
    const centerPxY = (y + 0.5) * cellPxY;
    const diameterX = (2 * brushWidth + 1) * cellPxX;
    const diameterY = (2 * brushWidth + 1) * cellPxY;
    brushOutline.style.display = 'block';
    brushOutline.style.left = `${centerPxX - diameterX / 2}px`;
    brushOutline.style.top = `${centerPxY - diameterY / 2}px`;
    brushOutline.style.width = `${diameterX}px`;
    brushOutline.style.height = `${diameterY}px`;
  }

  /** Draws a tube's lumen (translucent species-blue) and wall ring
   * (translucent grey) plus a handle circle over each knee, onto the
   * already-sized/cleared preview canvas -- shared by the in-progress draw
   * (tool === 'tube') and the select-apparatus edit overlay for whichever
   * tube is currently selected, so both read the same visual language. */
  function drawTubeGhost(ctx: CanvasRenderingContext2D, points: readonly Point[], cellPxX: number, cellPxY: number, isDraft: boolean): void {
    if (points.length === 0) return;
    const lumen = polylineToLumenPath(points);
    ctx.fillStyle = isDraft ? 'rgba(169, 214, 232, 0.45)' : 'rgba(169, 214, 232, 0.3)';
    for (const cell of lumen) {
      ctx.fillRect(cell.x * cellPxX, cell.y * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
    }
    ctx.fillStyle = 'rgba(210, 210, 210, 0.55)';
    for (const cell of lumenWallCells(lumen)) {
      ctx.fillRect(cell.x * cellPxX, cell.y * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
    }
    ctx.fillStyle = isDraft ? '#f2d94e' : '#4da3ff';
    const handleR = Math.max(3, Math.min(cellPxX, cellPxY) * 0.7);
    for (const p of points) {
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * cellPxX, (p.y + 0.5) * cellPxY, handleR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Ghost preview overlay, drawn on the shared 2D canvas (see
   * apparatusPreview's creation comment): the funnel tool's rotated glass
   * outline at the hovered cell, the tube tool's in-progress polyline with
   * a live rubber-band segment to the cursor, or the select-apparatus
   * tool's knee/segment handles for whichever tube is currently selected.
   * Resized to match the sim canvas's on-screen CSS size every call --
   * cheap, since it only runs on hover/wheel, not every tick. */
  function updateApparatusOverlay(x: number, y: number): void {
    const showFunnelGhost = tool?.kind === 'funnel';
    const showTubeDraw = tool?.kind === 'tube' && tubeDrawPoints.length > 0;
    const editingTube = tool?.kind === 'select-apparatus' ? apparatusSelection.findTube(apparatusSelection.selectedTubeId) : undefined;
    if ((!showFunnelGhost && !showTubeDraw && !editingTube) || gridWidth === 0 || gridHeight === 0) {
      apparatusPreview.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (apparatusPreview.width !== width || apparatusPreview.height !== height) {
      apparatusPreview.width = width;
      apparatusPreview.height = height;
      previewCtx = apparatusPreview.getContext('2d');
    }
    if (!previewCtx) return;
    apparatusPreview.style.display = 'block';
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    previewCtx.clearRect(0, 0, apparatusPreview.width, apparatusPreview.height);

    if (showFunnelGhost) {
      previewCtx.fillStyle = 'rgba(169, 214, 232, 0.55)';
      const shape = funnelShapeFor(funnelFacing);
      for (const cell of shape.cells) {
        const px = x + cell.dx;
        const py = y + cell.dy;
        previewCtx.fillRect(px * cellPxX, py * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
      }
    }

    if (showTubeDraw) {
      const last = tubeDrawPoints[tubeDrawPoints.length - 1] as Point;
      tubeDrawPreview = snapOctant(last, { x, y });
      drawTubeGhost(previewCtx, [...tubeDrawPoints, tubeDrawPreview], cellPxX, cellPxY, true);
    }

    if (editingTube) {
      drawTubeGhost(previewCtx, editingTube.points, cellPxX, cellPxY, false);
    }
  }

  /** Commits the in-progress tube draw (right-click): places a new tube if
   * at least one full segment was drawn, or silently discards a lone mouth
   * click with nothing to commit yet. */
  function finishTubeDraw(): void {
    if (tubeDrawPoints.length >= 2) {
      send({ type: 'placeTube', points: tubeDrawPoints, coneSize: tubeConeSize, filter: tubeFilter ? [...tubeFilter] : null });
    }
    cancelTubeDraw();
  }

  /** Discards the in-progress tube draw entirely (Escape) -- unlike
   * right-click, never places anything even if segments were already
   * committed. */
  function cancelTubeDraw(): void {
    tubeDrawPoints = [];
    tubeDrawPreview = null;
    render();
    updateApparatusOverlay(lastHoverX, lastHoverY);
  }

  /** Positions the select-apparatus tool's corner-bracket overlay over the
   * selected funnel's bounding box, or hides it. */
  function updateSelectionBox(): void {
    const selected = tool?.kind === 'select-apparatus' ? apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId) : undefined;
    if (!selected || gridWidth === 0 || gridHeight === 0) {
      selectBox.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    const bounds = funnelBounds(funnelShapeFor(selected.facing));
    selectBox.style.display = 'block';
    selectBox.style.left = `${(selected.anchorX + bounds.minDx) * cellPxX}px`;
    selectBox.style.top = `${(selected.anchorY + bounds.minDy) * cellPxY}px`;
    selectBox.style.width = `${(bounds.maxDx - bounds.minDx + 1) * cellPxX}px`;
    selectBox.style.height = `${(bounds.maxDy - bounds.minDy + 1) * cellPxY}px`;
  }

  function applyTool(x: number, y: number): void {
    if (!tool) return;
    switch (tool.kind) {
      case 'paint':
        send({ type: 'paint', x, y, radius: brushWidth, specId: tool.specId, tempC: brushTempC });
        break;
      case 'wall':
        send({ type: 'paint', x, y, radius: brushWidth, specId: tool.specId, tempC: brushTempC });
        break;
      case 'radiator':
        send({ type: 'paintRadiator', x, y, brushRadius: brushWidth, radiationRadius, targetTempC });
        break;
      case 'erase':
        send({ type: 'erase', x, y, radius: brushWidth });
        break;
      case 'mixer':
        // Handled directly by the pointerdown/pointermove/pointerup
        // handlers below (stirStart/stirMove/stirEnd) rather than here, so
        // the worker can keep re-stirring the held brush every simulation
        // tick, not just once per pointer event -- see isMixing.
        break;
      case 'stirrer':
        send({ type: 'paintStirrer', x, y, radius: brushWidth });
        break;
      case 'grabber':
        break;
      case 'funnel':
        send({
          type: 'placeFunnel',
          x,
          y,
          facing: funnelFacing,
          specId: funnelSpecId,
          tempC: funnelTempC,
          ratePerMinute: funnelRatePerMinute,
          total: funnelTotalMode === 'infinite' ? null : funnelTotalAmount,
        });
        break;
      case 'tube': {
        const last = tubeDrawPoints[tubeDrawPoints.length - 1];
        const snapped = last ? snapOctant(last, { x, y }) : { x, y };
        tubeDrawPoints = [...tubeDrawPoints, snapped];
        render();
        break;
      }
      case 'select-apparatus':
        apparatusSelection.beginSelection(x, y);
        render();
        break;
    }
  }

  function updateInspector(x: number, y: number): void {
    if (!lastSpecId || !lastPhase || !lastTempK || !renderer) return;
    if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) {
      inspector.classList.add('empty');
      inspectorText.textContent = 'Hover the canvas to inspect a cell';
      return;
    }
    const idx = y * gridWidth + x;
    const specId = lastSpecId[idx] as number;
    const hasRadiator = lastRadiatorRadius ? (lastRadiatorRadius[idx] as number) > 0 : false;
    const radiatorNote = hasRadiator && lastRadiatorTargetK ? ` · radiator target ${formatCelsius(kelvinToCelsius(lastRadiatorTargetK[idx] as number))}` : '';
    if (specId === EMPTY) {
      inspector.classList.add('empty');
      inspectorText.textContent = `empty${radiatorNote}`;
      return;
    }
    inspector.classList.remove('empty');
    const label = speciesLookup.labelOf(specId) ?? `spec ${specId}`;
    inspectorSwatch.style.background = speciesLookup.colorOf(specId) ?? '#888';
    const tempC = kelvinToCelsius(lastTempK[idx] as number);
    const phaseCode = lastPhase[idx] as number;
    const phase = PHASE_LABEL[phaseCode] ?? 'unknown';
    inspectorText.textContent = `${label} · ${tempC.toFixed(1)}°C · ${phase}${radiatorNote}`;
  }

  canvas.addEventListener('pointerdown', (event) => {
    isPointerDown = true;
    const { x, y } = gridCoordsFromEvent(event);
    if (tool?.kind === 'grabber') {
      isGrabbing = true;
      send({ type: 'grabStart', x, y, radius: brushWidth });
    } else if (tool?.kind === 'mixer') {
      isMixing = true;
      send({ type: 'stirStart', x, y, radius: brushWidth });
    } else {
      applyTool(x, y);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    const { x, y } = gridCoordsFromEvent(event);
    lastHoverX = x;
    lastHoverY = y;
    if (isPointerDown) {
      if (isGrabbing) {
        send({ type: 'grabMove', x, y });
      } else if (isMixing) {
        send({ type: 'stirMove', x, y });
      } else if (tool?.kind === 'select-apparatus') {
        // Selecting is a single-click action (applyTool already ran once on
        // pointerdown), but if that click grabbed a funnel or a tube
        // knee/segment, dragging moves it -- see continueDrag's doc comment.
        const msg = apparatusSelection.continueDrag(x, y);
        if (msg) send(msg);
      } else if (tool?.kind !== 'funnel' && tool?.kind !== 'tube') {
        // Single-click action (place once) rather than a brush --
        // applyTool already ran once on pointerdown, so a drag shouldn't
        // re-place on every move.
        applyTool(x, y);
      }
    }
    updateInspector(x, y);
    updateBrushOutline(event);
    updateApparatusOverlay(x, y);
  });
  canvas.addEventListener('pointerleave', () => {
    inspector.classList.add('empty');
    inspectorText.textContent = 'Hover the canvas to inspect a cell';
    brushOutline.style.display = 'none';
    apparatusPreview.style.display = 'none';
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (tool?.kind !== 'funnel') return;
      event.preventDefault();
      funnelFacing = nextFunnelFacing(funnelFacing, event.deltaY > 0 ? 1 : -1);
      updateApparatusOverlay(lastHoverX, lastHoverY);
    },
    { passive: false },
  );
  // Right-click finishes the in-progress tube draw (commits every already-
  // clicked segment) rather than opening the browser context menu.
  canvas.addEventListener('contextmenu', (event) => {
    if (tool?.kind !== 'tube') return;
    event.preventDefault();
    finishTubeDraw();
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && tool?.kind === 'tube' && tubeDrawPoints.length > 0) {
      cancelTubeDraw();
    }
  });
  window.addEventListener('pointerup', () => {
    if (isGrabbing) {
      send({ type: 'grabEnd' });
      isGrabbing = false;
    }
    if (isMixing) {
      send({ type: 'stirEnd' });
      isMixing = false;
    }
    apparatusSelection.endDrag();
    isPointerDown = false;
  });

  worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;
    if (msg.type === 'ready') {
      gridWidth = msg.width;
      gridHeight = msg.height;
      palette = msg.palette;
      speciesLookup.setPalette(msg.palette);
      renderer = createRenderer(canvas, gridWidth, gridHeight);
      for (const entry of msg.palette) renderer.setColorForSpec(entry.specId, entry.color);
      for (const wall of wallList()) renderer.setColorForSpec(wall.specId, wall.color);

      const firstPinned = pinnedLabels.map((label) => palette.find((entry) => entry.label === label)).find((entry): entry is PaletteEntry => !!entry);
      const initial = firstPinned ?? palette[0];
      if (initial) {
        tool = { kind: 'paint', specId: initial.specId };
        funnelSpecId = initial.specId;
      }
      render();
    } else if (msg.type === 'frame') {
      lastSpecId = msg.specId;
      lastPhase = msg.phase;
      lastTempK = msg.tempK;
      lastRadiatorRadius = msg.radiatorRadius;
      lastRadiatorTargetK = msg.radiatorTargetK;
      apparatusSelection.setFunnels(msg.funnels);
      apparatusSelection.setTubes(msg.tubes);
      lastTick = msg.tick;
      renderer?.drawFrame({
        specId: msg.specId,
        phase: msg.phase,
        tempK: msg.tempK,
        radiatorRadius: msg.radiatorRadius,
        radiatorTargetK: msg.radiatorTargetK,
        stirrerMask: msg.stirrerMask,
        tubeMask: msg.tubeMask,
        funnelFillSpecId: msg.funnelFillSpecId,
      });
      // The select-apparatus tool's edit panel shows a placed funnel's live
      // "Remaining" count and needs to reflect Reset immediately -- only the
      // side panel is rebuilt here, not the toolbar, so a rapid succession of
      // frame ticks can't blow away a toolbar button mid-click.
      //
      // Skipped while focus is inside the panel itself: a rebuild replaces
      // the DOM node under an active drag (e.g. the cone-size range input),
      // which kills the browser's native drag gesture on every tick -- a
      // slider could only ever be "clicked" (one input event, completing
      // before the next frame lands), never dragged.
      if (tool?.kind === 'select-apparatus') {
        if (!sidePanel.contains(document.activeElement)) renderSidePanel();
      } else {
        updateSelectionBox();
      }
    }
  };

  // Dev-only debug hook for inspecting/driving the sim from outside the UI
  // (browser devtools console, or an automated tool poking window.__pixistry)
  // -- exposes the same paint/erase/setRunning/step messages the toolbar
  // sends, plus read-only access to the latest frame the renderer already
  // keeps around for the hover inspector. Not part of the app's real API,
  // never imported by app code -- purely a debugging aid.
  if (import.meta.env.DEV) {
    (window as unknown as { __pixistry: unknown }).__pixistry = {
      pause: () => {
        running = false;
        send({ type: 'setRunning', running });
        render();
      },
      resume: () => {
        running = true;
        send({ type: 'setRunning', running });
        render();
      },
      step: () => send({ type: 'step' }),
      setSpeed: (value: number) => {
        speed = value;
        send({ type: 'setSpeed', speed });
        render();
      },
      isRunning: () => running,
      getTick: () => lastTick,
      size: () => ({ width: gridWidth, height: gridHeight }),
      getCell: (x: number, y: number) => {
        if (!lastSpecId || !lastPhase || !lastTempK || x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return null;
        const idx = y * gridWidth + x;
        const specId = lastSpecId[idx] ?? EMPTY;
        const tempK = lastTempK[idx] ?? 0;
        const phaseCode = lastPhase[idx] ?? PhaseCode.Empty;
        return {
          x,
          y,
          specId,
          label: specId === EMPTY ? null : (speciesLookup.labelOf(specId) ?? null),
          tempK,
          tempC: kelvinToCelsius(tempK),
          phase: PHASE_LABEL[phaseCode] ?? 'unknown',
          radiatorRadius: lastRadiatorRadius?.[idx] ?? 0,
          radiatorTargetK: lastRadiatorTargetK?.[idx] ?? 0,
        };
      },
      dumpGrid: () => {
        if (!lastSpecId || !lastPhase || !lastTempK) return null;
        return {
          width: gridWidth,
          height: gridHeight,
          tick: lastTick,
          specId: Array.from(lastSpecId),
          phase: Array.from(lastPhase, (p) => PHASE_LABEL[p] ?? 'unknown'),
          tempC: Array.from(lastTempK, kelvinToCelsius),
        };
      },
      findSpecId: (label: string) => palette.find((entry) => entry.label === label)?.specId,
      paint: (x: number, y: number, specId: number, opts: { radius?: number; tempC?: number } = {}) =>
        send({ type: 'paint', x, y, radius: opts.radius ?? 0, specId, tempC: opts.tempC ?? brushTempC }),
      erase: (x: number, y: number, radius = 0) => send({ type: 'erase', x, y, radius }),
    };
  }
}
