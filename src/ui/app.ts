// M4 UI: the full v1 tool set (paint, erase, wall materials including
// heater-glass/cooler-glass, probe, mixer) plus time controls (pause,
// single-step, speed multiplier) and a hover inspector -- all plain DOM per
// the design doc's "src/ui plain DOM/React panels", no framework.
//
// Tool-specific settings (brush width, and radiation radius when a radiator
// wall is selected) live in a right-hand side panel whose content swaps to
// match the currently selected tool, rather than a fixed set of controls in
// the toolbar -- see updateSidePanel.
import { createRenderer, type Renderer } from '../render/renderer';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../sim/worker';
import type { PaletteEntry } from '../sim/species';
import { EMPTY, PhaseCode } from '../sim/grid';
import { getWall, wallList } from '../sim/walls';

const DEFAULT_RADIUS = 2;
const MIN_RADIUS = 1;
const MAX_RADIUS = 12;
const DEFAULT_RADIATION_RADIUS = 3;
const MIN_RADIATION_RADIUS = 1;
const MAX_RADIATION_RADIUS = 15;
const SPEEDS = [0.25, 0.5, 1, 2, 4];

type Tool =
  | { kind: 'paint'; specId: number }
  | { kind: 'erase' }
  | { kind: 'wall'; specId: number }
  | { kind: 'mixer' }
  | { kind: 'grabber' };

const PHASE_LABEL: Record<number, string> = {
  [PhaseCode.Empty]: 'empty',
  [PhaseCode.Solid]: 'solid',
  [PhaseCode.Liquid]: 'liquid',
  [PhaseCode.Gas]: 'gas',
};

