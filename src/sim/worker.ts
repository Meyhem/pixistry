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
//
// Wire types live in protocol.ts and frame-building in frame.ts (both pure,
// independently testable) -- this module is just the live grid/instance
// state and the tick loop/message dispatch that mutate it.
import { SimGrid } from './grid';
import { forEachCellInRadius, withinRadius } from './geometry';
import { grabDrop, grabPickUp, type GrabState } from './grabber';
import { buildFrame } from './frame';
import {
  celsiusToKelvin,
  energyForTemperature,
  MAX_TEMP_K,
  massOf,
  scanMaxTempK,
  stepAmbient,
  stepConduction,
  stepRadiators,
  stepRadiativeLoss,
} from './heat';
import {
  moveFunnelInstance,
  placeFunnelInstance,
  resetFunnelInstance,
  setFunnelEnabledInstance,
  stepFunnels,
  updateFunnelInstance,
  type FunnelInstance,
} from './funnel';
import { stepMovement } from './movement';
import { stirRegion } from './mixer';
import { evaluateGoals } from './objectives';
import type { MainToWorkerMessage, WorkerToMainMessage } from './protocol';
import { stepReactions } from './react';
import { mulberry32 } from './rng';
import { applyScenarioSetup, isFunnelSpeciesAllowed, isPaintAllowed, isToolAllowed } from './scenario';
import type { Restrictions, Scenario } from './scenario-data';
import { recordSinkHistory, SinkCounter, sinkLineCells, stepSinks } from './sink';
import { buildPalette, SpeciesTable } from './species';
import { captureWorldSnapshot, restoreWorldSnapshot, type WorldSnapshot } from './world-snapshot';
import { stepStirrers } from './stirrer';
import { moveTubeKnee, moveTubeSegment, placeTubeInstance, stepTubes, updateTubeInstance, type TubeInstance } from './tube';
import { flaskShapeFor } from './flask-shapes';
import { stampGlass } from './apparatus';

const WIDTH = 160;
const HEIGHT = 100;
const TICK_MS = 1000 / 60;
const TICK_DT_SECONDS = TICK_MS / 1000;
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
// Stirring used to re-shuffle every single sim tick (60/sec), which visually
// read as noisy flicker rather than agitation. Throttled to a fixed cadence
// in sim-time instead of wall-clock time (tick count, not setInterval count)
// so it stays consistent regardless of the speed multiplier's ticks-per-frame.
const STIR_INTERVAL_TICKS = Math.round(0.25 / TICK_DT_SECONDS);
// Run Test (see .grill/campaign-mode.md's Phase 5): a burst runs this many
// ticks per macrotask before yielding, so a 'cancelBurst' message sitting in
// the event queue behind it still gets a chance to land between chunks
// instead of only after the whole burst finishes.
const BURST_CHUNK_TICKS = 200;

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
// purely for display -- see frame.ts's overlayGrabbedCells.
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

// Filter apparatus's global species allow-list (see grid.ts's filterMask):
// unlike the tube's per-instance filter, every drawn filter line shares this
// one Set -- empty means "blocks everything", the opposite default from the
// tube's null-means-accept-all, since an unconfigured Filter should read as
// "just drew an impermeable line" rather than a no-op. Passed into
// stepMovement every tick (see runOneTick).
let filterAllowSpecies = new Set<number>();

// The Sink apparatus's global tally (see sink.ts) -- one counter shared by
// every sink line drawn on the grid, not per-instance.
const sinkCounter = new SinkCounter();

// Manual quicksave (see world-snapshot.ts) -- null until the first
// 'snapshotWorld' message; 'restoreWorld' is a no-op until then (see the
// frame message's hasSnapshot, which lets the UI grey out its Restore
// button instead of sending a message that would silently do nothing).
let worldSnapshot: WorldSnapshot | null = null;

