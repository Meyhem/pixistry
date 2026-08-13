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
import type { MainToWorkerMessage, WorkerToMainMessage } from '../sim/worker';
import type { PaletteEntry } from '../sim/species';
import { EMPTY, PhaseCode } from '../sim/grid';
import { BORDER_RANGE_K } from '../render/renderer';
import { getWall, wallList } from '../sim/walls';
import { RADIATORS, radiatorFor, type RadiatorSign } from '../sim/radiators';
import { buildToolbar, type ToolbarCallbacks } from './toolbar';
import { buildSidePanel, type SidePanelCallbacks, type ToolMeta } from './side-panel';
import { buildPeriodicTable, type PeriodicTableCallbacks } from './periodic-table';
import { isElementLabel } from './species-classify';
import { formatCelsius } from './format';

const DEFAULT_RADIUS = 2;
const DEFAULT_RADIATION_RADIUS = 3;
// Matches the worker's own defaults (see worker.ts's DEFAULT_HEATER_TARGET_K
// / DEFAULT_COOLER_TARGET_K) so the side panel's slider starts in sync with
// what a freshly placed radiator is already doing.
const DEFAULT_HEATER_TARGET_C = 100;
const DEFAULT_COOLER_TARGET_C = -20;
const DEFAULT_BRUSH_TEMP_C = Math.round(kelvinToCelsius(AMBIENT_TEMPERATURE_K));
const DEFAULT_PINNED_LABELS = ['H2O', 'NaCl', 'Fe', 'Cu', 'Na', 'Cl2', 'O2', 'C', 'Ag'];
const PINNED_STORAGE_KEY = 'pixistry.pinnedSpecies';

