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
import type { FunnelSnapshot, MainToWorkerMessage, WorkerToMainMessage } from '../sim/worker';
import type { PaletteEntry } from '../sim/species';
import { EMPTY, PhaseCode } from '../sim/grid';
import { BORDER_RANGE_K } from '../render/renderer';
import { getWall, wallList } from '../sim/walls';
import { RADIATOR_COLOR, RADIATOR_LABEL } from '../sim/radiators';
import { FUNNEL_COLOR, FUNNEL_LABEL } from '../sim/funnel';
import { STIRRER_COLOR, STIRRER_LABEL } from '../sim/stirrer';
import { funnelBounds, funnelShapeFor, nextFunnelFacing, type FunnelFacing } from '../sim/apparatus-shapes';
import { buildToolbar, SELECT_APPARATUS_COLOR, SELECT_APPARATUS_LABEL, type ToolbarCallbacks } from './toolbar';
import { buildSidePanel, type FunnelFieldValues, type SidePanelCallbacks, type ToolMeta } from './side-panel';
import { buildPeriodicTable, type PeriodicTableCallbacks } from './periodic-table';
import { isElementLabel } from './species-classify';
import { SPECIES } from '../sim/species-data';
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
  | { kind: 'select-apparatus' };

/** Local draft for the select-apparatus tool's edit panel -- mirrors a
 * selected funnel's live config so every field edit (temp/rate/species/
 * total) sends a complete 'updateFunnel' message built from this draft
 * rather than from the worker's last snapshot, which only refreshes once
 * per frame and would otherwise let a second quick edit clobber the first
 * (see app.ts's sendFunnelUpdate). Re-seeded from the snapshot whenever the
 * selection changes (see selectFunnel/render). */
interface FunnelEditDraft {
  specId: number;
  tempC: number;
  ratePerMinute: number;
  totalMode: 'finite' | 'infinite';
  totalAmount: number;
}

