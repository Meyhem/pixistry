import { describe, expect, it } from 'vitest';
import { EMPTY, PhaseCode, SimGrid } from './grid';
import {
  AMBIENT_TEMPERATURE_K,
  applyPointHeatSource,
  energyForTemperature,
  massOf,
  stepConduction,
  stepRadiators,
  temperatureOf,
} from './heat';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';
import { wallList } from './walls';

function findEntry(palette: PaletteEntry[], label: string): PaletteEntry {
  const entry = palette.find((p) => p.label === label);
  if (!entry) throw new Error(`no palette entry for ${label}`);
  return entry;
}

function totalEnergy(grid: SimGrid): number {
  let sum = 0;
  for (let i = 0; i < grid.u.length; i++) sum += grid.u[i] as number;
  return sum;
}

describe('temperatureOf / energyForTemperature', () => {
  it('round-trips a temperature below the melting point back to itself, as solid', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const thermal = species.thermalOf(iron.specId);
    const mass = massOf(species, iron.specId);

    const targetK = 500; // well below Fe's ~1811K melting point
    const { u, phase } = energyForTemperature(thermal, mass, targetK);
    expect(phase).toBe(PhaseCode.Solid);

    const result = temperatureOf(thermal, mass, u);
    expect(result.phase).toBe(PhaseCode.Solid);
    expect(result.tempK).toBeCloseTo(targetK, 5);
  });

  it('paints water at ambient temperature as liquid', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');
    const thermal = species.thermalOf(water.specId);
    const mass = massOf(species, water.specId);

    const { phase } = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
    expect(phase).toBe(PhaseCode.Liquid);
  });

  it('holds temperature flat across the melt plateau', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');
    const thermal = species.thermalOf(water.specId);
    const mass = massOf(species, water.specId);

    const meltStart = mass * thermal.specificHeatSolid * thermal.meltK;
    const meltEnd = meltStart + mass * thermal.heatOfFusion;
    const mid = (meltStart + meltEnd) / 2;

    const atStart = temperatureOf(thermal, mass, meltStart + 1);
    const atMid = temperatureOf(thermal, mass, mid);
    const atEnd = temperatureOf(thermal, mass, meltEnd - 1);

    expect(atStart.tempK).toBeCloseTo(thermal.meltK, 5);
    expect(atMid.tempK).toBeCloseTo(thermal.meltK, 5);
    expect(atEnd.tempK).toBeCloseTo(thermal.meltK, 5);
    expect(atStart.phase).toBe(PhaseCode.Liquid);
  });

  it('boils into a gas once past the vaporization plateau', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');
    const thermal = species.thermalOf(water.specId);
    const mass = massOf(species, water.specId);

    const boilEnd =
      mass * thermal.specificHeatSolid * thermal.meltK +
      mass * thermal.heatOfFusion +
      mass * thermal.specificHeatLiquid * (thermal.boilK - thermal.meltK) +
      mass * thermal.heatOfVaporization;

    const result = temperatureOf(thermal, mass, boilEnd + 1000);
    expect(result.phase).toBe(PhaseCode.Gas);
    expect(result.tempK).toBeGreaterThan(thermal.boilK);
  });
});

