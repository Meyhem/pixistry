// Addition-funnel apparatus: a placed instance is tracked state (unlike a
// wall or the radiator's flat per-cell overlay -- see apparatus-shapes.ts's
// module comment), since it needs to remember a species/temperature/rate/
// remaining-budget across ticks and isn't representable as a value per grid
// cell. The glass outline is the only part of a funnel that's real matter,
// and nothing here stamps it: funnelGlassCells is the footprint the
// compositor (entity-composite.ts) derives it from every time the bench
// changes. Everything else (the drip timer, the remaining budget) lives in
// the instance object held by worker.ts's `funnels` list.
import type { SimGrid } from './grid';
import { funnelShapeFor, funnelSpawnOffset, type FunnelFacing } from './apparatus-shapes';
import { nextEntityId } from './entity-id';
import { celsiusToKelvin, clampEnergyToMaxTemp, energyForTemperature, massOf } from './heat';
import type { SpeciesTable } from './species';
import type { Point } from './tube-shapes';

// Toolbar/side-panel display constants -- mirrors radiators.ts's
// RADIATOR_LABEL/RADIATOR_COLOR pattern for the other stateful apparatus.
export const FUNNEL_LABEL = 'Addition Funnel';
export const FUNNEL_COLOR = '#a9d6e8'; // same glass tint the funnel is built from

export interface FunnelInstance {
  readonly id: number;
  /** Placement order across every apparatus kind -- see entity-id.ts. */
  readonly entityId: number;
  anchorX: number;
  anchorY: number;
  /** Mutable after placement: a selected funnel rotates on the scroll wheel
   * exactly like an unplaced one does (see updateFunnelInstance, which
   * re-stamps the glass outline when this changes). */
  facing: FunnelFacing;
  specId: number;
  tempK: number;
  intervalTicks: number;
  ticksUntilDrip: number;
  /** null = infinite supply. */
  total: number | null;
  remaining: number | null;
  /** Starts false on every newly placed funnel -- dripping is opt-in per
   * instance, switched on from the select-apparatus tool's edit panel
   * (see setFunnelEnabledInstance), rather than a global setting. */
  enabled: boolean;
}

// TICK_MS in worker.ts is 1000/60, i.e. 60 ticks/sec -> 3600 ticks/minute.
// Kept as a literal here (rather than importing worker.ts, which would be a
// backwards module dependency) since it's a fixed property of the tick loop,
// not something funnel.ts's callers can vary.
const TICKS_PER_MINUTE = 3600;

/** "Pixels per minute" -> fixed ticks between drips, per the fixed-interval
 * rate model (one pixel exactly every N ticks). Clamped to at least 1 tick,
 * so the fastest a funnel can ever drip is one pixel per tick (3600/min). */
export function intervalTicksForRate(pixelsPerMinute: number): number {
  const rate = Math.max(1e-6, pixelsPerMinute);
  return Math.max(1, Math.round(TICKS_PER_MINUTE / rate));
}

/** Inverse of intervalTicksForRate, for displaying a placed instance's rate
 * back as pixels/minute (see worker.ts's FunnelSnapshot). */
export function rateFromIntervalTicks(intervalTicks: number): number {
  return TICKS_PER_MINUTE / Math.max(1, intervalTicks);
}

let nextFunnelId = 1;

export interface FunnelPlacement {
  readonly x: number;
  readonly y: number;
  readonly facing: FunnelFacing;
  readonly specId: number;
  readonly tempC: number;
  readonly ratePerMinute: number;
  readonly total: number | null;
}

/** Returns a new tracked instance, ready to drip on a future tick (see
 * stepFunnels). Its glass outline reaches the grid when the caller composites
 * the bench (see entity-composite.ts), not from here. */
export function placeFunnelInstance(placement: FunnelPlacement): FunnelInstance {
  return {
    id: nextFunnelId++,
    entityId: nextEntityId(),
    anchorX: placement.x,
    anchorY: placement.y,
    facing: placement.facing,
    specId: placement.specId,
    tempK: celsiusToKelvin(placement.tempC),
    intervalTicks: intervalTicksForRate(placement.ratePerMinute),
    ticksUntilDrip: 0,
    total: placement.total,
    remaining: placement.total,
    enabled: false,
  };
}