const PHASE_LABEL: Record<number, string> = {
  [PhaseCode.Empty]: 'empty',
  [PhaseCode.Solid]: 'solid',
  [PhaseCode.Liquid]: 'liquid',
  [PhaseCode.Gas]: 'gas',
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

  // Ghost preview for the funnel tool (see updateFunnelPreview): a 2D
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

  // select-apparatus tool state: which placed funnel (by worker-assigned
  // id) is selected, and a local edit draft for its settings -- see
  // FunnelEditDraft's doc comment for why edits go through a draft instead
  // of the last-known snapshot directly.
  let selectedFunnelId: number | null = null;
  let editDraft: FunnelEditDraft | null = null;
  let lastFunnels: FunnelSnapshot[] = [];

  // select-apparatus drag-to-move state: set on pointerdown when the click
  // hit a funnel, cleared on pointerup. dragOffsetX/Y is the click point's
  // offset from the funnel's anchor at grab time, so the funnel moves
  // relative to where it was grabbed rather than snapping its anchor to the
  // cursor.
  let draggingFunnelId: number | null = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;

  // Label lookup for the probe: every species (SPECIES is a fully static
  // table shared by main thread and worker, so specIds are stable array
  // indices -- no need to round-trip through the worker) plus walls.
  const labelBySpecId = new Map<number, string>();
  const colorBySpecId = new Map<number, string>();
  SPECIES.forEach((data, specId) => {
    labelBySpecId.set(specId, data.name);
    colorBySpecId.set(specId, data.color);
  });
  for (const wall of wallList()) {
    labelBySpecId.set(wall.specId, wall.label);
    colorBySpecId.set(wall.specId, wall.color);
  }

  // Latest frame data, kept around purely so the hover inspector can look
  // up a cell locally without a worker round trip.
  let lastSpecId: Uint16Array | null = null;
  let lastPhase: Uint8Array | null = null;
  let lastTempK: Float32Array | null = null;
  let lastRadiatorRadius: Uint8Array | null = null;
  let lastRadiatorTargetK: Float32Array | null = null;
  let lastTick = 0;

  function paletteEntryFor(specId: number): PaletteEntry | undefined {
    return palette.find((entry) => entry.specId === specId);
  }

  function findFunnel(id: number | null): FunnelSnapshot | undefined {
    return id === null ? undefined : lastFunnels.find((f) => f.id === id);
  }

  function describeToolMeta(t: Tool | null): ToolMeta {
    if (!t) {
      return {
        label: 'No tool selected',
        color: '#3a3d3a',
        category: '',
        isSpecies: false,
        meltLabel: '',
        boilLabel: '',
        phaseLabel: '',
        isThermal: false,
        showBrushTemp: false,
        showBrushWidth: true,
        funnelPanel: 'none',
      };
    }
    if (t.kind === 'paint') {
      const entry = paletteEntryFor(t.specId);
      if (!entry) return describeToolMeta(null);
      return {
        label: entry.label,
        color: entry.color,
        category: isElementLabel(entry.label) ? 'ELEMENT' : 'COMPOUND',
        isSpecies: true,
        meltLabel: formatCelsius(entry.meltingPointC),
        boilLabel: formatCelsius(entry.boilingPointC),
        phaseLabel: PHASE_LABEL[entry.phase] ?? '',
        isThermal: false,
        showBrushTemp: true,
        showBrushWidth: true,
        funnelPanel: 'none',
      };
    }
    if (t.kind === 'wall') {
      const wall = getWall(t.specId);
      return {
        label: wall.label,
        color: wall.color,
        category: 'APPARATUS',
        isSpecies: false,
        meltLabel: '',
        boilLabel: '',
        phaseLabel: '',
        isThermal: false,
        showBrushTemp: true,
        showBrushWidth: true,
        funnelPanel: 'none',
      };
    }
    if (t.kind === 'radiator') {
      return {
        label: RADIATOR_LABEL,
        color: RADIATOR_COLOR,
        category: 'APPARATUS',
        isSpecies: false,
        meltLabel: '',
        boilLabel: '',
        phaseLabel: '',
        isThermal: true,
        showBrushTemp: false,
        showBrushWidth: true,
        funnelPanel: 'none',
      };
    }
    if (t.kind === 'funnel') {
      return {
        label: FUNNEL_LABEL,
        color: FUNNEL_COLOR,
        category: 'APPARATUS',
        isSpecies: false,
        meltLabel: '',
        boilLabel: '',
        phaseLabel: '',
        isThermal: false,
        showBrushTemp: false,
        showBrushWidth: false,
        funnelPanel: 'config',
      };
    }
    if (t.kind === 'stirrer') {
      return {
        label: STIRRER_LABEL,
        color: STIRRER_COLOR,
        category: 'APPARATUS',
        isSpecies: false,
        meltLabel: '',
        boilLabel: '',
        phaseLabel: '',
        isThermal: false,
        showBrushTemp: false,
        showBrushWidth: true,
        funnelPanel: 'none',
      };
    }
    if (t.kind === 'select-apparatus') {
      const selected = findFunnel(selectedFunnelId);
      return {
        label: selected ? FUNNEL_LABEL : SELECT_APPARATUS_LABEL,
        color: selected ? FUNNEL_COLOR : SELECT_APPARATUS_COLOR,
        category: selected ? 'APPARATUS' : 'TOOL',
        isSpecies: false,
        meltLabel: '',
        boilLabel: '',
        phaseLabel: '',
        isThermal: false,
        showBrushTemp: false,
        showBrushWidth: false,
        funnelPanel: selected ? 'edit' : 'edit-empty',
      };
    }
    const TOOL_META: Record<'erase' | 'mixer' | 'grabber', { label: string; color: string }> = {
      erase: { label: 'Erase', color: '#8a8a8a' },
      mixer: { label: 'Mix', color: '#c9a8ff' },
      grabber: { label: 'Grab', color: '#f2d94e' },
    };
    const info = TOOL_META[t.kind];
    return {
      label: info.label,
      color: info.color,
      category: 'TOOL',
      isSpecies: false,
      meltLabel: '',
      boilLabel: '',
      phaseLabel: '',
      isThermal: false,
      showBrushTemp: false,
      showBrushWidth: true,
      funnelPanel: 'none',
    };
  }

  function setTool(next: Tool): void {
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

  function selectFunnel(id: number | null): void {
    selectedFunnelId = id;
    editDraft = null;
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
    const selectedFunnel = isEditMode ? findFunnel(selectedFunnelId) : undefined;
    // The select-apparatus tool's own selection can go stale (the selected
    // funnel got erased, or depleted+erased) -- drop it rather than keep
    // pointing an edit panel at nothing.
    if (isEditMode && selectedFunnelId !== null && !selectedFunnel) selectFunnel(null);
    if (isEditMode && selectedFunnel && !editDraft) {
      editDraft = {
        specId: selectedFunnel.specId,
        tempC: selectedFunnel.tempC,
        ratePerMinute: selectedFunnel.ratePerMinute,
        totalMode: selectedFunnel.total === null ? 'infinite' : 'finite',
        totalAmount: selectedFunnel.total ?? funnelTotalAmount,
      };
    }

    const funnelFields: FunnelFieldValues =
      isEditMode && editDraft
        ? {
            specLabel: labelBySpecId.get(editDraft.specId) ?? `spec ${editDraft.specId}`,
            specColor: colorBySpecId.get(editDraft.specId) ?? '#888',
            tempC: editDraft.tempC,
            ratePerMinute: editDraft.ratePerMinute,
            totalMode: editDraft.totalMode,
            totalAmount: editDraft.totalAmount,
            remaining: selectedFunnel?.remaining ?? null,
          }
        : {
            specLabel: labelBySpecId.get(funnelSpecId) ?? `spec ${funnelSpecId}`,
            specColor: colorBySpecId.get(funnelSpecId) ?? '#888',
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
        if (isEditMode && editDraft) {
          editDraft.tempC = value;
          sendFunnelUpdate();
        } else {
          funnelTempC = value;
        }
      },
      onSetFunnelRate: (value) => {
        if (isEditMode && editDraft) {
          editDraft.ratePerMinute = value;
          sendFunnelUpdate();
        } else {
          funnelRatePerMinute = value;
        }
      },
      onSetFunnelTotalMode: (mode) => {
        if (isEditMode && editDraft) {
          editDraft.totalMode = mode;
          sendFunnelUpdate();
        } else {
          funnelTotalMode = mode;
        }
        render();
      },
      onSetFunnelTotalAmount: (value) => {
        if (isEditMode && editDraft) {
          editDraft.totalAmount = value;
          sendFunnelUpdate();
        } else {
          funnelTotalAmount = value;
        }
      },
      onResetFunnel: () => {
        if (selectedFunnelId !== null) send({ type: 'resetFunnel', id: selectedFunnelId });
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
          } else if (ptTarget === 'funnel-edit' && editDraft) {
            editDraft.specId = specId;
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

  // Ghost preview for the funnel tool: draws the rotated glass outline at
  // the hovered cell on a plain 2D overlay canvas (see apparatusPreview's
  // creation comment). Resized to match the sim canvas's on-screen CSS size
  // every call -- cheap, since it only happens on hover/wheel while the
  // funnel tool is active, not every tick.
  function updateFunnelPreview(x: number, y: number): void {
    if (tool?.kind !== 'funnel' || gridWidth === 0 || gridHeight === 0) {
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
    previewCtx.fillStyle = 'rgba(169, 214, 232, 0.55)';
    const shape = funnelShapeFor(funnelFacing);
    for (const cell of shape.cells) {
      const px = x + cell.dx;
      const py = y + cell.dy;
      previewCtx.fillRect(px * cellPxX, py * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
    }
  }

  /** Bounding box hit-test against every placed funnel's rotated outline
   * (see apparatus-shapes.ts's funnelBounds) -- good enough for "click
   * anywhere near the funnel selects it" without pixel-perfect glass
   * hit-testing. Returns the first match; overlapping funnels are an edge
   * case not worth resolving more precisely. */
  function hitTestFunnel(x: number, y: number): number | null {
    for (const f of lastFunnels) {
      const bounds = funnelBounds(funnelShapeFor(f.facing));
      if (x >= f.anchorX + bounds.minDx && x <= f.anchorX + bounds.maxDx && y >= f.anchorY + bounds.minDy && y <= f.anchorY + bounds.maxDy) {
        return f.id;
      }
    }
    return null;
  }

  /** Positions the select-apparatus tool's corner-bracket overlay over the
   * selected funnel's bounding box, or hides it. */
  function updateSelectionBox(): void {
    const selected = tool?.kind === 'select-apparatus' ? findFunnel(selectedFunnelId) : undefined;
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
      case 'select-apparatus': {
        const hitId = hitTestFunnel(x, y);
        selectFunnel(hitId);
        const hit = hitId === null ? undefined : findFunnel(hitId);
        if (hit) {
          draggingFunnelId = hitId;
          dragOffsetX = x - hit.anchorX;
          dragOffsetY = y - hit.anchorY;
        } else {
          draggingFunnelId = null;
        }
        render();
        break;
      }
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
    const label = labelBySpecId.get(specId) ?? `spec ${specId}`;
    inspectorSwatch.style.background = colorBySpecId.get(specId) ?? '#888';
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
        // pointerdown), but if that click grabbed a funnel, dragging moves
        // it -- offset-relative to where it was grabbed, not snapped to the
        // cursor.
        if (draggingFunnelId !== null) {
          send({ type: 'moveFunnel', id: draggingFunnelId, x: x - dragOffsetX, y: y - dragOffsetY });
        }
      } else if (tool?.kind !== 'funnel') {
        // Single-click action (place once) rather than a brush --
        // applyTool already ran once on pointerdown, so a drag shouldn't
        // re-place on every move.
        applyTool(x, y);
      }
    }
    updateInspector(x, y);
    updateBrushOutline(event);
    updateFunnelPreview(x, y);
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
      updateFunnelPreview(lastHoverX, lastHoverY);
    },
    { passive: false },
  );
  window.addEventListener('pointerup', () => {
    if (isGrabbing) {
      send({ type: 'grabEnd' });
      isGrabbing = false;
    }
    if (isMixing) {
      send({ type: 'stirEnd' });
      isMixing = false;
    }
    draggingFunnelId = null;
    isPointerDown = false;
  });

  worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;
    if (msg.type === 'ready') {
      gridWidth = msg.width;
      gridHeight = msg.height;
      palette = msg.palette;
      renderer = createRenderer(canvas, gridWidth, gridHeight);
      for (const entry of msg.palette) {
        renderer.setColorForSpec(entry.specId, entry.color);
        labelBySpecId.set(entry.specId, entry.label);
        colorBySpecId.set(entry.specId, entry.color);
      }
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
      lastFunnels = msg.funnels;
      lastTick = msg.tick;
      renderer?.drawFrame({
        specId: msg.specId,
        phase: msg.phase,
        tempK: msg.tempK,
        radiatorRadius: msg.radiatorRadius,
        radiatorTargetK: msg.radiatorTargetK,
        stirrerMask: msg.stirrerMask,
        funnelFillSpecId: msg.funnelFillSpecId,
      });
      // The select-apparatus tool's edit panel shows a placed funnel's live
      // "Remaining" count and needs to reflect Reset immediately -- only the
      // side panel is rebuilt here, not the toolbar, so a rapid succession of
      // frame ticks can't blow away a toolbar button mid-click.
      if (tool?.kind === 'select-apparatus') renderSidePanel();
      else updateSelectionBox();
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
          label: specId === EMPTY ? null : (labelBySpecId.get(specId) ?? null),
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
