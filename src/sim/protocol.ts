// Wire types for the main-thread <-> worker postMessage protocol (see
// worker.ts's module comment for the tick order these messages drive).
// Split out of worker.ts so app.ts (the main-thread side) imports its wire
// types from a plain data module instead of reaching into the worker's own
// entry point -- worker.ts re-exports nothing.
import type { FunnelFacing } from './apparatus-shapes';
import type { FlaskFacing, FlaskKind } from './flask-shapes';
import type { SinkMaskValue } from './grid';
import type { GoalProgress } from './objectives';
import type { Scenario } from './scenario-data';
import type { PaletteEntry } from './species';
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
  enabled: boolean;
}

export interface TubeSnapshot {
  id: number;
  points: Point[];
  coneSize: number;
  /** null = accept every species. */
  filter: number[] | null;
}

export interface FilterSnapshot {
  id: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** This line's own allow-list; empty blocks everything. */
  species: number[];
}

export interface FlaskSnapshot {
  id: number;
  x: number;
  y: number;
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  kind: FlaskKind;
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
      filterMask: Uint8Array;
      catalystStrength: Uint8Array;
      funnelFillSpecId: Uint16Array;
      funnels: FunnelSnapshot[];
      tubes: TubeSnapshot[];
      flasks: FlaskSnapshot[];
      filters: FilterSnapshot[];
      sinkMask: Uint8Array;
      /** Indexed by specId (see species-data.ts's SPECIES array) -- how many
       * pixels of each species every sink line on the grid has ever
       * consumed. One global tally, not per-instance (see sink.ts's
       * SinkCounter doc comment). */
      sinkTotals: Uint32Array;
      sinkGrandTotal: number;
      /** Same shape as sinkTotals, but for what the grid's Vent lines have
       * thrown away rather than what its Sink lines collected (see
       * grid.ts's SinkMaskValue). */
      ventTotals: Uint32Array;
      ventGrandTotal: number;
      /** Whether a 'snapshotWorld' has been saved and is available to
       * 'restoreWorld' -- lets the UI grey out its Restore button rather
       * than sending a message the worker would just silently no-op. */
      hasSnapshot: boolean;
      tick: number;
      /** Live pass/fail progress for the active scenario's goals (see
       * objectives.ts's evaluateGoals) -- empty in sandbox mode, where
       * there's no active scenario to score. */
      objectives: GoalProgress[];
    }
  | {
      /** Progress update for an in-flight 'runBurst' fast-forward (see
       * .grill/campaign-mode.md's Phase 5) -- posted once per chunk instead
       * of once per tick, since a burst deliberately skips the normal
       * per-tick 'frame' message. `ticksRemaining === 0` marks the final
       * chunk (the burst is over and normal frames resume next tick); the
       * UI computes pass/fail itself from `objectives` via
       * objective-display.ts's isScenarioWon, the same function real-time
       * play already uses, so a scenario can be won either by playing it
       * out live or by a Run Test proving the built apparatus holds up. */
      type: 'burstProgress';
      tick: number;
      ticksTotal: number;
      ticksRemaining: number;
      objectives: GoalProgress[];
    };

