import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf } from './heat';
import { placeFunnelInstance } from './funnel';
import { recordSinkHistory, SinkCounter, stepSinks } from './sink';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { placeTubeInstance } from './tube';
import { captureWorldSnapshot, restoreWorldSnapshot } from './world-snapshot';

function paint(grid: SimGrid, species: SpeciesTable, x: number, y: number, specId: number): void {
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  const { u, phase } = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
  grid.set(x, y, specId, phase, u);
}

describe('world snapshot/restore', () => {
  it('round-trips the grid, funnels, tubes, sink tally, and tick', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(20, 20);
    paint(grid, species, 5, 5, SpeciesId.NaCl);
    grid.sinkMask[grid.index(5, 5)] = 1;
    const sinkCounter = new SinkCounter();
    const ventCounter = new SinkCounter();
    stepSinks(grid, sinkCounter, ventCounter);
    expect(sinkCounter.grandTotal).toBe(1);

    const funnels = [placeFunnelInstance(grid, species, { x: 10, y: 10, facing: 'down', specId: SpeciesId.H2O, tempC: 20, ratePerMinute: 60, total: 10 })];
    const tubes = [placeTubeInstance(grid, species, { points: [{ x: 2, y: 2 }, { x: 6, y: 2 }], coneSize: 3, filter: null })];

    const snapshot = captureWorldSnapshot(grid, funnels, tubes, [], sinkCounter, ventCounter, 42);

    // Mutate everything after the snapshot -- restore should undo all of it.
    paint(grid, species, 8, 8, SpeciesId.Fe);
    grid.radiatorRadius[grid.index(1, 1)] = 5;
    sinkCounter.reset();
    const mutatedFunnels = [...funnels];
    mutatedFunnels[0]!.remaining = 0;
    const mutatedTubes = [...tubes];
    mutatedTubes[0]!.coneSize = 9;

    const restored = restoreWorldSnapshot(grid, sinkCounter, ventCounter, snapshot);

    expect(grid.specId[grid.index(8, 8)]).not.toBe(SpeciesId.Fe);
    expect(grid.radiatorRadius[grid.index(1, 1)]).toBe(0);
    expect(sinkCounter.grandTotal).toBe(1);
    expect(restored.tick).toBe(42);
    expect(restored.funnels[0]!.remaining).toBe(10);
    expect(restored.tubes[0]!.coneSize).toBe(3);
  });

  it('round-trips the sink history ring buffer, independent of the live one', () => {
    const grid = new SimGrid(5, 5);
    const sinkCounter = new SinkCounter();
    recordSinkHistory(sinkCounter, 60);
    recordSinkHistory(sinkCounter, 120);

    const snapshot = captureWorldSnapshot(grid, [], [], [], sinkCounter, new SinkCounter(), 120);
    sinkCounter.reset();
    expect(sinkCounter.history).toHaveLength(0);

    restoreWorldSnapshot(grid, sinkCounter, new SinkCounter(), snapshot);
    expect(sinkCounter.history).toHaveLength(2);
    expect(sinkCounter.history.map((h) => h.tick)).toEqual([60, 120]);
  });

  it('restored funnel/tube instances are independent copies, not aliases of the originals', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(20, 20);
    const funnels = [placeFunnelInstance(grid, species, { x: 10, y: 10, facing: 'down', specId: SpeciesId.H2O, tempC: 20, ratePerMinute: 60, total: null })];
    const sinkCounter = new SinkCounter();

    const snapshot = captureWorldSnapshot(grid, funnels, [], [], sinkCounter, new SinkCounter(), 0);
    const restored = restoreWorldSnapshot(grid, sinkCounter, new SinkCounter(), snapshot);

    restored.funnels[0]!.remaining = 999;
    expect(funnels[0]!.remaining).not.toBe(999);
  });

  it('clearAll wipes matter and every overlay back to empty', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(5, 5);
    paint(grid, species, 2, 2, SpeciesId.NaCl);
    grid.set(1, 1, 2, PhaseCode.Solid, 0);
    grid.radiatorRadius[grid.index(2, 2)] = 3;
    grid.stirrerMask[grid.index(2, 2)] = 1;
    grid.sinkMask[grid.index(2, 2)] = 1;

    grid.clearAll();

    for (let i = 0; i < grid.width * grid.height; i++) {
      expect(grid.isEmptyAt(i)).toBe(true);
      expect(grid.u[i]).toBe(0);
      expect(grid.radiatorRadius[i]).toBe(0);
      expect(grid.stirrerMask[i]).toBe(0);
      expect(grid.sinkMask[i]).toBe(0);
    }
  });
});
