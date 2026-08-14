// Pure functions of grid + apparatus-instance state that build the 'frame'
// message worker.ts posts every tick. Split out of worker.ts so this logic
// -- previously only reachable by round-tripping through a live Worker -- is
// directly unit-testable; in particular computeFunnelFill's "cosmetic wash
// never overwrites real matter" precedence rule had no test coverage at all
// before this split.
import type { GrabState } from './grabber';
import { EMPTY, type SimGrid } from './grid';
import { funnelShapeFor } from './apparatus-shapes';
import type { FunnelInstance } from './funnel';
import { kelvinToCelsius, massOf, temperatureOf } from './heat';
import { rateFromIntervalTicks } from './funnel';
import type { GoalProgress } from './objectives';
import type { SinkCounter } from './sink';
import type { SpeciesTable } from './species';
import type { TubeInstance } from './tube';
import type { FunnelSnapshot, TubeSnapshot, WorkerToMainMessage } from './protocol';

export function computeTempGrid(grid: SimGrid, species: SpeciesTable): Float32Array {
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
export function computeFunnelFill(grid: SimGrid, funnels: readonly FunnelInstance[]): Uint16Array {
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

export function funnelSnapshots(funnels: readonly FunnelInstance[]): FunnelSnapshot[] {
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
    enabled: f.enabled,
  }));
}

export function tubeSnapshots(tubes: readonly TubeInstance[]): TubeSnapshot[] {
  return tubes.map((t) => ({
    id: t.id,
    points: t.points.map((p) => ({ x: p.x, y: p.y })),
    coneSize: t.coneSize,
    filter: t.filter ? [...t.filter] : null,
  }));
}

/** Overlays held grabber cells (see grabber.ts) into an already-built frame's
 * arrays purely for display -- held cells are pulled out of `grid` entirely
 * while grabbed, so they'd otherwise render as empty. Mutates the three
 * arrays in place. */
export function overlayGrabbedCells(
  grid: SimGrid,
  species: SpeciesTable,
  grabState: GrabState | null,
  specId: Uint16Array,
  phase: Uint8Array,
  tempK: Float32Array,
): void {
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

export interface FrameState {
  readonly funnels: readonly FunnelInstance[];
  readonly tubes: readonly TubeInstance[];
  readonly grabState: GrabState | null;
  readonly sinkCounter: SinkCounter;
  readonly hasSnapshot: boolean;
  readonly tick: number;
  /** Pre-computed by the caller (worker.ts, via objectives.ts's
   * evaluateGoals) -- buildFrame just embeds it, since it has no scenario
   * state of its own to evaluate goals against. Empty in sandbox mode. */
  readonly objectives: GoalProgress[];
}

/** Builds one 'frame' message from the grid + apparatus-instance state --
 * the single function worker.ts's postFrame calls every tick. */
export function buildFrame(grid: SimGrid, species: SpeciesTable, state: FrameState): Extract<WorkerToMainMessage, { type: 'frame' }> {
  const specId = grid.specId.slice();
  const phase = grid.phase.slice();
  const tempK = computeTempGrid(grid, species);
  const radiatorRadius = grid.radiatorRadius.slice();
  const radiatorTargetK = grid.radiatorTargetK.slice();
  const stirrerMask = grid.stirrerMask.slice();
  const tubeMask = grid.tubeMask.slice();
  const filterMask = grid.filterMask.slice();
  const funnelFillSpecId = computeFunnelFill(grid, state.funnels);
  const sinkMask = grid.sinkMask.slice();
  overlayGrabbedCells(grid, species, state.grabState, specId, phase, tempK);
  return {
    type: 'frame',
    specId,
    phase,
    tempK,
    radiatorRadius,
    radiatorTargetK,
    stirrerMask,
    tubeMask,
    filterMask,
    funnelFillSpecId,
    funnels: funnelSnapshots(state.funnels),
    tubes: tubeSnapshots(state.tubes),
    sinkMask,
    sinkTotals: state.sinkCounter.totals.slice(),
    sinkGrandTotal: state.sinkCounter.grandTotal,
    hasSnapshot: state.hasSnapshot,
    tick: state.tick,
    objectives: state.objectives,
  };
}
