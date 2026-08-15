// Web Worker: owns the SimGrid, runs the tick loop, and talks to the main
// thread over postMessage. Tick order follows the design doc's movement ->
// heat -> react. M4 added tools (walls reuse the plain paint/erase messages
// since SpeciesTable branches transparently on wall specIds; mixer stirs)
// and time controls (single-step, speed multiplier). M5 wires the static
// reaction table into the grid (react.ts) -- this is what makes an ionic
// solid painted next to water actually dissolve into aqueous ions on-grid.
// Pixistry is just pixels of elements and compounds with a temperature
// each -- there is no gas pressure model.
//
// Wire types live in protocol.ts and frame-building in frame.ts (both pure,
// independently testable) -- this module is just the live grid/entity
// state and the tick loop/message dispatch that mutate it.
//
// All apparatus lives in ONE `entities` list and speaks one protocol
// (place/move/dragHandle/rotate/updateSettings/action/delete), dispatched
// through entity.ts's ENTITY_DEFS -- there are no per-kind message handlers
// or per-kind instance arrays here anymore.
import { SimGrid } from './grid';
import { compositeEntities } from './entity-composite';
import {
  applyEntityAction,
  applyEntitySettings,
  dragEntityHandleTo,
  moveEntityBy,
  placeEntityFromWire,
  rotateEntityTo,
  type AnyEntity,
  type EntityKind,
} from './entity';
import { forEachCellInRadius } from './geometry';
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
import { stepFunnels } from './funnel';
import { stepMovement } from './movement';
import { stirRegion } from './mixer';
import { evaluateGoals } from './objectives';
import type { MainToWorkerMessage, WorkerToMainMessage } from './protocol';
import { stepReactions } from './react';
import { mulberry32 } from './rng';
import { applyScenarioSetup, isFunnelSpeciesAllowed, isPaintAllowed, isToolAllowed } from './scenario';
import type { Restrictions, Scenario } from './scenario-data';
import { recordSinkHistory, SinkCounter, stepSinks } from './sink';
import { buildPalette, SpeciesTable } from './species';
import { captureWorldSnapshot, restoreWorldSnapshot, type WorldSnapshot } from './world-snapshot';
import { reseedEntityIds } from './entity-id';
import { EntityHistory } from './entity-history';
import { stepStirrers } from './stirrer';
import { filterAllowMap } from './filter';
import { stepTubes } from './tube';
import { GLASS_WALL_SPEC_ID, isWallSpecId } from './walls';

// The grid's default shape. The column count is fixed -- it sets how coarse
// a cell is relative to the bench's width -- but the row count is a default
// the main thread overrides at startup via 'resizeWorld', picking whatever
// makes cells square in the window it actually has (see app.ts). 100 rows is
// the 16:10-ish shape every campaign scenario's setup coordinates were
// authored against, so scenarios keep it.
const WIDTH = 160;
const DEFAULT_HEIGHT = 100;
// Guard rails for a 'resizeWorld': a very tall or very wide window shouldn't
// be able to ask for a grid that's absurd to simulate or to look at.
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 240;
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
// Rebound (not mutated) by 'resizeWorld' -- every consumer takes the grid as
// an argument rather than capturing it, so swapping in a differently-shaped
// SimGrid is just an assignment here.
let grid = new SimGrid(WIDTH, DEFAULT_HEIGHT);
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

// Everything placed on the bench, all kinds together, in placement order
// (which is also the compositor's z-order, since entityIds ascend). One list
// because per-instance state (a funnel's budget, a tube's knees, a filter's
// allow-list) isn't representable as a value per grid cell -- and one list
// rather than six because every operation on it is now kind-generic.
let entities: AnyEntity[] = [];

// The Sink apparatus's global tally (see sink.ts) -- one counter shared by
// every sink line drawn on the grid, not per-instance. The Vent gets a
// second counter of the same type rather than sharing this one: both ports
// eat matter identically, but a scenario scores collected product and
// dumped waste separately (see grid.ts's SinkMaskValue and objectives.ts's
// 'ventLimit').
const sinkCounter = new SinkCounter();
const ventCounter = new SinkCounter();