describe('stepConduction', () => {
  it('moves energy from the hotter cell to the colder cell', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(2, 1);
    const hot = energyForTemperature(species.thermalOf(iron.specId), massOf(species, iron.specId), 800);
    const cold = energyForTemperature(species.thermalOf(iron.specId), massOf(species, iron.specId), 300);
    grid.set(0, 0, iron.specId, hot.phase, hot.u);
    grid.set(1, 0, iron.specId, cold.phase, cold.u);

    stepConduction(grid, species);

    expect(grid.u[0] as number).toBeLessThan(hot.u);
    expect(grid.u[1] as number).toBeGreaterThan(cold.u);
  });

  it('conserves total energy across a conduction step', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(3, 3);
    const hot = energyForTemperature(species.thermalOf(iron.specId), massOf(species, iron.specId), 900);
    const ambient = energyForTemperature(species.thermalOf(water.specId), massOf(species, water.specId), AMBIENT_TEMPERATURE_K);
    grid.set(1, 1, iron.specId, hot.phase, hot.u);
    grid.set(0, 1, water.specId, ambient.phase, ambient.u);
    grid.set(2, 1, water.specId, ambient.phase, ambient.u);
    grid.set(1, 0, water.specId, ambient.phase, ambient.u);
    grid.set(1, 2, water.specId, ambient.phase, ambient.u);

    const before = totalEnergy(grid);
    for (let i = 0; i < 5; i++) stepConduction(grid, species);
    const after = totalEnergy(grid);

    expect(after).toBeCloseTo(before, 1);
  });

  it('never conducts through an empty (vacuum) cell', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 1);
    const hot = energyForTemperature(species.thermalOf(iron.specId), massOf(species, iron.specId), 900);
    grid.set(0, 0, iron.specId, hot.phase, hot.u);
    // (1,0) left EMPTY
    grid.set(2, 0, iron.specId, hot.phase, hot.u);

    stepConduction(grid, species);

    expect(grid.specId[grid.index(1, 0)]).toBe(EMPTY);
    expect(grid.u[grid.index(1, 0)]).toBe(0);
    expect(grid.u[grid.index(2, 0)] as number).toBeCloseTo(hot.u, 1);
  });

  it('melts ice into liquid water once enough energy is conducted in', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(1, 2);
    const ice = energyForTemperature(species.thermalOf(water.specId), massOf(species, water.specId), 260);
    const hotIron = energyForTemperature(species.thermalOf(iron.specId), massOf(species, iron.specId), 1200);
    grid.set(0, 0, water.specId, ice.phase, ice.u);
    grid.set(0, 1, iron.specId, hotIron.phase, hotIron.u);
    expect(grid.phase[grid.index(0, 0)]).toBe(PhaseCode.Solid);

    for (let i = 0; i < 2000; i++) stepConduction(grid, species);

    expect(grid.phase[grid.index(0, 0)]).not.toBe(PhaseCode.Solid);
  });
});

describe('applyPointHeatSource', () => {
  it('adds energy (watts * dt) to a cell colder than the target', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 3);
    grid.set(1, 1, iron.specId, PhaseCode.Solid, 100);

    applyPointHeatSource(grid, species, 1, 1, 0, 500, 10000, 1 / 60);

    expect(grid.u[grid.index(1, 1)] as number).toBeCloseTo(100 + 500 / 60, 5);
  });

  it('removes energy from a cell hotter than the target, clamped at zero', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(1, 1);
    grid.set(0, 0, iron.specId, PhaseCode.Solid, 5);

    applyPointHeatSource(grid, species, 0, 0, 0, 5000, 0, 1);

    expect(grid.u[0] as number).toBe(0);
  });

  it('never touches empty cells', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 3);
    applyPointHeatSource(grid, species, 1, 1, 2, 500, 10000, 1);
    for (let i = 0; i < grid.u.length; i++) {
      expect(grid.u[i]).toBe(0);
    }
  });

  it('is a no-op for zero watts', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(1, 1);
    grid.set(0, 0, iron.specId, PhaseCode.Solid, 123);
    applyPointHeatSource(grid, species, 0, 0, 0, 0, 10000, 1);
    expect(grid.u[0]).toBe(123);
  });

  it('stops heating a cell once it reaches the target temperature', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const mass = massOf(species, iron.specId);
    const thermal = species.thermalOf(iron.specId);

    const targetK = 400;
    const atTarget = energyForTemperature(thermal, mass, targetK);
    const grid = new SimGrid(1, 1);
    grid.set(0, 0, iron.specId, atTarget.phase, atTarget.u);

    applyPointHeatSource(grid, species, 0, 0, 0, 500, targetK, 1);

    expect(grid.u[0] as number).toBeCloseTo(atTarget.u, 3);
  });

  it('stops cooling a cell once it reaches the target temperature', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const mass = massOf(species, iron.specId);
    const thermal = species.thermalOf(iron.specId);

    const targetK = 250;
    const atTarget = energyForTemperature(thermal, mass, targetK);
    const grid = new SimGrid(1, 1);
    grid.set(0, 0, iron.specId, atTarget.phase, atTarget.u);

    applyPointHeatSource(grid, species, 0, 0, 0, 500, targetK, 1);

    expect(grid.u[0] as number).toBeCloseTo(atTarget.u, 3);
  });
});

