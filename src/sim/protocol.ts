// Wire types for the main-thread <-> worker postMessage protocol (see
// worker.ts's module comment for the tick order these messages drive).
// Split out of worker.ts so app.ts (the main-thread side) imports its wire
// types from a plain data module instead of reaching into the worker's own
// entry point -- worker.ts re-exports nothing.
//
// Apparatus speaks ONE generic vocabulary: place/move/dragHandle/rotate/
// updateSettings/action/delete, each addressing an entity by its global
// `entityId` (see entity-id.ts), with per-kind payloads carried as tagged
// unions (PlaceEntityWire / EntitySettingsWire) rather than per-kind message
// types. This replaced ~20 hand-written per-kind messages whose semantics
// each drifted a little (absolute vs relative moves, endpoint vs knee vs
// segment reshaping); the worker-side dispatch lives in entity.ts's
// ENTITY_DEFS, so adding an apparatus kind extends the payload unions and the
// registry without touching the message set at all.
import type { FunnelFacing } from './apparatus-shapes';
import type { FlaskFacing, FlaskKind } from './flask-shapes';
import type { GoalProgress } from './objectives';
import type { Scenario } from './scenario-data';
import type { PaletteEntry } from './species';
import type { Point } from './tube-shapes';

/** One placed apparatus as the worker reports it every frame -- lean plain
 * data (points + settings), never derived geometry caches. `kind` mirrors the
 * instance discriminant; `entityId` is the one id the whole protocol
 * addresses entities by. */
