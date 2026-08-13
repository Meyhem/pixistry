// Web Worker: owns the SimGrid, runs the tick loop, and talks to the main
// thread over postMessage. Tick order follows the design doc's movement ->
// heat -> react. M4 added tools (walls reuse the plain paint/erase messages
// since SpeciesTable branches transparently on wall specIds; the heater/
// cooler radiator tool is painted via a separate paintRadiator message into
// grid.radiatorRadius/grid.radiatorTargetK, a non-physical overlay snapshot
// taken once at paint time -- see radiators.ts; mixer stirs) and time
// controls (single-step, speed multiplier). M5 wires the static
// reaction table into the grid (react.ts) -- this is what makes an ionic
// solid painted next to water actually dissolve into aqueous ions on-grid.
// Pixistry is just pixels of elements and compounds with a temperature
// each -- there is no gas pressure model.
import { EMPTY, SimGrid } from './grid';
import { grabDrop, grabPickUp, type GrabState } from './grabber';
import type { FunnelFacing } from './apparatus-shapes';
import { funnelShapeFor } from './apparatus-shapes';
import {
  celsiusToKelvin,
  energyForTemperature,
  kelvinToCelsius,
  MAX_TEMP_K,
  massOf,
  stepAmbient,
  stepConduction,
  stepRadiators,
  stepRadiativeLoss,
  temperatureOf,
} from './heat';
import {
  moveFunnelInstance,
  placeFunnelInstance,
  rateFromIntervalTicks,
  resetFunnelInstance,
  stepFunnels,
  updateFunnelInstance,
  type FunnelInstance,
} from './funnel';
import { stepMovement } from './movement';
import { stirRegion } from './mixer';
import { stepReactions } from './react';
import { mulberry32 } from './rng';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';
import { stepStirrers } from './stirrer';
import { moveTubeKnee, moveTubeSegment, placeTubeInstance, stepTubes, updateTubeInstance, type TubeInstance } from './tube';
import type { Point } from './tube-shapes';

export interface FunnelSnapshot {
  id: number;
  anchorX: number;
  anchorY: number;
  facing: FunnelFacing;
  specId: number;
  tempC: number;
  ratePerMinute: number;
  total: number | null;
  remaining: number | null;
}

export interface TubeSnapshot {
  id: number;
  points: Point[];
  coneSize: number;
  /** null = accept every species. */
  filter: number[] | null;
}

export type WorkerToMainMessage =
  | { type: 'ready'; width: number; height: number; palette: PaletteEntry[] }
  | {
      type: 'frame';
      specId: Uint16Array;
      phase: Uint8Array;
      tempK: Float32Array;
      radiatorRadius: Uint8Array;
      radiatorTargetK: Float32Array;
      stirrerMask: Uint8Array;
      tubeMask: Uint8Array;
      funnelFillSpecId: Uint16Array;
      funnels: FunnelSnapshot[];
      tubes: TubeSnapshot[];
      tick: number;
    };

export type MainToWorkerMessage =
  | { type: 'paint'; x: number; y: number; radius: number; specId: number; tempC: number }
  | { type: 'paintRadiator'; x: number; y: number; brushRadius: number; radiationRadius: number; targetTempC: number }
  | { type: 'paintStirrer'; x: number; y: number; radius: number }
  | { type: 'erase'; x: number; y: number; radius: number }
  | { type: 'setRunning'; running: boolean }
  | { type: 'step' }
  | { type: 'setSpeed'; speed: number }
  | { type: 'stirStart'; x: number; y: number; radius: number }
  | { type: 'stirMove'; x: number; y: number }
  | { type: 'stirEnd' }
  | { type: 'grabStart'; x: number; y: number; radius: number }
  | { type: 'grabMove'; x: number; y: number }
  | { type: 'grabEnd' }
  | {
      type: 'placeFunnel';
      x: number;
      y: number;
      facing: FunnelFacing;
      specId: number;
      tempC: number;
      ratePerMinute: number;
      total: number | null;
    }
  | { type: 'updateFunnel'; id: number; specId: number; tempC: number; ratePerMinute: number; total: number | null }
  | { type: 'resetFunnel'; id: number }
  | { type: 'moveFunnel'; id: number; x: number; y: number }
  | { type: 'placeTube'; points: Point[]; coneSize: number; filter: number[] | null }
  | { type: 'moveTubeKnee'; id: number; kneeIndex: number; x: number; y: number }
  | { type: 'moveTubeSegment'; id: number; segIndex: number; dx: number; dy: number }
  | { type: 'updateTube'; id: number; coneSize: number; filter: number[] | null };

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

