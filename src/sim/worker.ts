// Web Worker: owns the SimGrid, runs the tick loop, and talks to the main
// thread over postMessage. Tick order follows the design doc's movement ->
// heat -> react. M4 added tools (walls reuse the plain paint/erase messages
// since SpeciesTable branches transparently on wall specIds; burner/coolant
// inject watts; mixer stirs) and time controls (single-step, speed
// multiplier). M5 wires the static reaction table into the grid (react.ts)
// -- this is what makes an ionic solid painted next to water actually
// dissolve into aqueous ions on-grid. Pixistry is just pixels of elements
// and compounds with a temperature each -- there is no gas pressure model.
import { SimGrid } from './grid';
import { grabDrop, grabPickUp, type GrabState } from './grabber';
import { AMBIENT_TEMPERATURE_K, applyPointHeatSource, energyForTemperature, massOf, stepConduction, temperatureOf } from './heat';
import { stepMovement } from './movement';
import { stirRegion } from './mixer';
import { stepReactions } from './react';
import { mulberry32 } from './rng';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';

export type WorkerToMainMessage =
  | { type: 'ready'; width: number; height: number; palette: PaletteEntry[] }
  | { type: 'frame'; specId: Uint16Array; phase: Uint8Array; tempK: Float32Array; tick: number };

export type MainToWorkerMessage =
  | { type: 'paint'; x: number; y: number; radius: number; specId: number }
  | { type: 'erase'; x: number; y: number; radius: number }
  | { type: 'setRunning'; running: boolean }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'heat'; x: number; y: number; radius: number; watts: number }
  | { type: 'clearHeat' }
  | { type: 'stir'; x: number; y: number; radius: number }
  | { type: 'grabStart'; x: number; y: number; radius: number }
  | { type: 'grabMove'; x: number; y: number }
  | { type: 'grabEnd' };

const WIDTH = 160;
const HEIGHT = 100;
const TICK_MS = 1000 / 60;
const TICK_DT_SECONDS = TICK_MS / 1000;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

const palette = buildPalette();
const species = new SpeciesTable();
const grid = new SimGrid(WIDTH, HEIGHT);
const rng = mulberry32(12345);

let tick = 0;
let running = true;
let speed = 1;
let tickAccumulator = 0;

// Burner/coolant model a persistent point source of power (watts, not a
// target temperature -- see the M4 task notes) while the tool is "armed and
// clicked": set on pointerdown/pointermove, cleared on pointerup, applied
// once per simulated tick (not per real-time callback) so it scales
// correctly with the speed multiplier.
let activeHeatSource: { x: number; y: number; radius: number; watts: number } | null = null;

// The grabber tool (see grabber.ts): held cells are pulled out of `grid`
// entirely for the duration of a drag, so they're immune to
// movement/heat/react while held, and overlaid back into the outgoing frame
// purely for display -- see overlayGrabbedCells/postFrame below.
let grabState: GrabState | null = null;

function post(message: WorkerToMainMessage, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function paintCircle(x: number, y: number, radius: number, apply: (px: number, py: number) => void): void {
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const px = x + dx;
      const py = y + dy;
      if (!grid.inBounds(px, py)) continue;
      apply(px, py);
    }
  }
}

function runOneTick(): void {
  stepMovement(grid, species, rng, tick++);
  if (activeHeatSource) {
    applyPointHeatSource(grid, activeHeatSource.x, activeHeatSource.y, activeHeatSource.radius, activeHeatSource.watts, TICK_DT_SECONDS);
  }
  stepConduction(grid, species);
  stepReactions(grid, species, rng);
}

function computeTempGrid(): Float32Array {
  const temps = new Float32Array(grid.width * grid.height);
  for (let idx = 0; idx < grid.specId.length; idx++) {
    if (grid.isEmptyAt(idx)) continue;
    const specId = grid.specId[idx] as number;
    const mass = massOf(species, specId);
    const { tempK } = temperatureOf(species.thermalOf(specId), mass, grid.u[idx] as number);
    temps[idx] = tempK;
  }
  return temps;
}

function overlayGrabbedCells(specId: Uint16Array, phase: Uint8Array, tempK: Float32Array): void {
  if (!grabState) return;
  for (const cell of grabState.cells) {
    const x = grabState.anchorX + cell.ox;
    const y = grabState.anchorY + cell.oy;
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    const mass = massOf(species, cell.specId);
    const { tempK: cellTempK } = temperatureOf(species.thermalOf(cell.specId), mass, cell.u);
    specId[idx] = cell.specId;
    phase[idx] = cell.phase;
    tempK[idx] = cellTempK;
  }
}

function postFrame(): void {
  const specId = grid.specId.slice();
  const phase = grid.phase.slice();
  const tempK = computeTempGrid();
  overlayGrabbedCells(specId, phase, tempK);
  post({ type: 'frame', specId, phase, tempK, tick });
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'paint': {
      const mass = massOf(species, msg.specId);
      const thermal = species.thermalOf(msg.specId);
      const { u, phase } = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => grid.set(px, py, msg.specId, phase, u));
      break;
    }
    case 'erase':
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => grid.clear(px, py));
      break;
    case 'setRunning':
      running = msg.running;
      break;
    case 'step':
      runOneTick();
      postFrame();
      break;
    case 'setSpeed':
      speed = Math.max(MIN_SPEED, Math.min(MAX_SPEED, msg.speed));
      break;
    case 'heat':
      activeHeatSource = { x: msg.x, y: msg.y, radius: msg.radius, watts: msg.watts };
      break;
    case 'clearHeat':
      activeHeatSource = null;
      break;
    case 'stir':
      stirRegion(grid, rng, msg.x, msg.y, msg.radius);
      break;
    case 'grabStart':
      grabState = grabPickUp(grid, msg.x, msg.y, msg.radius);
      break;
    case 'grabMove':
      if (grabState) {
        grabState.anchorX = msg.x;
        grabState.anchorY = msg.y;
      }
      break;
    case 'grabEnd':
      if (grabState) {
        grabDrop(grid, grabState);
        grabState = null;
      }
      break;
  }
};

post({ type: 'ready', width: WIDTH, height: HEIGHT, palette });

setInterval(() => {
  if (running) {
    tickAccumulator += speed;
    while (tickAccumulator >= 1) {
      runOneTick();
      tickAccumulator -= 1;
    }
  }
  postFrame();
}, TICK_MS);
