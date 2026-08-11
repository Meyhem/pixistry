import { describe, expect, it } from 'vitest';
import { SimGrid, PhaseCode, EMPTY } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf } from './heat';
import { AMBIENT_PRESSURE_KPA, FULL_N, pressureKPa, stepPressure, stepWallBurst } from './pressure';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';
import { wallList } from './walls';

function findEntry(palette: PaletteEntry[], label: string): PaletteEntry {
  const entry = palette.find((p) => p.label === label);
  if (!entry) throw new Error(`no palette entry for ${label}`);
  return entry;
}

describe('pressureKPa', () => {
  it('reads ~1 atm for a full gas cell at ambient temperature', () => {
    expect(pressureKPa(FULL_N, AMBIENT_TEMPERATURE_K)).toBeCloseTo(AMBIENT_PRESSURE_KPA, 3);
  });

  it('is zero for an empty (n=0) cell', () => {
    expect(pressureKPa(0, AMBIENT_TEMPERATURE_K)).toBe(0);
  });

  it('scales linearly with n at fixed temperature', () => {
    expect(pressureKPa(100, AMBIENT_TEMPERATURE_K)).toBeCloseTo(pressureKPa(50, AMBIENT_TEMPERATURE_K) * 2, 5);
  });

  it('scales linearly with temperature at fixed n', () => {
    expect(pressureKPa(100, 600)).toBeCloseTo(pressureKPa(100, 300) * 2, 3);
  });
});

describe('stepPressure', () => {
  it('equalizes n between adjacent same-species gas cells', () => {
    const grid = new SimGrid(3, 1);
    grid.setAt(0, 5, PhaseCode.Gas, 10, 200);
    grid.setAt(1, 5, PhaseCode.Gas, 10, 0);
    stepPressure(grid);
    expect(grid.n[0] as number).toBeLessThan(200);
    expect(grid.n[1] as number).toBeGreaterThan(0);
    expect((grid.n[0] as number) + (grid.n[1] as number)).toBeLessThanOrEqual(200);
  });

  it('does not mix n between different gas species', () => {
    const grid = new SimGrid(3, 1);
    grid.setAt(0, 5, PhaseCode.Gas, 10, 200);
    grid.setAt(1, 7, PhaseCode.Gas, 10, 0);
    stepPressure(grid);
    expect(grid.n[0] as number).toBe(200);
  });

  it('leaves liquids/solids alone even if n happens to be nonzero', () => {
    const grid = new SimGrid(2, 1);
    grid.setAt(0, 5, PhaseCode.Liquid, 10, 50);
    stepPressure(grid);
    expect(grid.n[0] as number).toBe(50);
  });

  it('expands a pressurized gas cell into an adjacent empty cell', () => {
    const grid = new SimGrid(2, 1);
    grid.setAt(0, 5, PhaseCode.Gas, 40, 200);
    stepPressure(grid);
    expect(grid.specId[1]).toBe(5);
    expect(grid.phase[1]).toBe(PhaseCode.Gas);
    expect(grid.n[1] as number).toBeGreaterThan(0);
    expect((grid.n[0] as number) + (grid.n[1] as number)).toBe(200);
    expect((grid.u[0] as number) + (grid.u[1] as number)).toBeCloseTo(40, 5);
  });

  it('does not expand a near-empty gas cell (n<=1)', () => {
    const grid = new SimGrid(2, 1);
    grid.setAt(0, 5, PhaseCode.Gas, 1, 1);
    stepPressure(grid);
    expect(grid.specId[1]).toBe(EMPTY);
  });
});

describe('stepWallBurst', () => {
  it('destroys a wall cell when adjacent gas pressure exceeds its wall strength', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    const glass = wallList().find((w) => w.kind === 'glass');
    if (!glass) throw new Error('no glass wall material');

    const o2 = findEntry(palette, 'O2');
    const mass = massOf(species, o2.specId);
    // glass wallStrength is 3x ambient pressure; at full n, pushing well
    // past 3x ambient temperature comfortably clears that threshold.
    const { u } = energyForTemperature(species.thermalOf(o2.specId), mass, AMBIENT_TEMPERATURE_K * 5);
    grid.setAt(grid.index(0, 0), o2.specId, PhaseCode.Gas, u, FULL_N);
    grid.setAt(grid.index(1, 0), glass.specId, PhaseCode.Solid, 0, 0);

    stepWallBurst(grid, species);

    expect(grid.specId[grid.index(1, 0)]).toBe(EMPTY);
  });

  it('leaves a wall intact when adjacent gas pressure is at ambient', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    const glass = wallList().find((w) => w.kind === 'glass');
    if (!glass) throw new Error('no glass wall material');

    const o2 = findEntry(palette, 'O2');
    const mass = massOf(species, o2.specId);
    const { u } = energyForTemperature(species.thermalOf(o2.specId), mass, AMBIENT_TEMPERATURE_K);
    grid.setAt(grid.index(0, 0), o2.specId, PhaseCode.Gas, u, FULL_N);
    grid.setAt(grid.index(1, 0), glass.specId, PhaseCode.Solid, 0, 0);

    stepWallBurst(grid, species);

    expect(grid.specId[grid.index(1, 0)]).toBe(glass.specId);
  });

  it('leaves non-wall neighbors and non-gas neighbors alone', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(2, 1);
    const steel = wallList().find((w) => w.kind === 'steel');
    if (!steel) throw new Error('no steel wall material');

    grid.setAt(grid.index(0, 0), 0, PhaseCode.Solid, 0, 0);
    grid.setAt(grid.index(1, 0), steel.specId, PhaseCode.Solid, 0, 0);

    stepWallBurst(grid, species);

    expect(grid.specId[grid.index(1, 0)]).toBe(steel.specId);
  });
});