// Run Test fast-forward state (see .grill/campaign-mode.md's Phase 5) --
// null when no burst is in flight. While bursting, the normal setInterval
// tick loop and every message but 'cancelBurst' are suppressed (see
// self.onmessage and the setInterval callback below), so the live grid isn't
// mutated by anything other than runBurstChunk's own ticking until the burst
// ends or is cancelled.
let burst: { ticksTotal: number; ticksRemaining: number } | null = null;

// The active campaign scenario, if any (see scenario-data.ts/scenario.ts) --
// null in sandbox mode. activeRestrictions mirrors activeScenario.rules
// whenever a scenario is loaded; every message handler that creates matter
// or activates a tool checks it via scenario.ts's isPaintAllowed/
// isFunnelSpeciesAllowed/isToolAllowed, so a scenario's rules can't be
// bypassed by a UI bug or a devtools postMessage call.
let activeScenario: Scenario | null = null;
let activeRestrictions: Restrictions | null = null;
// Highest cell temperature (K) seen anywhere on the grid since the active
// scenario was loaded -- a running max (see objectives.ts's GoalSnapshot
// doc comment on why 'maxTempK' goals latch rather than reading
// instantaneous temperature). Updated every postFrame from the temp grid
// buildFrame already computes for rendering, so this is free.
let maxTempKObserved = 0;

function post(message: WorkerToMainMessage, transfer: Transferable[] = []): void {
  (self as unknown as Worker).postMessage(message, transfer);
}

function paintCircle(x: number, y: number, radius: number, apply: (px: number, py: number) => void): void {
  forEachCellInRadius(grid, x, y, radius, apply);
}

/** Looks up a placed funnel/tube by id and runs `fn` on it if found -- shared
 * guard for every message handler below that edits or moves an existing
 * instance, replacing what used to be a hand-written `find` + `if` at each
 * one. A missing id (the instance was erased between the UI sending the
 * message and the worker processing it) is silently a no-op, same as before. */
function withFunnel(id: number, fn: (instance: FunnelInstance) => void): void {
  const instance = funnels.find((f) => f.id === id);
  if (instance) fn(instance);
}

function withTube(id: number, fn: (instance: TubeInstance) => void): void {
  const instance = tubes.find((t) => t.id === id);
  if (instance) fn(instance);
}

function runOneTick(): void {
  stepFunnels(grid, species, funnels);
  stepMovement(grid, species, rng, tick++, filterAllowSpecies);
  stepTubes(grid, tubes);
  if (tick % STIR_INTERVAL_TICKS === 0) {
    if (stirState) stirRegion(grid, rng, stirState.x, stirState.y, stirState.radius);
    stepStirrers(grid, rng);
  }
  stepRadiators(grid, species, TICK_DT_SECONDS);
  stepConduction(grid, species);
  // Mutually exclusive per cell by construction (see exposedFaceCount):
  // stepAmbient only touches cells with zero empty neighbors, stepRadiativeLoss
  // only touches cells with at least one.
  stepAmbient(grid, species, TICK_DT_SECONDS);
  stepRadiativeLoss(grid, species, TICK_DT_SECONDS);
  stepReactions(grid, species, rng);
  // Last in the tick, after reactions: a sink is a collection port, so it
  // counts (and consumes) whatever's really present at the end of the tick
  // -- see sink.ts's stepSinks doc comment.
  stepSinks(grid, sinkCounter);
  recordSinkHistory(sinkCounter, tick);
}

function postFrame(): void {
  const frame = buildFrame(grid, species, { funnels, tubes, grabState, sinkCounter, hasSnapshot: worldSnapshot !== null, tick, objectives: [] });
  if (activeScenario) {
    for (let i = 0; i < frame.tempK.length; i++) {
      const t = frame.tempK[i] as number;
      if (t > maxTempKObserved) maxTempKObserved = t;
    }
    frame.objectives = evaluateGoals(activeScenario.goals, { totals: sinkCounter.totals, history: sinkCounter.history, tick, maxTempK: maxTempKObserved });
  }
  post(frame);
}