export type MainToWorkerMessage =
  | { type: 'paint'; x: number; y: number; radius: number; specId: number; tempC: number }
  | { type: 'paintRadiator'; x: number; y: number; brushRadius: number; radiationRadius: number; targetTempC: number }
  | { type: 'paintStirrer'; x: number; y: number; radius: number }
  /** Paints a catalyst pad (see grid.ts's catalystStrength). `strength` is
   * the whole-number reaction-rate multiplier; 0 is a no-op rather than an
   * eraser (use 'erase' to remove a pad). */
  | { type: 'paintCatalyst'; x: number; y: number; radius: number; strength: number }
  /** Draws a one-cell-wide filter line from (x0,y0) to (x1,y1) -- a filter
   * is a precise membrane, not a brush splash, so it's a single straight
   * drag with no width of its own (see .filterMask in grid.ts). The line
   * becomes a tracked instance (see filter.ts) carrying `species` as its own
   * allow-list, captured at placement time like a funnel's payload. */
  | { type: 'paintFilterLine'; x0: number; y0: number; x1: number; y1: number; species: number[] }
  /** Replaces one placed filter line's allow-list (the select-apparatus
   * tool's filter edit panel). */
  | { type: 'updateFilter'; id: number; species: number[] }
  /** Slides a placed filter line by (dx, dy), keeping its length and angle
   * -- a membrane is one segment with no knees, so this is its only
   * reshaping. */
  | { type: 'moveFilter'; id: number; dx: number; dy: number }
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
  | { type: 'setFunnelEnabled'; id: number; enabled: boolean }
  | { type: 'moveFunnel'; id: number; x: number; y: number }
  | { type: 'placeTube'; points: Point[]; coneSize: number; filter: number[] | null }
  | { type: 'moveTubeKnee'; id: number; kneeIndex: number; x: number; y: number }
  | { type: 'moveTubeSegment'; id: number; segIndex: number; dx: number; dy: number }
  | { type: 'updateTube'; id: number; coneSize: number; filter: number[] | null }
  | { type: 'placeFlask'; x: number; y: number; facing: FlaskFacing; sizeScale: number; stirred: boolean; kind: FlaskKind }
  /** Re-stamps a placed flask with new settings (see flask.ts's
   * updateFlaskInstance) -- every field is sent together, same
   * "settings are a snapshot, not a patch" convention as updateFunnel. */
  | { type: 'updateFlask'; id: number; facing: FlaskFacing; sizeScale: number; stirred: boolean; kind: FlaskKind }
  | { type: 'moveFlask'; id: number; x: number; y: number }
  /** Stamps a one-cell-wide glass polyline through `points` (each pair of
   * consecutive points joined by a Bresenham line) -- the Glass tool draws
   * vessel walls as a clicked polygon chain, the same interaction as the
   * conveyor tube, rather than as a free-draw brush. */
  | { type: 'placeGlassPolyline'; points: Point[] }
  /** Draws a collection port line -- a Sink or a Vent, which differ only in
   * which tally they feed (see grid.ts's SinkMaskValue). One message for
   * both, since the drawn geometry is identical. */
  | { type: 'paintSinkLine'; x0: number; y0: number; x1: number; y1: number; width: number; port: SinkMaskValue.Sink | SinkMaskValue.Vent }
  /** Zeroes both the sink and the vent tallies. */
  | { type: 'resetSinkCounts' }
  /** Rebuilds the world at a new grid height (the column count is fixed --
   * see worker.ts's WIDTH). Wipes everything exactly like 'resetWorld', since
   * a differently-shaped grid can't carry the old one's contents across, and
   * answers with a fresh 'ready' so the main thread rebuilds its renderer at
   * the new size. Sent once at startup by app.ts to make cells square in the
   * window it actually has; a no-op if the height already matches or a
   * campaign scenario is loaded (whose setup coordinates assume the default
   * shape). */
  | { type: 'resizeWorld'; height: number }
  /** Wipes the whole grid/apparatus/sink state back to a blank sheet -- see
   * grid.ts's clearAll. Distinct from restoreWorld: this has no saved point
   * to go back to, it just starts over. */
  | { type: 'resetWorld' }
  /** Saves the current grid/apparatus/sink state, overwriting any
   * previously saved snapshot -- see world-snapshot.ts. */
  | { type: 'snapshotWorld' }
  /** Copies the last snapshotWorld save back over the live world. A no-op
   * if nothing's been saved yet (see the frame message's hasSnapshot). */
  | { type: 'restoreWorld' }
  /** Clears the grid/apparatus/sink state (same as resetWorld) and stamps a
   * campaign scenario's setup onto it, activating its Restrictions -- see
   * scenario.ts's applyScenarioSetup and worker.ts's 'loadScenario'
   * handler. */
  | { type: 'loadScenario'; scenario: Scenario }
  /** Fast-forwards `ticks` sim ticks without posting per-tick 'frame'
   * messages, in chunks so a 'cancelBurst' can still land between them --
   * see worker.ts's runBurstChunk and .grill/campaign-mode.md's Phase 5.
   * Auto-snapshots the world first (overwriting any existing
   * 'snapshotWorld' save -- see the 'frame' message's hasSnapshot) and
   * resets the sink counters, so a scenario's goals are evaluated against
   * only what the burst itself produces, and a bad result can be undone
   * with 'restoreWorld' at no cost. Ignored if a burst is already running. */
  | { type: 'runBurst'; ticks: number }
  /** Stops an in-flight burst before it reaches its requested tick count and
   * restores the world to exactly how it was right before 'runBurst' ran --
   * an interrupted test is treated the same as a bad one, not a partial
   * result to keep. No-op if no burst is running. */
  | { type: 'cancelBurst' };
