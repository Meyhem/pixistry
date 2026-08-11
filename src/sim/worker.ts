// Web Worker: owns the SimGrid and the chemistry pool, runs the tick loop,
// and talks to the main thread over postMessage. No reactions yet (that's
// a later milestone) -- this tick does movement then energy/conduction/
// phase-change, per the design doc's tick order (movement -> heat -> react)
// and M3 scope (energy: conduction, phase change).
import { InternedPool } from '../chem';
import { SimGrid } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf, stepConduction } from './heat';
import { stepMovement } from './movement';
import { mulberry32 } from './rng';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';

export type WorkerToMainMessage =
  | { type: 'ready'; width: number; height: number; palette: PaletteEntry[] }
  | { type: 'frame'; specId: Uint16Array; tick: number };

export type MainToWorkerMessage =
  | { type: 'paint'; x: number; y: number; radius: number; specId: number }
  | { type: 'erase'; x: number; y: number; radius: number }
  | { type: 'setRunning'; running: boolean };

const WIDTH = 160;
const HEIGHT = 100;
const TICK_MS = 1000 / 60;

const pool = new InternedPool();
const palette = buildPalette(pool);
const species = new SpeciesTable(pool);
const grid = new SimGrid(WIDTH, HEIGHT);
const rng = mulberry32(12345);

let tick = 0;
let running = true;

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
  }
};

post({ type: 'ready', width: WIDTH, height: HEIGHT, palette });

setInterval(() => {
  if (running) {
    stepMovement(grid, species, rng, tick++);
    stepConduction(grid, species);
  }
  post({ type: 'frame', specId: grid.specId.slice(), tick }, []);
}, TICK_MS);