/** Runs one BURST_CHUNK_TICKS-sized slice of an in-flight Run Test, posts a
 * 'burstProgress' update, and either schedules the next slice (via
 * setTimeout, so a queued 'cancelBurst' gets processed between chunks) or
 * -- once ticksRemaining hits 0 -- ends the burst and resumes normal framed
 * ticking. Guarded on `burst` still being set at the top so a chunk already
 * scheduled before a cancel lands is a no-op instead of ticking a world
 * cancelBurst just restored. */
function runBurstChunk(): void {
  if (!burst) return;
  const chunk = Math.min(BURST_CHUNK_TICKS, burst.ticksRemaining);
  for (let i = 0; i < chunk; i++) runOneTick();
  burst.ticksRemaining -= chunk;

  if (activeScenario) {
    const observed = scanMaxTempK(grid, species);
    if (observed > maxTempKObserved) maxTempKObserved = observed;
  }
  const objectives = activeScenario
    ? evaluateGoals(activeScenario.goals, { totals: sinkCounter.totals, history: sinkCounter.history, tick, maxTempK: maxTempKObserved })
    : [];
  post({ type: 'burstProgress', tick, ticksTotal: burst.ticksTotal, ticksRemaining: burst.ticksRemaining, objectives });

  if (burst.ticksRemaining > 0) {
    setTimeout(runBurstChunk, 0);
  } else {
    burst = null;
    postFrame();
  }
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  // While a burst is in flight, the only message that should reach the live
  // world is the one that can stop it -- see runBurstChunk's doc comment on
  // why nothing else may mutate grid/funnels/tubes/etc concurrently with its
  // own ticking.
  if (burst && msg.type !== 'cancelBurst') return;
  switch (msg.type) {
    case 'paint': {
      if (!isPaintAllowed(activeRestrictions, msg.specId)) break;
      const mass = massOf(species, msg.specId);
      const thermal = species.thermalOf(msg.specId);
      const tempK = Math.min(MAX_TEMP_K, Math.max(0, celsiusToKelvin(msg.tempC)));
      const { u, phase } = energyForTemperature(thermal, mass, tempK);
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => grid.set(px, py, msg.specId, phase, u));
      break;
    }
    case 'paintRadiator': {
      if (!isToolAllowed(activeRestrictions, 'radiator')) break;
      const targetK = celsiusToKelvin(msg.targetTempC);
      paintCircle(msg.x, msg.y, msg.brushRadius, (px, py) => {
        const idx = grid.index(px, py);
        grid.radiatorRadius[idx] = msg.radiationRadius;
        grid.radiatorTargetK[idx] = targetK;
      });
      break;
    }
    case 'paintStirrer':
      if (!isToolAllowed(activeRestrictions, 'stirrer')) break;
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        grid.stirrerMask[grid.index(px, py)] = 1;
      });
      break;
    case 'paintFilter':
      if (!isToolAllowed(activeRestrictions, 'filter')) break;
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        grid.filterMask[grid.index(px, py)] = 1;
      });
      break;
    case 'setFilterSpecies':
      filterAllowSpecies = new Set(msg.species);
      break;
    case 'erase':
      if (!isToolAllowed(activeRestrictions, 'erase')) break;
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        grid.clear(px, py);
        grid.radiatorRadius[grid.index(px, py)] = 0;
        grid.stirrerMask[grid.index(px, py)] = 0;
        grid.tubeMask[grid.index(px, py)] = 0;
        grid.filterMask[grid.index(px, py)] = 0;
        grid.vesselMask[grid.index(px, py)] = 0;
        grid.sinkMask[grid.index(px, py)] = 0;
      });
      // Erasing a funnel's anchor (its spout tip) removes the whole tracked
      // instance, not just whatever glass cells the brush touched -- the
      // only way to delete a placed funnel, since there's no dedicated
      // delete button (see side-panel.ts's Reset-only funnel edit panel).
      funnels = funnels.filter((f) => !withinRadius(msg.x, msg.y, f.anchorX, f.anchorY, msg.radius));
      // Same convention for a tube: erasing any one of its knee points
      // deletes the whole instance (there's no dedicated delete button
      // here either), rather than leaving a stale tracked path behind
      // whenever the eraser only grazes a wall/lumen cell in its middle.
      tubes = tubes.filter((t) => !t.points.some((p) => withinRadius(msg.x, msg.y, p.x, p.y, msg.radius)));
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
      if (!isToolAllowed(activeRestrictions, 'mixer')) break;
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
      if (!isToolAllowed(activeRestrictions, 'grabber')) break;
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
      if (!isToolAllowed(activeRestrictions, 'funnel') || !isFunnelSpeciesAllowed(activeRestrictions, msg.specId)) break;
      funnels.push(
        placeFunnelInstance(grid, species, {
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
    case 'updateFunnel':
      if (!isFunnelSpeciesAllowed(activeRestrictions, msg.specId)) break;
      withFunnel(msg.id, (instance) =>
        updateFunnelInstance(instance, { specId: msg.specId, tempC: msg.tempC, ratePerMinute: msg.ratePerMinute, total: msg.total }),
      );
      break;
    case 'resetFunnel':
      withFunnel(msg.id, resetFunnelInstance);
      break;
    case 'setFunnelEnabled':
      withFunnel(msg.id, (instance) => setFunnelEnabledInstance(instance, msg.enabled));
      break;
    case 'moveFunnel':
      withFunnel(msg.id, (instance) => moveFunnelInstance(grid, species, instance, msg.x, msg.y));
      break;
    case 'placeTube':
      if (!isToolAllowed(activeRestrictions, 'tube')) break;
      tubes.push(
        placeTubeInstance(grid, species, { points: msg.points, coneSize: msg.coneSize, filter: msg.filter ? new Set(msg.filter) : null }),
      );
      break;
    case 'moveTubeKnee':
      withTube(msg.id, (instance) => moveTubeKnee(grid, species, instance, msg.kneeIndex, { x: msg.x, y: msg.y }));
      break;
    case 'moveTubeSegment':
      withTube(msg.id, (instance) => moveTubeSegment(grid, species, instance, msg.segIndex, msg.dx, msg.dy));
      break;
    case 'updateTube':
      withTube(msg.id, (instance) => updateTubeInstance(grid, species, instance, { coneSize: msg.coneSize, filter: msg.filter ? new Set(msg.filter) : null }));
      break;
    case 'placeFlask': {
      if (!isToolAllowed(activeRestrictions, 'flask')) break;
      // A placed flask isn't tracked state like a funnel/tube -- it's a
      // one-shot stamp (real glass walls, plus stirrerMask for the stirred
      // variant), same as painting a wall material. No instance array, no
      // per-tick step function.
      const shape = flaskShapeFor(msg.facing, msg.sizeScale);
      stampGlass(
        grid,
        species,
        shape.cells.map((cell) => ({ x: msg.x + cell.dx, y: msg.y + cell.dy })),
      );
      // vesselMask marks every flask's interior (not just the stirred
      // variant's stirrerMask) -- see grid.ts's doc comment and
      // movement.ts's tryDiagonal, which uses it to stop matter from
      // hopping diagonally through the glass instead of the mouth.
      for (const cell of shape.reservoirCells) {
        const x = msg.x + cell.dx;
        const y = msg.y + cell.dy;
        if (!grid.inBounds(x, y)) continue;
        const idx = grid.index(x, y);
        grid.vesselMask[idx] = 1;
        if (msg.stirred) grid.stirrerMask[idx] = 1;
      }
      break;
    }
    case 'paintSinkLine':
      if (!isToolAllowed(activeRestrictions, 'sink')) break;
      for (const { x, y } of sinkLineCells(msg.x0, msg.y0, msg.x1, msg.y1, msg.width)) {
        if (grid.inBounds(x, y)) grid.sinkMask[grid.index(x, y)] = 1;
      }
      break;
    case 'resetSinkCounts':
      sinkCounter.reset();
      break;
    case 'resetWorld':
      grid.clearAll();
      funnels = [];
      tubes = [];
      sinkCounter.reset();
      filterAllowSpecies = new Set();
      grabState = null;
      stirState = null;
      tick = 0;
      activeScenario = null;
      activeRestrictions = null;
      maxTempKObserved = 0;
      break;
    case 'loadScenario':
      grid.clearAll();
      funnels = [];
      tubes = [];
      sinkCounter.reset();
      filterAllowSpecies = new Set();
      grabState = null;
      stirState = null;
      tick = 0;
      maxTempKObserved = 0;
      activeScenario = msg.scenario;
      activeRestrictions = msg.scenario.rules;
      applyScenarioSetup(grid, species, msg.scenario);
      break;
    case 'snapshotWorld':
      worldSnapshot = captureWorldSnapshot(grid, funnels, tubes, sinkCounter, tick);
      break;
    case 'restoreWorld': {
      if (!worldSnapshot) break;
      const restored = restoreWorldSnapshot(grid, sinkCounter, worldSnapshot);
      funnels = restored.funnels;
      tubes = restored.tubes;
      tick = restored.tick;
      // A restore is also a fresh start for anything mid-drag -- a held
      // grab/stir brush referencing cells that may no longer be what it
      // last saw would otherwise misbehave on the very next tick.
      grabState = null;
      stirState = null;
      break;
    }
    case 'runBurst': {
      if (burst) break;
      worldSnapshot = captureWorldSnapshot(grid, funnels, tubes, sinkCounter, tick);
      sinkCounter.reset();
      burst = { ticksTotal: msg.ticks, ticksRemaining: msg.ticks };
      runBurstChunk();
      break;
    }
    case 'cancelBurst': {
      if (!burst) break;
      const ticksTotal = burst.ticksTotal;
      burst = null;
      // Cancelling is treated the same as a bad result: unwind straight back
      // to the pre-burst snapshot 'runBurst' just took, same as the UI's own
      // explicit 'restoreWorld', rather than leaving a half-finished test's
      // world state live.
      if (worldSnapshot) {
        const restored = restoreWorldSnapshot(grid, sinkCounter, worldSnapshot);
        funnels = restored.funnels;
        tubes = restored.tubes;
        tick = restored.tick;
        grabState = null;
        stirState = null;
      }
      // A final 'burstProgress' with ticksRemaining 0 -- same shape
      // runBurstChunk's own completion posts -- is what tells the main
      // thread the burst is over so it clears its local `bursting` state
      // (un-dims the canvas, re-enables the Run Test button). Without this,
      // a cancelled burst never gets that signal, since cancelling skips
      // runBurstChunk's normal completion path entirely.
      const objectives = activeScenario
        ? evaluateGoals(activeScenario.goals, { totals: sinkCounter.totals, history: sinkCounter.history, tick, maxTempK: maxTempKObserved })
        : [];
      post({ type: 'burstProgress', tick, ticksTotal, ticksRemaining: 0, objectives });
      postFrame();
      break;
    }
  }
};

post({ type: 'ready', width: WIDTH, height: HEIGHT, palette });

setInterval(() => {
  // A Run Test burst drives its own ticking (via runBurstChunk's setTimeout
  // chain) and deliberately posts no per-tick frames -- see .grill/
  // campaign-mode.md's Phase 5. Skip both halves of the normal loop while
  // one is in flight so ticks aren't applied twice and no stale frame
  // overwrites the "running test" state client-side.
  if (burst) return;
  if (running) {
    tickAccumulator += speed;
    while (tickAccumulator >= 1) {
      runOneTick();
      tickAccumulator -= 1;
    }
  }
  postFrame();
}, TICK_MS);
