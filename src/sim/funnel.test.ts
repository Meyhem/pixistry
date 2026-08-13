import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid } from './grid';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID } from './walls';
import { funnelShapeFor, funnelSpawnOffset } from './apparatus-shapes';
import {
  intervalTicksForRate,
  placeFunnelInstance,
  rateFromIntervalTicks,
  resetFunnelInstance,
  stepFunnels,
  updateFunnelInstance,
  type FunnelInstance,
} from './funnel';

const species = new SpeciesTable();

function place(grid: SimGrid, overrides: Partial<Parameters<typeof placeFunnelInstance>[1]> = {}): FunnelInstance {
  return placeFunnelInstance(grid, {
    x: 50,
    y: 50,
    facing: 'down',
    specId: SpeciesId.H2O,
    tempC: 21,
    ratePerMinute: 3600, // 1 tick apart -- fastest possible, keeps tests short
    total: 5,
    ...overrides,
  });
}

describe('funnel', () => {
  it('stamps the glass outline into the grid at placement, overwriting whatever was there', () => {
    const grid = new SimGrid(100, 100);
    grid.set(50, 20, SpeciesId.H2O, PhaseCode.Liquid); // sits under the mouth, should get overwritten by glass
    const instance = place(grid, { y: 50 });

    const shape = funnelShapeFor(instance.facing);
    for (const cell of shape.cells) {
      const idx = grid.index(instance.anchorX + cell.dx, instance.anchorY + cell.dy);
      expect(grid.specId[idx]).toBe(GLASS_WALL_SPEC_ID);
    }
  });

  it('converts pixels/minute to a fixed tick interval and back (round-trip within 1 tick)', () => {
    const interval = intervalTicksForRate(120); // 2/sec -> 30 ticks apart at 60 ticks/sec
    expect(interval).toBe(30);
    expect(rateFromIntervalTicks(interval)).toBe(120);
  });

  it('clamps the fastest rate to one pixel per tick', () => {
    expect(intervalTicksForRate(999999)).toBe(1);
  });

  it('drips exactly one pixel every intervalTicks ticks, at the spawn cell beyond the spout', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, { ratePerMinute: 1800, total: null }); // 2 ticks apart, infinite
    const spawn = funnelSpawnOffset(instance.facing);
    const spawnIdx = grid.index(instance.anchorX + spawn.dx, instance.anchorY + spawn.dy);

    stepFunnels(grid, species, [instance]); // tick 1: due immediately (ticksUntilDrip starts at 0)
    expect(grid.specId[spawnIdx]).toBe(SpeciesId.H2O);

    grid.clearAt(spawnIdx);
    stepFunnels(grid, species, [instance]); // tick 2: not due yet (interval 2)
    expect(grid.isEmptyAt(spawnIdx)).toBe(true);

    stepFunnels(grid, species, [instance]); // tick 3: due again
    expect(grid.specId[spawnIdx]).toBe(SpeciesId.H2O);
  });

  it('pauses without burning its budget while the outlet is blocked, and resumes once clear', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, { total: 3 });
    const spawn = funnelSpawnOffset(instance.facing);
    const spawnIdx = grid.index(instance.anchorX + spawn.dx, instance.anchorY + spawn.dy);

    grid.set(instance.anchorX + spawn.dx, instance.anchorY + spawn.dy, SpeciesId.Fe, PhaseCode.Solid); // block it
    for (let i = 0; i < 5; i++) stepFunnels(grid, species, [instance]);
    expect(instance.remaining).toBe(3); // never dripped, budget untouched
    expect(grid.specId[spawnIdx]).toBe(SpeciesId.Fe); // never overwrote the blocker

    grid.clearAt(spawnIdx); // unblock
    stepFunnels(grid, species, [instance]);
    expect(grid.specId[spawnIdx]).toBe(SpeciesId.H2O);
    expect(instance.remaining).toBe(2);
  });

  it('stops dripping once its finite total is exhausted, leaving the glass in place', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, { ratePerMinute: 3600, total: 2 });
    const spawn = funnelSpawnOffset(instance.facing);
    const spawnIdx = grid.index(instance.anchorX + spawn.dx, instance.anchorY + spawn.dy);

    stepFunnels(grid, species, [instance]);
    grid.clearAt(spawnIdx);
    stepFunnels(grid, species, [instance]);
    expect(instance.remaining).toBe(0);

    grid.clearAt(spawnIdx);
    stepFunnels(grid, species, [instance]); // depleted -- should no longer drip
    expect(grid.isEmptyAt(spawnIdx)).toBe(true);

    const shape = funnelShapeFor(instance.facing);
    const anchorIdx = grid.index(instance.anchorX, instance.anchorY);
    expect(grid.specId[anchorIdx]).toBe(GLASS_WALL_SPEC_ID); // glass never disappears
    expect(shape.cells.length).toBeGreaterThan(0);
  });

  it('never depletes an infinite funnel', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, { ratePerMinute: 3600, total: null });
    const spawn = funnelSpawnOffset(instance.facing);
    const spawnIdx = grid.index(instance.anchorX + spawn.dx, instance.anchorY + spawn.dy);

    for (let i = 0; i < 50; i++) {
      grid.clearAt(spawnIdx);
      stepFunnels(grid, species, [instance]);
    }
    expect(instance.remaining).toBeNull();
    expect(grid.specId[spawnIdx]).toBe(SpeciesId.H2O);
  });

  it('resetFunnelInstance refills remaining to the full total and un-pauses it', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, { ratePerMinute: 3600, total: 1 });
    stepFunnels(grid, species, [instance]);
    expect(instance.remaining).toBe(0);

    resetFunnelInstance(instance);
    expect(instance.remaining).toBe(1);

    const spawn = funnelSpawnOffset(instance.facing);
    const spawnIdx = grid.index(instance.anchorX + spawn.dx, instance.anchorY + spawn.dy);
    grid.clearAt(spawnIdx);
    stepFunnels(grid, species, [instance]);
    expect(instance.remaining).toBe(0);
    expect(grid.specId[spawnIdx]).toBe(SpeciesId.H2O);
  });

  it('updateFunnelInstance changes species/rate/temp and clamps remaining to a lowered total', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, { total: 10 });
    updateFunnelInstance(instance, { specId: SpeciesId.NaCl, tempC: 100, ratePerMinute: 60, total: 3 });

    expect(instance.specId).toBe(SpeciesId.NaCl);
    expect(instance.total).toBe(3);
    expect(instance.remaining).toBe(3); // clamped down from 10
    expect(intervalTicksForRate(60)).toBe(instance.intervalTicks);
  });

  it('updateFunnelInstance switching to infinite clears the remaining budget', () => {
    const grid = new SimGrid(100, 100);
    const instance = place(grid, { total: 5 });
    updateFunnelInstance(instance, { specId: instance.specId, tempC: 21, ratePerMinute: 60, total: null });
    expect(instance.total).toBeNull();
    expect(instance.remaining).toBeNull();
  });
});
