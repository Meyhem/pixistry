import { describe, expect, it } from 'vitest';
import { EMPTY, PhaseCode, SimGrid, SinkMaskValue } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf } from './heat';
import { MAX_PORT_WIDTH, placePortInstance, portLineCells, portMaskValue, recordSinkHistory, SinkCounter, sinkLineCells, stepSinks, updatePortInstance } from './sink';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID, wallThermalProfile, getWall } from './walls';
import { SpeciesTable } from './species';

function paint(grid: SimGrid, species: SpeciesTable, x: number, y: number, specId: number): void {
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  const { u, phase } = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
  grid.set(x, y, specId, phase, u);
}

describe('sinkLineCells', () => {
  it('walks a horizontal line inclusive of both endpoints at width 0', () => {
    const cells = sinkLineCells(0, 0, 3, 0, 0);
    expect(cells).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('walks a vertical line inclusive of both endpoints at width 0', () => {
    const cells = sinkLineCells(2, 0, 2, 2, 0);
    expect(cells).toEqual([
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ]);
  });

  it('walks a diagonal line at an arbitrary (non-octant) angle', () => {
    const cells = sinkLineCells(0, 0, 4, 2, 0);
    expect(cells[0]).toEqual({ x: 0, y: 0 });
    expect(cells[cells.length - 1]).toEqual({ x: 4, y: 2 });
    // Every step moves at most one cell in each axis (a real Bresenham
    // walk, not a naive rounded interpolation that could skip cells).
    for (let i = 1; i < cells.length; i++) {
      const a = cells[i - 1]!;
      const b = cells[i]!;
      expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(b.y - a.y)).toBeLessThanOrEqual(1);
    }
  });

  it('a single point (x0,y0 === x1,y1) is just that one cell', () => {
    expect(sinkLineCells(5, 5, 5, 5, 0)).toEqual([{ x: 5, y: 5 }]);
  });

  it('thickens the line with a width > 0 and de-duplicates overlapping discs', () => {
    const bare = sinkLineCells(0, 0, 5, 0, 0);
    const thick = sinkLineCells(0, 0, 5, 0, 1);
    expect(thick.length).toBeGreaterThan(bare.length);
    // No duplicate coordinates.
    const keys = new Set(thick.map((c) => `${c.x},${c.y}`));
    expect(keys.size).toBe(thick.length);
    // Thickening a horizontal line by 1 should add the row above and below.
    expect(thick).toContainEqual({ x: 2, y: 1 });
    expect(thick).toContainEqual({ x: 2, y: -1 });
  });
});

describe('stepSinks', () => {
  it('consumes matter sitting on a sink cell and tallies it by specId', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 1);
    paint(grid, species, 1, 0, SpeciesId.NaCl);
    grid.sinkMask[grid.index(1, 0)] = 1;

    const counter = new SinkCounter();
    stepSinks(grid, counter, new SinkCounter());

    expect(grid.specId[grid.index(1, 0)]).toBe(EMPTY);
    expect(counter.totals[SpeciesId.NaCl]).toBe(1);
    expect(counter.grandTotal).toBe(1);
  });

  it('ignores cells with no sink drawn', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    paint(grid, species, 0, 0, SpeciesId.Fe);

    const counter = new SinkCounter();
    stepSinks(grid, counter, new SinkCounter());

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.Fe);
    expect(counter.grandTotal).toBe(0);
  });

  it('ignores empty sink cells', () => {
    const grid = new SimGrid(2, 1);
    grid.sinkMask[grid.index(0, 0)] = 1;

    const counter = new SinkCounter();
    stepSinks(grid, counter, new SinkCounter());

    expect(counter.grandTotal).toBe(0);
  });

  it('never consumes a wall material even if a sink is drawn over it', () => {
    const grid = new SimGrid(2, 1);
    const wall = getWall(GLASS_WALL_SPEC_ID);
    grid.set(0, 0, wall.specId, PhaseCode.Solid, 0);
    grid.sinkMask[grid.index(0, 0)] = 1;

    const counter = new SinkCounter();
    stepSinks(grid, counter, new SinkCounter());

    expect(grid.specId[grid.index(0, 0)]).toBe(wall.specId);
    expect(counter.grandTotal).toBe(0);
    // Referenced so the import isn't flagged unused if the assertion above
    // is ever simplified away.
    expect(wallThermalProfile(wall).density).toBeGreaterThan(0);
  });

  it('sums counts from multiple sink cells and multiple species into one global counter', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 1);
    paint(grid, species, 0, 0, SpeciesId.NaCl);
    paint(grid, species, 1, 0, SpeciesId.NaCl);
    paint(grid, species, 2, 0, SpeciesId.Fe);
    grid.sinkMask[grid.index(0, 0)] = 1;
    grid.sinkMask[grid.index(1, 0)] = 1;
    grid.sinkMask[grid.index(2, 0)] = 1;

    const counter = new SinkCounter();
    stepSinks(grid, counter, new SinkCounter());

    expect(counter.totals[SpeciesId.NaCl]).toBe(2);
    expect(counter.totals[SpeciesId.Fe]).toBe(1);
    expect(counter.grandTotal).toBe(3);
  });

  it('reset() zeroes every species total and the grand total', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(1, 1);
    paint(grid, species, 0, 0, SpeciesId.NaCl);
    grid.sinkMask[grid.index(0, 0)] = 1;

    const counter = new SinkCounter();
    stepSinks(grid, counter, new SinkCounter());
    expect(counter.grandTotal).toBe(1);

    counter.reset();
    expect(counter.grandTotal).toBe(0);
    expect(counter.totals[SpeciesId.NaCl]).toBe(0);
  });
});