// Apparatus undo/redo (see entity-history.ts) -- the bench only, never the
// chemistry.
const history = new EntityHistory();

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

/** The entities of one kind, correctly narrowed -- what the per-tick steps
 * take, since each still operates on its own kind (stepFunnels drips
 * funnels, stepTubes conveys tubes). Filtered fresh at each call because
 * `entities` is rebound, not just mutated, by several handlers. */
function ofKind<K extends EntityKind>(kind: K): Extract<AnyEntity, { kind: K }>[] {
  return entities.filter((e): e is Extract<AnyEntity, { kind: K }> => e.kind === kind);
}

/** Looks a placed entity up by id and runs `fn` on it if found -- the guard
 * every message handler that edits an existing instance goes through. A
 * missing id (the entity was deleted between the UI sending the message and
 * the worker processing it) is silently a no-op. */
function withEntity(entityId: number, fn: (entity: AnyEntity) => void): void {
  const entity = entities.find((e) => e.entityId === entityId);
  if (entity) fn(entity);
}

/** Runs an apparatus placement/move/reshape/delete and re-derives the grid
 * from the entity list afterwards. Every handler that touches an instance
 * goes through this and nothing else writes apparatus state -- see
 * entity-composite.ts for why that single rule replaced the three
 * bookkeeping schemes this used to need. */
function mutateEntities(edit: () => void, undoTag?: string): void {
  history.checkpoint(entities, undoTag);
  edit();
  compositeEntities(grid, species, entities);
}

/** Swaps the live bench for an undo/redo stack frame and re-derives the grid
 * from it. A no-op at either end of the stack. */
function stepEntityHistory(restored: AnyEntity[] | null): void {
  if (!restored) return;
  entities = restored;
  // A restored entity may hold an id at or above where the counter now sits
  // (it was handed out in a world we since discarded and re-made).
  reseedEntityIds(entities.map((e) => e.entityId));
  compositeEntities(grid, species, entities);
}

/** Whether a scenario placed this entity as fixed bench furniture. A locked
 * entity is the level's own apparatus: it can be selected and inspected, but
 * not moved, reshaped, reconfigured or deleted, so a campaign bench can't be
 * dismantled by accident (or on purpose) mid-puzzle. */
function isLocked(entityId: number): boolean {
  return entities.find((e) => e.entityId === entityId)?.locked === true;
}