type Tool =
  | { kind: 'paint'; specId: number }
  | { kind: 'erase' }
  | { kind: 'wall'; specId: number }
  | { kind: 'radiator'; sign: RadiatorSign }
  | { kind: 'mixer' }
  | { kind: 'grabber' };

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
  let heaterTargetC = DEFAULT_HEATER_TARGET_C;
  let coolerTargetC = DEFAULT_COOLER_TARGET_C;
  let pinnedLabels = loadPinnedLabels();
  let ptOpen = false;
  let ptSelectedSymbol: string | null = null;
  let isPointerDown = false;
  let isGrabbing = false;

  // Label lookup for the probe: palette species and walls. Reaction
  // products (M5) can mint specIds beyond the initial palette -- the
  // inspector falls back to `spec N` for those (see updateInspector); a
  // real formula lookup would need the main thread to see the worker's
  // InternedPool, which it deliberately doesn't.
  const labelBySpecId = new Map<number, string>();
  const colorBySpecId = new Map<number, string>();
  for (const wall of wallList()) {
    labelBySpecId.set(wall.specId, wall.label);
    colorBySpecId.set(wall.specId, wall.color);
  }

  // Latest frame data, kept around purely so the hover inspector can look
  // up a cell locally without a worker round trip.
  let lastSpecId: Uint16Array | null = null;
  let lastPhase: Uint8Array | null = null;
  let lastTempK: Float32Array | null = null;
  let lastRadiator: Int16Array | null = null;

  function paletteEntryFor(specId: number): PaletteEntry | undefined {
    return palette.find((entry) => entry.specId === specId);
  }

  function describeToolMeta(t: Tool | null): ToolMeta {
    if (!t) {
      return { label: 'No tool selected', color: '#3a3d3a', category: '', isSpecies: false, meltLabel: '', boilLabel: '', phaseLabel: '', isThermal: false, isHeater: false };
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
        isHeater: false,
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
        isHeater: false,
      };
    }
    if (t.kind === 'radiator') {
      const radiator = radiatorFor(t.sign);
      return {
        label: radiator.label,
        color: radiator.color,
        category: 'APPARATUS',
        isSpecies: false,
        meltLabel: '',
        boilLabel: '',
        phaseLabel: '',
        isThermal: true,
        isHeater: radiator.sign > 0,
      };
    }
    const TOOL_META: Record<'erase' | 'mixer' | 'grabber', { label: string; color: string }> = {
      erase: { label: 'Erase', color: '#8a8a8a' },
      mixer: { label: 'Mixer', color: '#c9a8ff' },
      grabber: { label: 'Grabber', color: '#f2d94e' },
    };
    const info = TOOL_META[t.kind];
    return { label: info.label, color: info.color, category: 'TOOL', isSpecies: false, meltLabel: '', boilLabel: '', phaseLabel: '', isThermal: false, isHeater: false };
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

  function render(): void {
    const toolbarCallbacks: ToolbarCallbacks = {
      isPaintActive: (specId) => tool?.kind === 'paint' && tool.specId === specId,
      isWallActive: (specId) => tool?.kind === 'wall' && tool.specId === specId,
      isRadiatorActive: (sign) => tool?.kind === 'radiator' && tool.sign === sign,
      isToolActive: (kind) => tool?.kind === kind,
      isPinned: (label) => pinnedLabels.includes(label),
      onSelectPaint: (specId) => setTool({ kind: 'paint', specId }),
      onSelectWall: (specId) => setTool({ kind: 'wall', specId }),
      onSelectRadiator: (sign) => setTool({ kind: 'radiator', sign }),
      onSelectTool: (kind) => setTool({ kind }),
      onTogglePin: togglePin,
      onOpenPeriodicTable: () => {
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
    buildToolbar(toolbar, palette, wallList(), RADIATORS, pinnedLabels, toolbarCallbacks);

    const meta = describeToolMeta(tool);
    const isHeaterActive = tool?.kind === 'radiator' && tool.sign > 0;
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
        renderer?.setRadiationRadius(value);
        send({ type: 'setRadiationRadius', radius: value });
      },
      targetTempC: isHeaterActive ? heaterTargetC : coolerTargetC,
      onSetTargetTemp: (value) => {
        if (isHeaterActive) heaterTargetC = value;
        else coolerTargetC = value;
        send({ type: 'setTargetTempC', kind: isHeaterActive ? 'heater' : 'cooler', celsius: value });
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
          setTool({ kind: 'paint', specId });
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
  }

  function gridCoordsFromEvent(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * gridWidth);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * gridHeight);
    return { x, y };
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
        send({ type: 'paintRadiator', x, y, radius: brushWidth, watts: radiatorFor(tool.sign).watts });
        break;
      case 'erase':
        send({ type: 'erase', x, y, radius: brushWidth });
        break;
      case 'mixer':
        send({ type: 'stir', x, y, radius: brushWidth });
        break;
      case 'grabber':
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
    const radWatts = lastRadiator ? (lastRadiator[idx] as number) : 0;
    const radiatorNote = radWatts > 0 ? ' · radiating heat' : radWatts < 0 ? ' · radiating cold' : '';
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
    } else {
      applyTool(x, y);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    const { x, y } = gridCoordsFromEvent(event);
    if (isPointerDown) {
      if (isGrabbing) {
        send({ type: 'grabMove', x, y });
      } else {
        applyTool(x, y);
      }
    }
    updateInspector(x, y);
  });
  canvas.addEventListener('pointerleave', () => {
    inspector.classList.add('empty');
    inspectorText.textContent = 'Hover the canvas to inspect a cell';
  });
  window.addEventListener('pointerup', () => {
    if (isGrabbing) {
      send({ type: 'grabEnd' });
      isGrabbing = false;
    }
    isPointerDown = false;
  });

  worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;
    if (msg.type === 'ready') {
      gridWidth = msg.width;
      gridHeight = msg.height;
      palette = msg.palette;
      renderer = createRenderer(canvas, gridWidth, gridHeight);
      renderer.setRadiationRadius(radiationRadius);
      for (const entry of msg.palette) {
        renderer.setColorForSpec(entry.specId, entry.color);
        labelBySpecId.set(entry.specId, entry.label);
        colorBySpecId.set(entry.specId, entry.color);
      }
      for (const wall of wallList()) renderer.setColorForSpec(wall.specId, wall.color);

      const firstPinned = pinnedLabels.map((label) => palette.find((entry) => entry.label === label)).find((entry): entry is PaletteEntry => !!entry);
      const initial = firstPinned ?? palette[0];
      if (initial) tool = { kind: 'paint', specId: initial.specId };
      render();
    } else if (msg.type === 'frame') {
      lastSpecId = msg.specId;
      lastPhase = msg.phase;
      lastTempK = msg.tempK;
      lastRadiator = msg.radiator;
      renderer?.drawFrame({ specId: msg.specId, phase: msg.phase, tempK: msg.tempK, radiator: msg.radiator });
    }
  };
}
