// Minimal M2 UI: a palette toolbar, a paint/erase brush, and a pause
// toggle -- just enough to see the sim work. The full tool set (walls,
// burner, coolant, probe, mixer, inspector) is a later milestone.
import { createRenderer, type Renderer } from '../render/renderer';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../sim/worker';
import type { PaletteEntry } from '../sim/species';

const BRUSH_RADIUS = 2;

export function mountApp(root: HTMLElement): void {
  root.innerHTML = '';

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  root.appendChild(toolbar);

  const canvas = document.createElement('canvas');
  canvas.className = 'sim-canvas';
  root.appendChild(canvas);

  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const send = (message: MainToWorkerMessage): void => worker.postMessage(message);

  let gridWidth = 0;
  let gridHeight = 0;
  let renderer: Renderer | null = null;
  let selected: PaletteEntry | null = null;
  let erasing = false;
  let running = true;
  let activeButton: HTMLButtonElement | null = null;
  let isPointerDown = false;

  function setActive(button: HTMLButtonElement): void {
    activeButton?.classList.remove('active');
    button.classList.add('active');
    activeButton = button;
  }

  function buildToolbar(palette: PaletteEntry[]): void {
    for (const entry of palette) {
      const button = document.createElement('button');
      button.className = 'palette-btn';
      button.style.setProperty('--swatch', entry.color);
      button.textContent = entry.label;
      button.onclick = () => {
        selected = entry;
        erasing = false;
        setActive(button);
      };
      toolbar.appendChild(button);
    }

    const eraseButton = document.createElement('button');
    eraseButton.className = 'palette-btn erase-btn';
    eraseButton.textContent = 'Erase';
    eraseButton.onclick = () => {
      erasing = true;
      selected = null;
      setActive(eraseButton);
    };
    toolbar.appendChild(eraseButton);

    const pauseButton = document.createElement('button');
    pauseButton.className = 'pause-btn';
    pauseButton.textContent = 'Pause';
    pauseButton.onclick = () => {
      running = !running;
      pauseButton.textContent = running ? 'Pause' : 'Resume';
      send({ type: 'setRunning', running });
    };
    toolbar.appendChild(pauseButton);

    const firstElement = toolbar.querySelector<HTMLButtonElement>('.palette-btn');
    if (firstElement && palette[0]) {
      selected = palette[0];
      setActive(firstElement);
    }
  }

  function gridCoordsFromEvent(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * gridWidth);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * gridHeight);
    return { x, y };
  }

  function paintAt(event: PointerEvent): void {
    const { x, y } = gridCoordsFromEvent(event);
    if (erasing) {
      send({ type: 'erase', x, y, radius: BRUSH_RADIUS });
    } else if (selected) {
      send({ type: 'paint', x, y, radius: BRUSH_RADIUS, specId: selected.specId, phase: selected.phase });
    }
  }

  canvas.addEventListener('pointerdown', (event) => {
    isPointerDown = true;
    paintAt(event);
  });
  canvas.addEventListener('pointermove', (event) => {
    if (isPointerDown) paintAt(event);
  });
  window.addEventListener('pointerup', () => {
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
      buildToolbar(msg.palette);
    } else if (msg.type === 'frame') {
      renderer?.drawFrame(msg.specId);
    }
  };
}
