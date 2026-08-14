// Wire types for the main-thread <-> worker postMessage protocol (see
// worker.ts's module comment for the tick order these messages drive).
// Split out of worker.ts so app.ts (the main-thread side) imports its wire
// types from a plain data module instead of reaching into the worker's own
// entry point -- worker.ts re-exports nothing.
import type { FunnelFacing } from './apparatus-shapes';
import type { FlaskFacing } from './flask-shapes';
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
      funnelFillSpecId: Uint16Array;
      funnels: FunnelSnapshot[];
      tubes: TubeSnapshot[];
      sinkMask: Uint8Array;
      /** Indexed by specId (see species-data.ts's SPECIES array) -- how many
       * pixels of each species every sink line on the grid has ever
       * consumed. One global tally, not per-instance (see sink.ts's
       * SinkCounter doc comment). */
      sinkTotals: Uint32Array;
      sinkGrandTotal: number;
      tick: number;
    };

export type MainToWorkerMessage =
  | { type: 'paint'; x: number; y: number; radius: number; specId: number; tempC: number }
  | { type: 'paintRadiator'; x: number; y: number; brushRadius: number; radiationRadius: number; targetTempC: number }
  | { type: 'paintStirrer'; x: number; y: number; radius: number }
  | { type: 'paintFilter'; x: number; y: number; radius: number }
  | { type: 'setFilterSpecies'; species: number[] }
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
  | { type: 'placeFlask'; x: number; y: number; facing: FlaskFacing; sizeScale: number; stirred: boolean }
  | { type: 'paintSinkLine'; x0: number; y0: number; x1: number; y1: number; width: number }
  | { type: 'resetSinkCounts' };