describe('stepSinks: Vent ports', () => {
  it('tallies a Vent cell into the vent counter, not the sink counter', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 1);
    paint(grid, species, 1, 0, SpeciesId.NaCl);
    grid.sinkMask[grid.index(1, 0)] = SinkMaskValue.Vent;

    const sinkCounter = new SinkCounter();
    const ventCounter = new SinkCounter();
    stepSinks(grid, sinkCounter, ventCounter);

    // Consumption itself is identical -- only the tally it lands in differs.
    expect(grid.specId[grid.index(1, 0)]).toBe(EMPTY);
    expect(sinkCounter.grandTotal).toBe(0);
    expect(ventCounter.totals[SpeciesId.NaCl]).toBe(1);
    expect(ventCounter.grandTotal).toBe(1);
  });

  it('keeps sink and vent tallies separate when both are drawn on one grid', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 1);
    paint(grid, species, 0, 0, SpeciesId.NaCl);
    paint(grid, species, 2, 0, SpeciesId.NaCl);
    grid.sinkMask[grid.index(0, 0)] = SinkMaskValue.Sink;
    grid.sinkMask[grid.index(2, 0)] = SinkMaskValue.Vent;

    const sinkCounter = new SinkCounter();
    const ventCounter = new SinkCounter();
    stepSinks(grid, sinkCounter, ventCounter);

    expect(sinkCounter.totals[SpeciesId.NaCl]).toBe(1);
    expect(ventCounter.totals[SpeciesId.NaCl]).toBe(1);
  });
});

describe('recordSinkHistory', () => {
  it('only snapshots on a 60-tick boundary, leaving history untouched between them', () => {
    const counter = new SinkCounter();
    counter.totals[SpeciesId.NaCl] = 5;
    recordSinkHistory(counter, 1);
    recordSinkHistory(counter, 59);
    expect(counter.history).toHaveLength(0);
    recordSinkHistory(counter, 60);
    expect(counter.history).toHaveLength(1);
    expect(counter.history[0]).toEqual({ tick: 60, totals: counter.totals });
  });

  it('each snapshot is an independent copy, unaffected by totals mutated afterward', () => {
    const counter = new SinkCounter();
    counter.totals[SpeciesId.NaCl] = 5;
    recordSinkHistory(counter, 60);
    counter.totals[SpeciesId.NaCl] = 99;
    expect(counter.history[0]?.totals[SpeciesId.NaCl]).toBe(5);
  });

  it('trims the oldest entry once the ring buffer exceeds 120 snapshots', () => {
    const counter = new SinkCounter();
    for (let tick = 60; tick <= 121 * 60; tick += 60) recordSinkHistory(counter, tick);
    expect(counter.history).toHaveLength(120);
    expect(counter.history[0]?.tick).toBe(2 * 60);
    expect(counter.history[counter.history.length - 1]?.tick).toBe(121 * 60);
  });

  it('reset() clears history along with the totals', () => {
    const counter = new SinkCounter();
    recordSinkHistory(counter, 60);
    expect(counter.history).toHaveLength(1);
    counter.reset();
    expect(counter.history).toHaveLength(0);
  });
});

describe('port instances', () => {
  it('gives a Sink and a Vent identical geometry and different tallies', () => {
    const sink = placePortInstance('sink', { x0: 2, y0: 2, x1: 6, y1: 2, width: 1 });
    const vent = placePortInstance('vent', { x0: 2, y0: 2, x1: 6, y1: 2, width: 1 });

    expect(portLineCells(vent)).toEqual(portLineCells(sink));
    expect(portMaskValue(sink.kind)).toBe(SinkMaskValue.Sink);
    expect(portMaskValue(vent.kind)).toBe(SinkMaskValue.Vent);
  });

  it('clamps width, so no message can make a port stamp nothing or swallow the bench', () => {
    // A negative width makes sinkLineCells' thickening loop produce no cells
    // at all -- a port that eats nothing while still looking placed.
    const port = placePortInstance('sink', { x0: 5, y0: 5, x1: 5, y1: 5, width: -3 });
    expect(port.width).toBe(0);
    expect(portLineCells(port)).toHaveLength(1);

    updatePortInstance(port, 9999);
    expect(port.width).toBe(MAX_PORT_WIDTH);
  });
});