function runOneTick(): void {
  stepFunnels(grid, species, ofKind('funnel'));
  stepMovement(grid, species, rng, tick++, filterAllowMap(ofKind('filter')));
  stepTubes(grid, ofKind('tube'));
  if (tick % STIR_INTERVAL_TICKS === 0) {
    if (stirState) stirRegion(grid, rng, stirState.x, stirState.y, stirState.radius);
    stepStirrers(grid, rng, ofKind('flask'));
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
  stepSinks(grid, sinkCounter, ventCounter);
  recordSinkHistory(sinkCounter, tick);
}

function postFrame(): void {
  const frame = buildFrame(grid, species, {
    entities,
    grabState,
    sinkCounter,
    ventCounter,
    hasSnapshot: worldSnapshot !== null,
    canUndoEntities: history.canUndo,
    canRedoEntities: history.canRedo,
    tick,
    objectives: [],
  });
  if (activeScenario) {
    for (let i = 0; i < frame.tempK.length; i++) {
      const t = frame.tempK[i] as number;
      if (t > maxTempKObserved) maxTempKObserved = t;
    }
    frame.objectives = evaluateGoals(activeScenario.goals, { totals: sinkCounter.totals, ventTotals: ventCounter.totals, history: sinkCounter.history, tick, maxTempK: maxTempKObserved });
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
    ? evaluateGoals(activeScenario.goals, { totals: sinkCounter.totals, ventTotals: ventCounter.totals, history: sinkCounter.history, tick, maxTempK: maxTempKObserved })
    : [];
  post({ type: 'burstProgress', tick, ticksTotal: burst.ticksTotal, ticksRemaining: burst.ticksRemaining, objectives });

  if (burst.ticksRemaining > 0) {
    setTimeout(runBurstChunk, 0);
  } else {
    burst = null;
    postFrame();
  }
}

/** Whether the active scenario's rules let this placement happen. Every kind
 * except glass maps 1:1 onto a lockable ToolKind; glass is a paintable wall
 * material rather than a tool of its own, so it's gated by the same
 * isPaintAllowed check the free-draw brush goes through. Funnels are
 * additionally gated on the species they'd dispense. */
function isPlacementAllowed(entity: Extract<MainToWorkerMessage, { type: 'placeEntity' }>['entity']): boolean {
  if (entity.kind === 'glass') return isPaintAllowed(activeRestrictions, GLASS_WALL_SPEC_ID);
  if (!isToolAllowed(activeRestrictions, entity.kind)) return false;
  if (entity.kind === 'funnel') return isFunnelSpeciesAllowed(activeRestrictions, entity.specId);
  return true;
}

/** 'resetWorld'/'resizeWorld'/'loadScenario' share this wipe -- everything
 * placed, held, drawn or tallied goes; what varies per caller (scenario
 * state, the snapshot, the grid itself) stays at the call sites. */
function clearBenchState(): void {
  entities = [];
  history.clear();
  sinkCounter.reset();
  ventCounter.reset();
  grabState = null;
  stirState = null;
  tick = 0;
  maxTempKObserved = 0;
}

self.onmessage = (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  // While a burst is in flight, the only message that should reach the live
  // world is the one that can stop it -- see runBurstChunk's doc comment on
  // why nothing else may mutate grid/entities concurrently with its own
  // ticking.
  if (burst && msg.type !== 'cancelBurst') return;
  switch (msg.type) {
    case 'paint': {
      if (!isPaintAllowed(activeRestrictions, msg.specId)) break;
      const mass = massOf(species, msg.specId);
      const thermal = species.thermalOf(msg.specId);
      const tempK = Math.min(MAX_TEMP_K, Math.max(0, celsiusToKelvin(msg.tempC)));
      const { u, phase } = energyForTemperature(thermal, mass, tempK);
      // Matter never overwrites a wall cell: painting a species across a
      // flask, funnel or hand-drawn glass wall used to punch holes straight
      // through it (the brush is a filled circle, so a single click on a
      // vessel wall deleted a chunk of it). Walls are only removable with the
      // eraser now. A wall *tool* still paints over walls -- that's how you
      // swap glass for insulator -- hence the incoming-specId check rather
      // than a blanket skip.
      const paintingWall = isWallSpecId(msg.specId);
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        if (!paintingWall && isWallSpecId(grid.specId[grid.index(px, py)] as number)) return;
        grid.set(px, py, msg.specId, phase, u);
      });
      break;
    }
    case 'paintCatalyst':
      if (!isToolAllowed(activeRestrictions, 'catalyst')) break;
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        grid.catalystStrength[grid.index(px, py)] = msg.strength;
      });
      break;
    case 'paintStirrer':
      if (!isToolAllowed(activeRestrictions, 'stirrer')) break;
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        grid.stirrerMask[grid.index(px, py)] = 1;
      });
      break;
    case 'erase':
      // Matter and painted terrain only. Apparatus is indestructible: it goes
      // away through 'deleteEntity' (the Select tool's Delete) and no
      // other way, which is what makes "a placed vessel can't be
      // half-destroyed" true by construction rather than by six per-kind
      // conventions about which cell of a footprint counts as its anchor.
      if (!isToolAllowed(activeRestrictions, 'erase')) break;
      paintCircle(msg.x, msg.y, msg.radius, (px, py) => {
        const idx = grid.index(px, py);
        // An entity's own glass survives; anything else on the cell doesn't.
        // Cargo riding in a tube's lumen, or a vessel's contents, is matter
        // like any other and erases normally -- only the apparatus itself is
        // protected.
        if (!(grid.entityOwner[idx] !== 0 && isWallSpecId(grid.specId[idx] as number))) grid.clearAt(idx);
        grid.stirrerMask[idx] = 0;
        grid.catalystStrength[idx] = 0;
      });
      break;
    case 'placeEntity':
      if (!isPlacementAllowed(msg.entity)) break;
      mutateEntities(() => {
        const placed = placeEntityFromWire(grid, msg.entity);
        if (placed) entities.push(placed);
      });
      break;
    case 'moveEntity':
      if (isLocked(msg.entityId)) break;
      mutateEntities(() => withEntity(msg.entityId, (entity) => moveEntityBy(grid, entity, msg.dx, msg.dy)), msg.undoTag);
      break;
    case 'dragEntityHandle':
      if (isLocked(msg.entityId)) break;
      mutateEntities(() => withEntity(msg.entityId, (entity) => dragEntityHandleTo(grid, entity, msg.handleId, msg.x, msg.y)), msg.undoTag);
      break;
    case 'rotateEntity':
      if (isLocked(msg.entityId)) break;
      mutateEntities(() => withEntity(msg.entityId, (entity) => rotateEntityTo(entity, msg.rotation)), msg.undoTag);
      break;
    case 'updateEntitySettings':
      // A funnel's dispensed species stays scenario-gated through edits, not
      // just at placement -- otherwise a placed funnel would be a loophole in
      // a scenario's funnelSpecies rule.
      if (msg.settings.kind === 'funnel' && !isFunnelSpeciesAllowed(activeRestrictions, msg.settings.specId)) break;
      if (isLocked(msg.entityId)) break;
      mutateEntities(() => withEntity(msg.entityId, (entity) => applyEntitySettings(entity, msg.settings)), msg.undoTag);
      break;
    case 'entityAction':
      // Actions never change a footprint today (funnel reset/enable/disable),
      // but they go through mutateEntities anyway -- the invariant "every
      // entity edit composites" is cheaper to keep unconditional than to
      // reason about per action verb.
      mutateEntities(() => withEntity(msg.entityId, (entity) => applyEntityAction(entity, msg.action)));
      break;
    case 'deleteEntity':
      if (isLocked(msg.entityId)) break;
      mutateEntities(() => {
        entities = entities.filter((e) => e.entityId !== msg.entityId);
      });
      break;
    case 'undoEntities':
      stepEntityHistory(history.undo(entities));
      break;
    case 'redoEntities':
      stepEntityHistory(history.redo(entities));
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
    case 'resetSinkCounts':
      sinkCounter.reset();
      ventCounter.reset();
      break;
    case 'resizeWorld': {
      // A campaign scenario's setup is authored against the default grid
      // shape (fixed coordinates for its walls/pools/apparatus), so its world
      // is never reshaped underneath it.
      const height = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.round(msg.height)));
      if (activeScenario || height === grid.height) break;
      grid = new SimGrid(WIDTH, height);
      clearBenchState();
      // A snapshot of the old shape can't be restored into the new grid.
      worldSnapshot = null;
      post({ type: 'ready', width: grid.width, height: grid.height, palette });
      break;
    }
    case 'resetWorld':
      grid.clearAll();
      clearBenchState();
      activeScenario = null;
      activeRestrictions = null;
      break;
    case 'loadScenario':
      grid.clearAll();
      clearBenchState();
      activeScenario = msg.scenario;
      activeRestrictions = msg.scenario.rules;
      mutateEntities(() => applyScenarioSetup(grid, species, entities, msg.scenario));
      break;
    case 'snapshotWorld':
      worldSnapshot = captureWorldSnapshot(grid, entities, sinkCounter, ventCounter, tick);
      break;
    case 'restoreWorld': {
      if (!worldSnapshot) break;
      const restored = restoreWorldSnapshot(grid, species, sinkCounter, ventCounter, worldSnapshot);
      entities = restored.entities;
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
      worldSnapshot = captureWorldSnapshot(grid, entities, sinkCounter, ventCounter, tick);
      sinkCounter.reset();
      ventCounter.reset();
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
        const restored = restoreWorldSnapshot(grid, species, sinkCounter, ventCounter, worldSnapshot);
        entities = restored.entities;
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
        ? evaluateGoals(activeScenario.goals, { totals: sinkCounter.totals, ventTotals: ventCounter.totals, history: sinkCounter.history, tick, maxTempK: maxTempKObserved })
        : [];
      post({ type: 'burstProgress', tick, ticksTotal, ticksRemaining: 0, objectives });
      postFrame();
      break;
    }
  }
};

post({ type: 'ready', width: grid.width, height: grid.height, palette });

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
