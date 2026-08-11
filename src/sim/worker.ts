// Web Worker: owns the SimGrid and the chemistry pool, runs the tick loop,
// and talks to the main thread over postMessage. No reactions yet (that's
// a later milestone) -- this tick does movement then energy/conduction/
// phase-change, per the design doc's tick order (movement -> heat -> react)
// and M3 scope (energy: conduction, phase change). M4 adds tools (walls
// reuse the plain paint/erase messages since SpeciesTable branches
// transparently on wall specIds; burner/coolant inject watts; mixer stirs)
// and time controls (single-step, speed multiplier).
import { InternedPool } from '../chem';
import { SimGrid } from './grid';
import { AMBIENT_TEMPERATURE_K, applyPointHeatSource, energyForTemperature, massOf, stepConduction, temperatureOf } from './heat';
import { stepMovement } from './movement';
import { stirRegion } from './mixer';
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
  | { type: 'stir'; x: number; y: number; radius: number };

const WIDTH = 160;
const HEIGHT = 100;
const TICK_MS = 1000 / 60;
const TICK_DT_SECONDS = TICK_MS / 1000;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;

const pool = new InternedPool();
const palette = buildPalette(pool);
const species = new SpeciesTable(pool);
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

function postFrame(): void {
  post({
    type: 'frame',
    specId: grid.specId.slice(),
    phase: grid.phase.slice(),
    tempK: computeTempGrid(),
    tick,
  });
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
