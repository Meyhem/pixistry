// Dev-only debug hook for inspecting/driving the sim from outside the UI
// (browser devtools console, or an automated tool poking window.__pixistry)
// -- exposes the same paint/erase/setRunning/step messages the toolbar
// sends, plus read-only access to the latest frame the renderer already
// keeps around for the hover inspector. Not part of the app's real API,
// never imported by app code -- purely a debugging aid, referenced by the
// pixistry-debug skill, so window.__pixistry's own shape must stay
// identical even though this moved out of app.ts.
import { EMPTY, PhaseCode } from '../sim/grid';
import { kelvinToCelsius } from '../sim/heat';
import type { MainToWorkerMessage } from '../sim/protocol';
import type { PaletteEntry } from '../sim/species';

const PHASE_LABEL: Record<number, string> = {
  [PhaseCode.Empty]: 'empty',
  [PhaseCode.Solid]: 'solid',
  [PhaseCode.Liquid]: 'liquid',
  [PhaseCode.Gas]: 'gas',
};

/** Snapshot of app.ts's mutable state the hook reads -- computed fresh on
 * every call rather than captured once, so a call made long after mount
 * still sees the latest frame/running/speed. */
export interface DebugHookState {
  running: boolean;
  speed: number;
  tick: number;
  gridWidth: number;
  gridHeight: number;
  specId: Uint16Array | null;
  phase: Uint8Array | null;
  tempK: Float32Array | null;
  radiatorRadius: Uint8Array | null;
  radiatorTargetK: Float32Array | null;
  brushTempC: number;
  palette: readonly PaletteEntry[];
}

export interface DebugHookDeps {
  send(message: MainToWorkerMessage): void;
  render(): void;
  getState(): DebugHookState;
  setRunning(running: boolean): void;
  setSpeed(speed: number): void;
  labelOf(specId: number): string | undefined;
}

export function installDebugHook(deps: DebugHookDeps): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as { __pixistry: unknown }).__pixistry = {
    pause: () => {
      deps.setRunning(false);
      deps.send({ type: 'setRunning', running: false });
      deps.render();
    },
    resume: () => {
      deps.setRunning(true);
      deps.send({ type: 'setRunning', running: true });
      deps.render();
    },
    step: () => deps.send({ type: 'step' }),
    setSpeed: (value: number) => {
      deps.setSpeed(value);
      deps.send({ type: 'setSpeed', speed: value });
      deps.render();
    },
    isRunning: () => deps.getState().running,
    getTick: () => deps.getState().tick,
    size: () => {
      const { gridWidth: width, gridHeight: height } = deps.getState();
      return { width, height };
    },
    getCell: (x: number, y: number) => {
      const s = deps.getState();
      if (!s.specId || !s.phase || !s.tempK || x < 0 || y < 0 || x >= s.gridWidth || y >= s.gridHeight) return null;
      const idx = y * s.gridWidth + x;
      const specId = s.specId[idx] ?? EMPTY;
      const tempK = s.tempK[idx] ?? 0;
      const phaseCode = s.phase[idx] ?? PhaseCode.Empty;
      return {
        x,
        y,
        specId,
        label: specId === EMPTY ? null : (deps.labelOf(specId) ?? null),
        tempK,
        tempC: kelvinToCelsius(tempK),
        phase: PHASE_LABEL[phaseCode] ?? 'unknown',
        radiatorRadius: s.radiatorRadius?.[idx] ?? 0,
        radiatorTargetK: s.radiatorTargetK?.[idx] ?? 0,
      };
    },
    dumpGrid: () => {
      const s = deps.getState();
      if (!s.specId || !s.phase || !s.tempK) return null;
      return {
        width: s.gridWidth,
        height: s.gridHeight,
        tick: s.tick,
        specId: Array.from(s.specId),
        phase: Array.from(s.phase, (p) => PHASE_LABEL[p] ?? 'unknown'),
        tempC: Array.from(s.tempK, kelvinToCelsius),
      };
    },
    findSpecId: (label: string) => deps.getState().palette.find((entry) => entry.label === label)?.specId,
    paint: (x: number, y: number, specId: number, opts: { radius?: number; tempC?: number } = {}) =>
      deps.send({ type: 'paint', x, y, radius: opts.radius ?? 0, specId, tempC: opts.tempC ?? deps.getState().brushTempC }),
    erase: (x: number, y: number, radius = 0) => deps.send({ type: 'erase', x, y, radius }),
    // Raw escape hatch for protocol messages with no dedicated wrapper above
    // (runBurst/cancelBurst, loadScenario, ...) -- deliberately untyped here
    // since this is a devtools-console-facing dev aid, not app code.
    send: (message: MainToWorkerMessage) => deps.send(message),
  };
}
