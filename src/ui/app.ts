// M4 UI: the full v1 tool set (paint, erase, wall materials, burner,
// coolant, probe, mixer) plus time controls (pause, single-step, speed
// multiplier) and a hover inspector -- all plain DOM per the design doc's
// "src/ui plain DOM/React panels", no framework.
import { createRenderer, type Renderer } from '../render/renderer';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../sim/worker';
import type { PaletteEntry } from '../sim/species';
import { EMPTY, PhaseCode } from '../sim/grid';
import { wallList } from '../sim/walls';

const BRUSH_RADIUS = 2;
const BURNER_WATTS = 400;
const COOLANT_WATTS = -400;
const MIXER_RADIUS = 3;
const SPEEDS = [0.25, 0.5, 1, 2, 4];

type Tool =
  | { kind: 'paint'; specId: number }
  | { kind: 'erase' }
  | { kind: 'wall'; specId: number }
  | { kind: 'burner' }
  | { kind: 'coolant' }
  | { kind: 'mixer' };

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

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  root.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.className = 'sim-canvas';
  canvasWrap.appendChild(canvas);

  const inspector = document.createElement('div');
  inspector.className = 'inspector';
  inspector.textContent = 'Hover the canvas to inspect a cell';
  canvasWrap.appendChild(inspector);

  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const send = (message: MainToWorkerMessage): void => worker.postMessage(message);

  let gridWidth = 0;
  let gridHeight = 0;
  let renderer: Renderer | null = null;
  let tool: Tool | null = null;
  let running = true;
  let speed = 1;
  let activeButton: HTMLButtonElement | null = null;
  let isPointerDown = false;

  // Label lookup for the probe: real species come from the palette (the
  // full v1 tool set has no reactions wired in yet, so every specId that
  // can ever appear on the grid is one of these), walls from the fixed
  // wall table.
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
    };
    toolbar.appendChild(button);
  }

  function addSeparator(): void {
    const sep = document.createElement('span');
    sep.className = 'toolbar-sep';
    toolbar.appendChild(sep);
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
    addToolButton('Burner', '#ff7a3c', () => ({ kind: 'burner' }));
    addToolButton('Coolant', '#3ca7ff', () => ({ kind: 'coolant' }));
    addToolButton('Mixer', '#c9a8ff', () => ({ kind: 'mixer' }));

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
        send({ type: 'paint', x, y, radius: BRUSH_RADIUS, specId: tool.specId });
        break;
      case 'wall':
        send({ type: 'paint', x, y, radius: BRUSH_RADIUS, specId: tool.specId });
        break;
      case 'erase':
        send({ type: 'erase', x, y, radius: BRUSH_RADIUS });
        break;
      case 'burner':
        send({ type: 'heat', x, y, radius: BRUSH_RADIUS, watts: BURNER_WATTS });
        break;
      case 'coolant':
        send({ type: 'heat', x, y, radius: BRUSH_RADIUS, watts: COOLANT_WATTS });
        break;
      case 'mixer':
        send({ type: 'stir', x, y, radius: MIXER_RADIUS });
        break;
    }
  }

  function releaseTool(): void {
    if (tool && (tool.kind === 'burner' || tool.kind === 'coolant')) {
      send({ type: 'clearHeat' });
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
    const phase = PHASE_LABEL[lastPhase[idx] as number] ?? 'unknown';
    inspector.textContent = `${label}  ${tempK.toFixed(1)} K  (${phase})`;
  }

  canvas.addEventListener('pointerdown', (event) => {
    isPointerDown = true;
    const { x, y } = gridCoordsFromEvent(event);
    applyTool(x, y);
  });
  canvas.addEventListener('pointermove', (event) => {
    const { x, y } = gridCoordsFromEvent(event);
    if (isPointerDown) applyTool(x, y);
    updateInspector(x, y);
  });
  canvas.addEventListener('pointerleave', () => {
    inspector.textContent = 'Hover the canvas to inspect a cell';
  });
  window.addEventListener('pointerup', () => {
    if (isPointerDown) releaseTool();
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
      renderer?.drawFrame(msg.specId);
    }
  };
}