describe('stepRadiators', () => {
  it('heats a cell within radius of a radiator cell whose target is above its temperature, without occupying it', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 1);
    grid.radiatorRadius[grid.index(1, 0)] = 1;
    grid.radiatorTargetK[grid.index(1, 0)] = 10000;
    grid.set(0, 0, iron.specId, PhaseCode.Solid, 100);

    stepRadiators(grid, species, 1);

    expect(grid.u[grid.index(0, 0)] as number).toBeGreaterThan(100);
    // The radiator cell itself carries no specId -- nothing to collide with.
    expect(grid.specId[grid.index(1, 0)]).toBe(EMPTY);
  });

  it('cools a cell within radius of a radiator cell whose target is below its temperature', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 1);
    grid.radiatorRadius[grid.index(1, 0)] = 1;
    grid.radiatorTargetK[grid.index(1, 0)] = 0;
    grid.set(0, 0, iron.specId, PhaseCode.Solid, 1_000_000);

    stepRadiators(grid, species, 1);

    expect(grid.u[grid.index(0, 0)] as number).toBeLessThan(1_000_000);
  });

  it('acts as a heater for a colder neighbor and a cooler for a hotter neighbor in the same tick', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const thermal = species.thermalOf(iron.specId);
    const mass = massOf(species, iron.specId);

    const grid = new SimGrid(3, 1);
    grid.radiatorRadius[grid.index(1, 0)] = 1;
    grid.radiatorTargetK[grid.index(1, 0)] = 500;
    const cold = energyForTemperature(thermal, mass, 300);
    const hot = energyForTemperature(thermal, mass, 900);
    grid.set(0, 0, iron.specId, cold.phase, cold.u);
    grid.set(2, 0, iron.specId, hot.phase, hot.u);

    stepRadiators(grid, species, 1);

    expect(grid.u[grid.index(0, 0)] as number).toBeGreaterThan(cold.u);
    expect(grid.u[grid.index(2, 0)] as number).toBeLessThan(hot.u);
  });

  it('does not radiate from passive wall materials (glass/steel/insulator)', () => {
    const glass = wallList().find((w) => w.kind === 'glass');
    if (!glass) throw new Error('no glass wall material');
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 1);
    grid.set(1, 0, glass.specId, PhaseCode.Solid, 0);
    grid.set(0, 0, iron.specId, PhaseCode.Solid, 100);

    stepRadiators(grid, species, 1);

    expect(grid.u[grid.index(0, 0)] as number).toBe(100);
  });

  it('is a no-op for a cell with no radiator radius set, even if a stale target lingers', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 1);
    grid.radiatorRadius[grid.index(1, 0)] = 0;
    grid.radiatorTargetK[grid.index(1, 0)] = 10000;
    grid.set(0, 0, iron.specId, PhaseCode.Solid, 100);

    stepRadiators(grid, species, 1);

    expect(grid.u[grid.index(0, 0)] as number).toBe(100);
  });

  it('stops heating once a cell in range reaches the radiator target temperature', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const mass = massOf(species, iron.specId);
    const thermal = species.thermalOf(iron.specId);

    const targetK = 400;
    const atTarget = energyForTemperature(thermal, mass, targetK);
    const grid = new SimGrid(3, 1);
    grid.radiatorRadius[grid.index(1, 0)] = 1;
    grid.radiatorTargetK[grid.index(1, 0)] = targetK;
    grid.set(0, 0, iron.specId, atTarget.phase, atTarget.u);

    stepRadiators(grid, species, 1);

    expect(grid.u[grid.index(0, 0)] as number).toBeCloseTo(atTarget.u, 3);
  });
});