// The grabber tool (see grabber.ts): held cells are pulled out of `grid`
// entirely for the duration of a drag, so they're immune to
// movement/heat/react while held, and overlaid back into the outgoing frame
// purely for display -- see overlayGrabbedCells/postFrame below.
let grabState: GrabState | null = null;

// The mixer tool's active brush stroke (see mixer.ts): while the user holds
// the mixer tool down, stirState tracks the brush's current center/radius
// and runOneTick re-applies a full stirRegion shuffle there every tick --
// not just once per pointer-move event -- so every pixel within the brush
// really is randomized every tick for as long as the stroke lasts. Cleared
// on 'stirEnd' (pointerup).
let stirState: { x: number; y: number; radius: number } | null = null;

// Placed addition-funnels (see funnel.ts) -- unlike walls or the radiator
// overlay, a funnel needs per-instance state (species/rate/remaining budget)
// that isn't representable as a value per grid cell, so it's tracked here as
// a plain array rather than a SimGrid field.
let funnels: FunnelInstance[] = [];

// Placed conveyor-tubes (see tube.ts) -- tracked the same way funnels are,
// for the same reason: knee points/cone size/species filter aren't
// representable as a value per grid cell.
let tubes: TubeInstance[] = [];

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
  stepFunnels(grid, species, funnels);
  stepMovement(grid, species, rng, tick++);
  stepTubes(grid, tubes);
  if (stirState) stirRegion(grid, rng, stirState.x, stirState.y, stirState.radius);
  stepStirrers(grid, rng);
  stepRadiators(grid, species, TICK_DT_SECONDS);
  stepConduction(grid, species);
  // Mutually exclusive per cell by construction (see exposedFaceCount):
  // stepAmbient only touches cells with zero empty neighbors, stepRadiativeLoss
  // only touches cells with at least one.
  stepAmbient(grid, species, TICK_DT_SECONDS);
  stepRadiativeLoss(grid, species, TICK_DT_SECONDS);
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

/** Per-frame decorative reservoir fill: for every funnel with remaining
 * supply, marks its open interior cells (see apparatus-shapes.ts's
 * reservoirCells) with its species -- but only where the grid cell is
 * actually empty, so real matter someone poured/dropped in there still
 * takes precedence over the cosmetic wash. Recomputed fresh every frame
 * rather than stored on SimGrid, since it's purely a rendering hint, not
 * simulated state (see renderer.ts's blend of this array). */
function computeFunnelFill(): Uint16Array {
  const fill = new Uint16Array(grid.width * grid.height).fill(EMPTY);
  for (const instance of funnels) {
    if (instance.remaining === 0) continue;
    const shape = funnelShapeFor(instance.facing);
    for (const cell of shape.reservoirCells) {
      const x = instance.anchorX + cell.dx;
      const y = instance.anchorY + cell.dy;
      if (!grid.inBounds(x, y)) continue;
      const idx = grid.index(x, y);
      if (grid.isEmptyAt(idx)) fill[idx] = instance.specId;
    }
  }
  return fill;
}

function funnelSnapshots(): FunnelSnapshot[] {
  return funnels.map((f) => ({
    id: f.id,
    anchorX: f.anchorX,
    anchorY: f.anchorY,
    facing: f.facing,
    specId: f.specId,
    tempC: kelvinToCelsius(f.tempK),
    ratePerMinute: rateFromIntervalTicks(f.intervalTicks),
    total: f.total,
    remaining: f.remaining,
  }));
}