export interface FunnelWire extends EntityWireBase {
  kind: 'funnel';
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

export interface TubeWire extends EntityWireBase {
  kind: 'tube';
  points: Point[];
  /** null = accept every species. */
  filter: number[] | null;
}

export interface FlaskWire extends EntityWireBase {
  kind: 'flask';
  x: number;
  y: number;
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  flaskKind: FlaskKind;
}

export interface FilterWire extends EntityWireBase {
  kind: 'filter';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** This line's own allow-list; empty blocks everything. */
  species: number[];
}

export interface RadiatorWire extends EntityWireBase {
  kind: 'radiator';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** How far each of this line's cells radiates, and what it drives cells
   * within that reach toward -- this instance's own captured copy of the
   * side panel's sliders (see radiators.ts). */
  radiationRadius: number;
  targetTempC: number;
}

export interface GlassWire extends EntityWireBase {
  kind: 'glass';
  /** The polygon's corners where they currently sit -- already rotated and
   * translated (see glass.ts's glassPoints), so the UI hit-tests and draws
   * handles against these without redoing the math. */
  points: Point[];
  /** 0..7, 45 degrees a step -- the wheel's current position, so the UI can
   * send an absolute rotation rather than a delta. */
  rotation: number;
}

/** A Sink or a Vent: the same line-with-a-width shape twice, since the two
 * kinds differ only in which tally they feed (see sink.ts's portMaskValue). */
export interface SinkWire extends EntityWireBase {
  kind: 'sink';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** 0 = one cell wide (see sink.ts's sinkLineCells). */
  width: number;
}

export interface VentWire extends EntityWireBase {
  kind: 'vent';
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  width: number;
}

/** Fields every kind's wire shape carries. `locked` marks scenario bench
 * furniture the worker refuses to edit (see worker.ts's isLocked), so the UI
 * can show it read-only rather than offering controls that silently do
 * nothing. */
export interface EntityWireBase {
  entityId: number;
  locked?: boolean;
}

export type EntityWire = FunnelWire | TubeWire | FlaskWire | FilterWire | RadiatorWire | GlassWire | SinkWire | VentWire;

export type EntityKind = EntityWire['kind'];

/** The 'placeEntity' message's per-kind payload: everything a fresh instance
 * needs, minus the entityId (the worker assigns that). Settings fields are a
 * snapshot captured at placement time -- moving the tool's sliders afterward
 * never changes an entity already on the bench. */
export type PlaceEntityWire =
  | { kind: 'funnel'; x: number; y: number; facing: FunnelFacing; specId: number; tempC: number; ratePerMinute: number; total: number | null }
  | { kind: 'tube'; points: Point[]; filter: number[] | null }
  | { kind: 'flask'; x: number; y: number; facing: FlaskFacing; sizeScale: number; stirred: boolean; flaskKind: FlaskKind }
  | { kind: 'filter'; x0: number; y0: number; x1: number; y1: number; species: number[] }
  | { kind: 'radiator'; x0: number; y0: number; x1: number; y1: number; radiationRadius: number; targetTempC: number }
  | { kind: 'glass'; points: Point[] }
  | { kind: 'sink'; x0: number; y0: number; x1: number; y1: number; width: number }
  | { kind: 'vent'; x0: number; y0: number; x1: number; y1: number; width: number };

/** The 'updateEntitySettings' payload: one kind's whole settings block, sent
 * complete rather than as a patch (same "settings are a snapshot" convention
 * the per-kind update messages had) so a second quick edit can't clobber the
 * first through frame latency. Geometry never travels here -- that's what
 * moveEntity/dragEntityHandle/rotateEntity are for -- and glass has no
 * settings at all (its rotation goes through rotateEntity). */
export type EntitySettingsWire =
  | { kind: 'funnel'; specId: number; tempC: number; ratePerMinute: number; total: number | null; facing: FunnelFacing }
  | { kind: 'tube'; filter: number[] | null }
  | { kind: 'flask'; facing: FlaskFacing; sizeScale: number; stirred: boolean; flaskKind: FlaskKind }
  | { kind: 'filter'; species: number[] }
  | { kind: 'radiator'; radiationRadius: number; targetTempC: number }
  | { kind: 'sink'; width: number }
  | { kind: 'vent'; width: number };

/** The 'entityAction' verbs -- one-shot operations that aren't settings
 * (nothing to round-trip through a draft): refill a funnel's budget, or
 * switch its dripping on/off. */
export type EntityAction = 'reset' | 'enable' | 'disable';

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
      /** Purely a render hint now (the membrane tint): 1 where a filter
       * entity owns the cell, 0 elsewhere -- derived per frame from
       * grid.entityOwner, since the old per-cell filter-id grid array is
       * gone (movement looks allow-lists up by owner instead; see
       * filter.ts's FilterAllow). */
      filterMask: Uint8Array;
      catalystStrength: Uint8Array;
      funnelFillSpecId: Uint16Array;
      /** Every placed apparatus, all kinds in one list (ascending entityId =
       * placement order = compositor z-order). */
      entities: EntityWire[];
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
      /** Whether the apparatus undo stack has anything to step to, so the
       * UI can grey out its buttons rather than offering a no-op. */
      canUndoEntities: boolean;
      canRedoEntities: boolean;
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
  | { type: 'paintStirrer'; x: number; y: number; radius: number }
  /** Paints a catalyst pad (see grid.ts's catalystStrength). `strength` is
   * the whole-number reaction-rate multiplier; 0 is a no-op rather than an
   * eraser (use 'erase' to remove a pad). */
  | { type: 'paintCatalyst'; x: number; y: number; radius: number; strength: number }
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
  /** Puts a new apparatus on the bench. The worker assigns the entityId and
   * answers with it in the next frame's `entities`; scenario Restrictions
   * gate each kind the same way the old per-kind messages were gated. */
  | { type: 'placeEntity'; entity: PlaceEntityWire }
  /** Slides a whole placed entity by (dx, dy) -- every kind moves this way
   * (a tube's knees all translate together, a funnel's anchor shifts), so
   * the pointer drag and the keyboard nudge are the same message.
   *
   * `undoTag` groups a gesture into one undo entry: the worker checkpoints
   * before a mutation only when the tag differs from the last one it saw, so
   * a drag that sends fifty moves under the same tag rewinds in a single
   * step, while two separate drags (different tags) rewind separately. Every
   * continuous edit carries one; the discrete ops below always checkpoint. */
  | { type: 'moveEntity'; entityId: number; dx: number; dy: number; undoTag?: string }
  /** Drags one of an entity's handles to the absolute cell (x, y) -- a tube
   * knee, either end of a filter/radiator line, or a glass polygon corner
   * (see entity.ts's entityHandles for what each kind exposes and how
   * handleIds are numbered). Absolute rather than a delta so a dropped
   * pointermove can't leave the handle displaced from the cursor. */
  | { type: 'dragEntityHandle'; entityId: number; handleId: number; x: number; y: number; undoTag?: string }
  /** Turns an entity to an absolute rotation step: a glass polygon's 0..7
   * wheel position, or an index into a funnel's/flask's facing cycle
   * (FUNNEL_FACINGS/FLASK_FACINGS). Absolute rather than a delta so a
   * dropped or reordered wheel message can't leave the instance a notch off
   * what the UI is drawing. A no-op for kinds with no rotate capability. */
  | { type: 'rotateEntity'; entityId: number; rotation: number; undoTag?: string }
  /** Replaces one entity's whole settings block (see EntitySettingsWire).
   * Ignored if the payload's kind doesn't match the entity's -- a stale
   * message aimed at a deleted-and-outlived id can't misconfigure whatever
   * kind lives there now (ids are never reused, so this is belt and
   * braces). */
  | { type: 'updateEntitySettings'; entityId: number; settings: EntitySettingsWire; undoTag?: string }
  /** One-shot verbs (see EntityAction) -- currently all funnel: 'reset'
   * refills the budget, 'enable'/'disable' switch dripping. No-ops on kinds
   * without the action. */
  | { type: 'entityAction'; entityId: number; action: EntityAction }
  /** Steps the apparatus undo stack back or forward one entry (see
   * worker.ts's undo bookkeeping). Matter is deliberately NOT covered:
   * rewinding the chemistry is what snapshotWorld/restoreWorld are for, and
   * conflating the two would make an accidental vessel nudge un-undoable
   * without also throwing away a minute of reaction. A no-op at either end
   * of the stack. */
  | { type: 'undoEntities' }
  | { type: 'redoEntities' }
  /** Removes one placed apparatus outright. This is the *only* way to take
   * apparatus off the bench: the eraser is matter-only, since "erase part of
   * a vessel" was a half-state nothing downstream could represent coherently.
   * The UI sends it from the Select tool -- Delete/Backspace, or the edit
   * panel's Delete button. */
  | { type: 'deleteEntity'; entityId: number }
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