export function mountApp(root: HTMLElement): void {
  root.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  root.appendChild(toolbar);

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  root.appendChild(workspace);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  workspace.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.className = 'sim-canvas';
  canvasWrap.appendChild(canvas);

  const inspector = document.createElement('div');
  inspector.className = 'inspector';
  inspector.textContent = 'Hover the canvas to inspect a cell';
  canvasWrap.appendChild(inspector);

  const sidePanel = document.createElement('div');
  sidePanel.className = 'side-panel';
  workspace.appendChild(sidePanel);

  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const send = (message: MainToWorkerMessage): void => worker.postMessage(message);

  let gridWidth = 0;
  let gridHeight = 0;
  let renderer: Renderer | null = null;
  let tool: Tool | null = null;
  let running = true;
  let speed = 1;
  let radius = DEFAULT_RADIUS;
  let radiationRadius = DEFAULT_RADIATION_RADIUS;
  let activeButton: HTMLButtonElement | null = null;
  let isPointerDown = false;
  let isGrabbing = false;

  // Label lookup for the probe: palette species and walls. Reaction
  // products (M5) can mint specIds beyond the initial palette -- the
  // inspector falls back to `spec N` for those (see updateInspector); a
  // real formula lookup would need the main thread to see the worker's
  // InternedPool, which it deliberately doesn't.
  const labelBySpecId = new Map<number, string>();
  for (const wall of wallList()) labelBySpecId.set(wall.specId, wall.label);

  // Latest frame data, kept around purely so the hover inspector can look
  // up a cell locally without a worker round trip.
  let lastSpecId: Uint16Array | null = null;
  let lastPhase: Uint8Array | null = null;
  let lastTempK: Float32Array | null = null;

  function setActive(button: HTMLButtonElement): void {
    activeButton?.classList.remove('active');
    button.classList.add('active');
    activeButton = button;
  }

  function addToolButton(label: string, swatch: string | null, onSelect: () => Tool): void {
    const button = document.createElement('button');
    button.className = 'palette-btn';
    if (swatch) button.style.setProperty('--swatch', swatch);
    button.textContent = label;
    button.onclick = () => {
      tool = onSelect();
      setActive(button);
      updateSidePanel();
    };
    toolbar.appendChild(button);
  }

  function addSeparator(): void {
    const sep = document.createElement('span');
    sep.className = 'toolbar-sep';
    toolbar.appendChild(sep);
  }

  /** The radiatorWatts of the wall material a 'wall' tool paints, or 0 for
   * every non-wall tool -- 0/positive/negative decides whether the side
   * panel shows the radiation-radius setting and which hint text it shows. */
  function toolRadiatorWatts(t: Tool | null): number {
    return t?.kind === 'wall' ? getWall(t.specId).radiatorWatts : 0;
  }

  function toolLabel(t: Tool | null): string {
    if (!t) return 'No tool selected';
    if (t.kind === 'paint' || t.kind === 'wall') return labelBySpecId.get(t.specId) ?? 'Tool';
    if (t.kind === 'erase') return 'Erase';
    if (t.kind === 'mixer') return 'Mixer';
    return 'Grabber';
  }

  function addSliderSetting(
    label: string,
    min: number,
    max: number,
    value: number,
    onChange: (value: number) => void,
  ): void {
    const wrap = document.createElement('div');
    wrap.className = 'setting';
    const labelEl = document.createElement('label');
    labelEl.textContent = `${label}: ${value}`;
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = String(min);
    slider.max = String(max);
    slider.value = String(value);
    slider.oninput = () => {
      const next = Number(slider.value);
      labelEl.textContent = `${label}: ${next}`;
      onChange(next);
    };
    wrap.appendChild(labelEl);
    wrap.appendChild(slider);
    sidePanel.appendChild(wrap);
  }

  /** Rebuilds the side panel to match the currently selected tool: every
   * tool gets a brush-width slider (the radius already used for
   * paint/erase/stir/grab), and a radiator wall tool (heater-glass or
   * cooler-glass) additionally gets the radiation-radius slider that
   * controls how far that material radiates once placed on the grid. */
  function updateSidePanel(): void {
    sidePanel.innerHTML = '';

    const title = document.createElement('h3');
    title.textContent = toolLabel(tool);
    sidePanel.appendChild(title);

    addSliderSetting('Brush width', MIN_RADIUS, MAX_RADIUS, radius, (value) => {
      radius = value;
    });

    const watts = toolRadiatorWatts(tool);
    if (watts !== 0) {
      addSliderSetting('Radiation radius', MIN_RADIATION_RADIUS, MAX_RADIATION_RADIUS, radiationRadius, (value) => {
        radiationRadius = value;
        send({ type: 'setRadiationRadius', radius: value });
      });

      const hint = document.createElement('p');
      hint.className = 'setting-hint';
      hint.textContent =
        watts > 0
          ? 'Placed glass radiates heat into nearby cells every tick.'
          : 'Placed glass radiates cooling into nearby cells every tick.';
      sidePanel.appendChild(hint);
    }
  }

  function buildToolbar(palette: PaletteEntry[]): void {
    for (const entry of palette) {
      labelBySpecId.set(entry.specId, entry.label);
      addToolButton(entry.label, entry.color, () => ({ kind: 'paint', specId: entry.specId }));
    }

    addSeparator();

    for (const wall of wallList()) {
      addToolButton(wall.label, wall.color, () => ({ kind: 'wall', specId: wall.specId }));
    }

    addSeparator();

    addToolButton('Erase', null, () => ({ kind: 'erase' }));
    addToolButton('Mixer', '#c9a8ff', () => ({ kind: 'mixer' }));
    addToolButton('Grabber', '#f2d94e', () => ({ kind: 'grabber' }));

    addSeparator();

    const pauseButton = document.createElement('button');
    pauseButton.className = 'pause-btn';
    pauseButton.textContent = 'Pause';
    pauseButton.onclick = () => {
      running = !running;
      pauseButton.textContent = running ? 'Pause' : 'Resume';
      send({ type: 'setRunning', running });
    };
    toolbar.appendChild(pauseButton);

    const stepButton = document.createElement('button');
    stepButton.className = 'step-btn';
    stepButton.textContent = 'Step';
    stepButton.onclick = () => send({ type: 'step' });
    toolbar.appendChild(stepButton);

    const speedSelect = document.createElement('select');
    speedSelect.className = 'speed-select';
    for (const s of SPEEDS) {
      const option = document.createElement('option');
      option.value = String(s);
      option.textContent = `${s}x`;
      if (s === 1) option.selected = true;
      speedSelect.appendChild(option);
    }
    speedSelect.onchange = () => {
      speed = Number(speedSelect.value);
      send({ type: 'setSpeed', speed });
    };
    toolbar.appendChild(speedSelect);

    const firstElement = toolbar.querySelector<HTMLButtonElement>('.palette-btn');
    if (firstElement && palette[0]) {
      tool = { kind: 'paint', specId: palette[0].specId };
      setActive(firstElement);
    }
    updateSidePanel();
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
        send({ type: 'paint', x, y, radius, specId: tool.specId });
        break;
      case 'wall':
        send({ type: 'paint', x, y, radius, specId: tool.specId });
        break;
      case 'erase':
        send({ type: 'erase', x, y, radius });
        break;
      case 'mixer':
        send({ type: 'stir', x, y, radius });
        break;
      case 'grabber':
        break;
    }
  }

  function updateInspector(x: number, y: number): void {
    if (!lastSpecId || !lastPhase || !lastTempK || !renderer) return;
    if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) return;
    const idx = y * gridWidth + x;
    const specId = lastSpecId[idx] as number;
    if (specId === EMPTY) {
      inspector.textContent = 'empty';
      return;
    }
    const label = labelBySpecId.get(specId) ?? `spec ${specId}`;
    const tempK = lastTempK[idx] as number;
    const phaseCode = lastPhase[idx] as number;
    const phase = PHASE_LABEL[phaseCode] ?? 'unknown';
    inspector.textContent = `${label}  ${tempK.toFixed(1)} K  (${phase})`;
  }

  canvas.addEventListener('pointerdown', (event) => {
    isPointerDown = true;
    const { x, y } = gridCoordsFromEvent(event);
    if (tool?.kind === 'grabber') {
      isGrabbing = true;
      send({ type: 'grabStart', x, y, radius });
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
    inspector.textContent = 'Hover the canvas to inspect a cell';
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
      canvas.width = gridWidth;
      canvas.height = gridHeight;
      renderer = createRenderer(canvas, gridWidth, gridHeight);
      for (const entry of msg.palette) renderer.setColorForSpec(entry.specId, entry.color);
      for (const wall of wallList()) renderer.setColorForSpec(wall.specId, wall.color);
      buildToolbar(msg.palette);
    } else if (msg.type === 'frame') {
      lastSpecId = msg.specId;
      lastPhase = msg.phase;
      lastTempK = msg.tempK;
      renderer?.drawFrame({ specId: msg.specId, phase: msg.phase, tempK: msg.tempK });
    }
  };
}
