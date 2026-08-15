import { describe, expect, it } from 'vitest';
import { PhaseCode, SimGrid } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf } from './heat';
import { compositeEntities, NO_ENTITIES } from './entity-composite';
import { placeFunnelInstance } from './funnel';
import { placeRadiatorInstance } from './radiators';
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

    const funnels = [placeFunnelInstance({ x: 10, y: 10, facing: 'down', specId: SpeciesId.H2O, tempC: 20, ratePerMinute: 60, total: 10 })];
    const tubes = [placeTubeInstance(grid, { points: [{ x: 2, y: 2 }, { x: 6, y: 2 }], filter: null })];
    compositeEntities(grid, species, { ...NO_ENTITIES, funnels, tubes });

    const snapshot = captureWorldSnapshot(grid, funnels, tubes, [], [], [], [], sinkCounter, ventCounter, 42);

    // Mutate everything after the snapshot -- restore should undo all of it.
    paint(grid, species, 8, 8, SpeciesId.Fe);
    const strayRadiator = [placeRadiatorInstance({ x0: 1, y0: 1, x1: 1, y1: 1, radius: 5, targetK: 500 })];
    compositeEntities(grid, species, { ...NO_ENTITIES, funnels, tubes, radiators: strayRadiator });
    expect(grid.radiatorRadius[grid.index(1, 1)]).toBe(5);
    sinkCounter.reset();
    const mutatedFunnels = [...funnels];
    mutatedFunnels[0]!.remaining = 0;
    const mutatedTubes = [...tubes];
    mutatedTubes[0]!.filter = new Set([SpeciesId.Fe]);

    const restored = restoreWorldSnapshot(grid, species, sinkCounter, ventCounter, snapshot);

    expect(grid.specId[grid.index(8, 8)]).not.toBe(SpeciesId.Fe);
    // The radiator wasn't in the snapshot's instance list, so compositing the
    // restored bench derives it away -- the apparatus grid state follows the
    // instance lists, never the other way round.
    expect(grid.radiatorRadius[grid.index(1, 1)]).toBe(0);
    expect(sinkCounter.grandTotal).toBe(1);
    expect(restored.tick).toBe(42);
    expect(restored.funnels[0]!.remaining).toBe(10);
    expect(restored.tubes[0]!.filter).toBeNull();
  });

  it('round-trips the sink history ring buffer, independent of the live one', () => {
    const grid = new SimGrid(5, 5);
    const sinkCounter = new SinkCounter();
    recordSinkHistory(sinkCounter, 60);
    recordSinkHistory(sinkCounter, 120);

    const snapshot = captureWorldSnapshot(grid, [], [], [], [], [], [], sinkCounter, new SinkCounter(), 120);
    sinkCounter.reset();
    expect(sinkCounter.history).toHaveLength(0);

    restoreWorldSnapshot(grid, new SpeciesTable(), sinkCounter, new SinkCounter(), snapshot);
    expect(sinkCounter.history).toHaveLength(2);
    expect(sinkCounter.history.map((h) => h.tick)).toEqual([60, 120]);
  });

  it('restored funnel/tube instances are independent copies, not aliases of the originals', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(20, 20);
    const funnels = [placeFunnelInstance({ x: 10, y: 10, facing: 'down', specId: SpeciesId.H2O, tempC: 20, ratePerMinute: 60, total: null })];
    compositeEntities(grid, species, { ...NO_ENTITIES, funnels });
    const sinkCounter = new SinkCounter();

    const snapshot = captureWorldSnapshot(grid, funnels, [], [], [], [], [], sinkCounter, new SinkCounter(), 0);
    const restored = restoreWorldSnapshot(grid, species, sinkCounter, new SinkCounter(), snapshot);

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
      expect(grid.entityOwner[i]).toBe(0);
    }
  });
});