/** The cells a placed funnel's glass outline occupies right now -- its whole
 * footprint, which the compositor stamps as glass (see entity-composite.ts). */
export function funnelGlassCells(instance: FunnelInstance): Point[] {
  const shape = funnelShapeFor(instance.facing);
  return shape.cells.map((cell) => ({ x: instance.anchorX + cell.dx, y: instance.anchorY + cell.dy }));
}

/** Moves a placed funnel to a new anchor. Facing is unchanged -- the
 * select-apparatus tool's drag only translates; rotating is the scroll
 * wheel's job (see updateFunnelInstance). */
export function moveFunnelInstance(instance: FunnelInstance, x: number, y: number): void {
  instance.anchorX = x;
  instance.anchorY = y;
}

export interface FunnelConfig {
  readonly specId: number;
  readonly tempC: number;
  readonly ratePerMinute: number;
  readonly total: number | null;
  readonly facing: FunnelFacing;
}

/** Live-edits a placed funnel's species/temperature/rate/total/facing (the
 * select-apparatus tool's edit panel and its scroll-wheel rotation) --
 * position only ever changes via moveFunnelInstance (dragging), never here.
 * The reservoir's contents (which aren't matter -- see frame.ts's
 * computeFunnelFill) follow a new facing's shape on the next frame. Doesn't
 * refill `remaining` on its own (see resetFunnelInstance for that): lowering
 * `total` below the current remaining budget clamps it down, raising it (or
 * switching to infinite) leaves the current progress alone rather than
 * granting a surprise refill. */
export function updateFunnelInstance(instance: FunnelInstance, config: FunnelConfig): void {
  instance.facing = config.facing;
  instance.specId = config.specId;
  instance.tempK = celsiusToKelvin(config.tempC);
  instance.intervalTicks = intervalTicksForRate(config.ratePerMinute);
  instance.total = config.total;
  if (config.total === null) {
    instance.remaining = null;
  } else {
    instance.remaining = instance.remaining === null ? config.total : Math.min(instance.remaining, config.total);
  }
}

/** Refills a funnel back to its full configured total (or infinite) and
 * un-depletes it, so it resumes dripping on a future tick. */
export function resetFunnelInstance(instance: FunnelInstance): void {
  instance.remaining = instance.total;
  instance.ticksUntilDrip = 0;
}

/** Starts or stops a placed funnel's dripping without touching its other
 * config -- the select-apparatus tool's edit panel toggle. */
export function setFunnelEnabledInstance(instance: FunnelInstance, enabled: boolean): void {
  instance.enabled = enabled;
}

/** One tick's worth of dripping for every placed funnel. A funnel that's
 * off (see FunnelInstance.enabled) or depleted (remaining === 0) is left
 * alone -- its glass stays on the grid, inert. A funnel whose spawn cell is
 * currently occupied pauses rather than overwriting or burning its budget,
 * and retries every tick until the cell clears (see the plan's "pause and
 * wait" behavior) -- only a successful drip resets the fixed-interval
 * timer. */
export function stepFunnels(grid: SimGrid, species: SpeciesTable, instances: readonly FunnelInstance[]): void {
  for (const instance of instances) {
    if (!instance.enabled || instance.remaining === 0) continue;
    if (instance.ticksUntilDrip > 0) {
      instance.ticksUntilDrip -= 1;
      // Reaching exactly 0 this tick means it's due now, not next tick --
      // falls through to the spawn attempt below rather than waiting one
      // tick too long (which would make every drip N+1 ticks apart instead
      // of the configured N).
      if (instance.ticksUntilDrip > 0) continue;
    }

    const spawn = funnelSpawnOffset(instance.facing);
    const x = instance.anchorX + spawn.dx;
    const y = instance.anchorY + spawn.dy;
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    if (!grid.isEmptyAt(idx)) continue;

    const mass = massOf(species, instance.specId);
    const thermal = species.thermalOf(instance.specId);
    const { u, phase } = energyForTemperature(thermal, mass, instance.tempK);
    grid.setAt(idx, instance.specId, phase, clampEnergyToMaxTemp(thermal, mass, u));

    if (instance.remaining !== null) instance.remaining -= 1;
    instance.ticksUntilDrip = instance.intervalTicks;
  }
}