function tubeSnapshots(): TubeSnapshot[] {
  return tubes.map((t) => ({
    id: t.id,
    points: t.points.map((p) => ({ x: p.x, y: p.y })),
    coneSize: t.coneSize,
    filter: t.filter ? [...t.filter] : null,
  }));
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
  const radiatorRadius = grid.radiatorRadius.slice();
  const radiatorTargetK = grid.radiatorTargetK.slice();
  const stirrerMask = grid.stirrerMask.slice();
  const tubeMask = grid.tubeMask.slice();
  const funnelFillSpecId = computeFunnelFill();
  overlayGrabbedCells(specId, phase, tempK);
  post({
    type: 'frame',
    specId,
    phase,
    tempK,
    radiatorRadius,
    radiatorTargetK,
    stirrerMask,
    tubeMask,
    funnelFillSpecId,
    funnels: funnelSnapshots(),
    tubes: tubeSnapshots(),
    tick,
  });
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case 'paint': {
      const mass = massOf(species, msg.specId);
      const thermal = species.thermalOf(msg.specId);
      const tempK = Math.min(MAX_TEMP_K, Math.max(0, celsiusToKelvin(msg.tempC)));
      const { u, phase } = energyForTemperature(thermal, mass, tempK);
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => grid.set(px, py, msg.specId, phase, u));
      break;
    }
    case 'paintRadiator': {
      const targetK = celsiusToKelvin(msg.targetTempC);
      paintCircle(msg.x, msg.y, msg.brushRadius, (px, py) => {
        const idx = grid.index(px, py);
        grid.radiatorRadius[idx] = msg.radiationRadius;
        grid.radiatorTargetK[idx] = targetK;
      });
      break;
    }
    case 'paintStirrer':
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        grid.stirrerMask[grid.index(px, py)] = 1;
      });
      break;
    case 'erase':
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        grid.clear(px, py);
        grid.radiatorRadius[grid.index(px, py)] = 0;
        grid.stirrerMask[grid.index(px, py)] = 0;
        grid.tubeMask[grid.index(px, py)] = 0;
      });
      // Erasing a funnel's anchor (its spout tip) removes the whole tracked
      // instance, not just whatever glass cells the brush touched -- the
      // only way to delete a placed funnel, since there's no dedicated
      // delete button (see side-panel.ts's Reset-only funnel edit panel).
      funnels = funnels.filter((f) => {
        const dx = f.anchorX - msg.x;
        const dy = f.anchorY - msg.y;
        return dx * dx + dy * dy > msg.radius * msg.radius;
      });
      // Same convention for a tube: erasing any one of its knee points
      // deletes the whole instance (there's no dedicated delete button
      // here either), rather than leaving a stale tracked path behind
      // whenever the eraser only grazes a wall/lumen cell in its middle.
      tubes = tubes.filter((t) => {
        const hitKnee = t.points.some((p) => {
          const dx = p.x - msg.x;
          const dy = p.y - msg.y;
          return dx * dx + dy * dy <= msg.radius * msg.radius;
        });
        return !hitKnee;
      });
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
    case 'stirStart':
      stirState = { x: msg.x, y: msg.y, radius: msg.radius };
      break;
    case 'stirMove':
      if (stirState) {
        stirState.x = msg.x;
        stirState.y = msg.y;
      }
      break;
    case 'stirEnd':
      stirState = null;
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
    case 'placeFunnel':
      funnels.push(
        placeFunnelInstance(grid, {
          x: msg.x,
          y: msg.y,
          facing: msg.facing,
          specId: msg.specId,
          tempC: msg.tempC,
          ratePerMinute: msg.ratePerMinute,
          total: msg.total,
        }),
      );
      break;
    case 'updateFunnel': {
      const instance = funnels.find((f) => f.id === msg.id);
      if (instance) updateFunnelInstance(instance, { specId: msg.specId, tempC: msg.tempC, ratePerMinute: msg.ratePerMinute, total: msg.total });
      break;
    }
    case 'resetFunnel': {
      const instance = funnels.find((f) => f.id === msg.id);
      if (instance) resetFunnelInstance(instance);
      break;
    }
    case 'moveFunnel': {
      const instance = funnels.find((f) => f.id === msg.id);
      if (instance) moveFunnelInstance(grid, instance, msg.x, msg.y);
      break;
    }
    case 'placeTube':
      tubes.push(placeTubeInstance(grid, { points: msg.points, coneSize: msg.coneSize, filter: msg.filter ? new Set(msg.filter) : null }));
      break;
    case 'moveTubeKnee': {
      const instance = tubes.find((t) => t.id === msg.id);
      if (instance) moveTubeKnee(grid, instance, msg.kneeIndex, { x: msg.x, y: msg.y });
      break;
    }
    case 'moveTubeSegment': {
      const instance = tubes.find((t) => t.id === msg.id);
      if (instance) moveTubeSegment(grid, instance, msg.segIndex, msg.dx, msg.dy);
      break;
    }
    case 'updateTube': {
      const instance = tubes.find((t) => t.id === msg.id);
      if (instance) updateTubeInstance(grid, instance, { coneSize: msg.coneSize, filter: msg.filter ? new Set(msg.filter) : null });
      break;
    }
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
