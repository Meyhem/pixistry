import { describe, expect, it } from 'vitest';
import type { FilterAllow } from './filter';
import { EMPTY, PhaseCode, SimGrid, TubeMaskValue } from './grid';
import { AMBIENT_TEMPERATURE_K, energyForTemperature, massOf } from './heat';
import { stepMovement } from './movement';
import { mulberry32 } from './rng';
import { buildPalette, SpeciesTable, type PaletteEntry } from './species';
import { NO_FILTERS } from './filter';
import type { ConeHold } from './tube';
import { SpeciesId } from './species-data';
import { GLASS_WALL_SPEC_ID, WALL_PHASE } from './walls';

function findEntry(palette: PaletteEntry[], label: string): PaletteEntry {
  const entry = palette.find((p) => p.label === label);
  if (!entry) throw new Error(`no palette entry for ${label}`);
  return entry;
}

function countNonEmpty(grid: SimGrid): number {
  let count = 0;
  for (let i = 0; i < grid.width * grid.height; i++) {
    if (!grid.isEmptyAt(i)) count++;
  }
  return count;
}

describe('stepMovement', () => {
  it('a solid falls one row per tick through vacuum', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 5);
    grid.set(1, 0, iron.specId, iron.phase);
    const rng = mulberry32(1);

    for (let tick = 0; tick < 4; tick++) {
      stepMovement(grid, species, rng, tick);
      expect(grid.specId[grid.index(1, tick + 1)]).toBe(iron.specId);
    }
    // Resting on the floor, one more tick should not move it further.
    stepMovement(grid, species, rng, 4);
    expect(grid.specId[grid.index(1, 4)]).toBe(iron.specId);
  });

  it('a gas rises one row per tick through vacuum', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(3, 5);
    grid.set(1, 4, hydrogen.specId, hydrogen.phase);
    const rng = mulberry32(2);

    for (let tick = 0; tick < 4; tick++) {
      stepMovement(grid, species, rng, tick);
      expect(grid.specId[grid.index(1, 3 - tick)]).toBe(hydrogen.specId);
    }
  });

  it('a dense solid sinks through a liquid', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const water = findEntry(palette, 'H2O');
    expect(species.densityOf(iron.specId)).toBeGreaterThan(species.densityOf(water.specId));

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, iron.specId, iron.phase);
    grid.set(0, 1, water.specId, water.phase);
    const rng = mulberry32(3);

    stepMovement(grid, species, rng, 0);

    expect(grid.specId[grid.index(0, 1)]).toBe(iron.specId);
    expect(grid.specId[grid.index(0, 0)]).toBe(water.specId);
  });

  it('does not let a denser solid sink through a lighter solid -- solids stay statically mixed', () => {
    const species = new SpeciesTable();
    const palette = buildPalette();
    const silver = findEntry(palette, 'Ag'); // density 10.49
    const sodium = findEntry(palette, 'Na'); // density 0.97
    expect(species.densityOf(silver.specId)).toBeGreaterThan(species.densityOf(sodium.specId));

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, silver.specId, silver.phase);
    grid.set(0, 1, sodium.specId, sodium.phase);
    const rng = mulberry32(6);

    for (let tick = 0; tick < 10; tick++) stepMovement(grid, species, rng, tick);

    expect(grid.specId[grid.index(0, 0)]).toBe(silver.specId);
    expect(grid.specId[grid.index(0, 1)]).toBe(sodium.specId);
  });

  it('sinks a denser liquid below a lighter one', () => {
    const species = new SpeciesTable();
    expect(species.densityOf(SpeciesId.NaClAq)).toBeGreaterThan(species.densityOf(SpeciesId.H2O));

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, SpeciesId.NaClAq, PhaseCode.Liquid);
    grid.set(0, 1, SpeciesId.H2O, PhaseCode.Liquid);
    const rng = mulberry32(7);

    stepMovement(grid, species, rng, 0);

    expect(grid.specId[grid.index(0, 1)]).toBe(SpeciesId.NaClAq);
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.H2O);
  });

  it('lets boiled water (steam) rise through the liquid water it just came from (regression)', () => {
    // Before buoyantDensityOf existed, canDisplace compared densityOf's
    // single fixed table value for both cells -- a gas-phase H2O cell
    // reported the same density as the liquid water surrounding it, so
    // `fromDensity < targetDensity` was always false and steam could never
    // rise through its own liquid, just sat there looking identical to it.
    const species = new SpeciesTable();
    const thermal = species.thermalOf(SpeciesId.H2O);
    const mass = massOf(species, SpeciesId.H2O);
    const steam = energyForTemperature(thermal, mass, thermal.boilK + 50);
    expect(steam.phase).toBe(PhaseCode.Gas);
    const liquid = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
    expect(liquid.phase).toBe(PhaseCode.Liquid);

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, SpeciesId.H2O, liquid.phase, liquid.u);
    grid.set(0, 1, SpeciesId.H2O, steam.phase, steam.u);
    const rng = mulberry32(8);

    stepMovement(grid, species, rng, 0);

    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.H2O);
    expect(grid.phase[grid.index(0, 0)]).toBe(PhaseCode.Gas);
    expect(grid.phase[grid.index(0, 1)]).toBe(PhaseCode.Liquid);
  });

  it('conserves the number of occupied cells', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(8, 8);
    grid.set(2, 0, iron.specId, iron.phase);
    grid.set(5, 7, hydrogen.specId, hydrogen.phase);
    grid.set(4, 4, iron.specId, iron.phase);
    const before = countNonEmpty(grid);

    const rng = mulberry32(4);
    for (let tick = 0; tick < 10; tick++) stepMovement(grid, species, rng, tick);

    expect(countNonEmpty(grid)).toBe(before);
  });

  it('is deterministic for a given seed', () => {
    buildPalette();
    const species = new SpeciesTable();
    const palette = buildPalette();
    const iron = findEntry(palette, 'Fe');
    const hydrogen = findEntry(palette, 'H2');

    function run(): Uint16Array {
      const grid = new SimGrid(10, 10);
      grid.set(2, 0, iron.specId, iron.phase);
      grid.set(7, 9, hydrogen.specId, hydrogen.phase);
      grid.set(5, 3, iron.specId, iron.phase);
      const rng = mulberry32(99);
      for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick);
      return grid.specId.slice();
    }

    expect(run()).toEqual(run());
  });

  it('lets a lighter liquid rise out of an envelope of denser liquid resting on a solid (regression)', () => {
    // Before the lateral-mixing/buoyant-rise fix, moveFalling only tried to
    // move a liquid down/diagonal-down by density, or sideways into empty
    // space -- never sideways/upward past another liquid. A lighter liquid
    // pinned against a solid floor with denser liquid on every open side had
    // no legal move at all and sat frozen forever.
    const species = new SpeciesTable();
    expect(species.densityOf(SpeciesId.H2O2)).toBeGreaterThan(species.densityOf(SpeciesId.H2O)); // 1.45 vs 1.0

    const grid = new SimGrid(5, 6);
    // Solid floor.
    for (let x = 0; x < 5; x++) grid.set(x, 5, SpeciesId.Fe, PhaseCode.Solid);
    // Denser H2O2 pool filling everything above the floor.
    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 5; x++) grid.set(x, y, SpeciesId.H2O2, PhaseCode.Liquid);
    }
    // Lighter water, enveloped: resting on the floor, H2O2 on every side.
    grid.set(2, 4, SpeciesId.H2O, PhaseCode.Liquid);

    const rng = mulberry32(11);
    for (let tick = 0; tick < 400; tick++) stepMovement(grid, species, rng, tick);

    let waterY = -1;
    for (let y = 0; y < 6; y++) {
      for (let x = 0; x < 5; x++) {
        if (grid.specId[grid.index(x, y)] === SpeciesId.H2O) waterY = y;
      }
    }
    expect(waterY).toBeGreaterThanOrEqual(0);
    expect(waterY).toBeLessThan(4); // it moved up off the floor, not stuck
  });

  it('lets a lighter gas boxed in by denser gas find an off-center opening (regression)', () => {
    // moveRising's lateral fallback only spread into empty cells -- unlike
    // moveFalling's liquid<->liquid lateral mixing, it never swapped with an
    // occupied denser gas cell. A lighter gas pinned under a sealed ceiling
    // with no opening directly above or diagonally above it had no legal
    // move sideways to reach an opening elsewhere, and just sat frozen.
    const species = new SpeciesTable();
    expect(species.densityOf(SpeciesId.Cl2)).toBeGreaterThan(species.densityOf(SpeciesId.O2));

    const cl2Thermal = species.thermalOf(SpeciesId.Cl2);
    const cl2Mass = massOf(species, SpeciesId.Cl2);
    const cl2 = energyForTemperature(cl2Thermal, cl2Mass, AMBIENT_TEMPERATURE_K);
    const o2Thermal = species.thermalOf(SpeciesId.O2);
    const o2Mass = massOf(species, SpeciesId.O2);
    const o2 = energyForTemperature(o2Thermal, o2Mass, AMBIENT_TEMPERATURE_K);

    // 9-wide, 8-tall box: sealed glass ceiling except for a gap at the far
    // right (x=8). Cl2 fills everything below the ceiling; O2 sits pinned
    // at the far left, directly under the sealed part of the ceiling.
    const grid = new SimGrid(9, 8);
    for (let x = 0; x < 8; x++) grid.set(x, 0, GLASS_WALL_SPEC_ID, WALL_PHASE);
    for (let y = 1; y < 8; y++) {
      for (let x = 0; x < 9; x++) grid.set(x, y, SpeciesId.Cl2, cl2.phase, cl2.u);
    }
    grid.set(1, 1, SpeciesId.O2, o2.phase, o2.u);
    grid.set(1, 2, SpeciesId.O2, o2.phase, o2.u);

    const rng = mulberry32(11);
    for (let tick = 0; tick < 1000; tick++) stepMovement(grid, species, rng, tick);

    let o2MinY = grid.height;
    for (let i = 0; i < grid.width * grid.height; i++) {
      if (grid.specId[i] === SpeciesId.O2) o2MinY = Math.min(o2MinY, Math.floor(i / grid.width));
    }
    expect(o2MinY).toBe(0); // escaped through the opening, not stuck under the ceiling
  });

  it('never lets a falling solid displace into a tube lumen cell', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 5);
    grid.set(1, 0, iron.specId, iron.phase);
    grid.tubeMask[grid.index(1, 1)] = TubeMaskValue.Lumen;
    const rng = mulberry32(1);

    stepMovement(grid, species, rng, 0);
    // The lumen cell directly below stays empty -- displacement straight
    // down is blocked, though the solid may still fall diagonally past it.
    expect(grid.isEmptyAt(grid.index(1, 1))).toBe(true);
  });

  it('never moves a cell that is itself inside a tube lumen', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(3, 5);
    grid.set(1, 2, iron.specId, iron.phase);
    grid.tubeMask[grid.index(1, 2)] = TubeMaskValue.Lumen;
    const rng = mulberry32(1);

    stepMovement(grid, species, rng, 0);
    expect(grid.specId[grid.index(1, 2)]).toBe(iron.specId);
  });

  it('never moves a cell its tube is actually holding in the suction cone -- only stepTubes may pull it out', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');

    // Empty space all around so ordinary gravity/lateral spread would
    // otherwise happily move this liquid every which way.
    const grid = new SimGrid(5, 5);
    grid.set(2, 2, water.specId, water.phase);
    grid.tubeMask[grid.index(2, 2)] = TubeMaskValue.Cone;
    const hold: ConeHold = new Map([[grid.index(2, 2), null]]); // null = tube takes anything
    const rng = mulberry32(1);

    for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick, NO_FILTERS, hold);
    expect(grid.specId[grid.index(2, 2)]).toBe(water.specId);
  });

  it('still falls out of a cone cell its tube would never pull -- a hold the tube will not honour is a cell frozen in mid-air', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');
    const salt = findEntry(palette, 'NaCl');

    const grid = new SimGrid(5, 5);
    grid.set(2, 2, salt.specId, salt.phase);
    grid.tubeMask[grid.index(2, 2)] = TubeMaskValue.Cone;
    // The owning tube's filter only takes water, so this grain of salt is
    // not held -- ordinary gravity has to keep working on it.
    const hold: ConeHold = new Map([[grid.index(2, 2), new Set([water.specId])]]);
    const rng = mulberry32(1);

    for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick, NO_FILTERS, hold);
    expect(grid.isEmptyAt(grid.index(2, 2))).toBe(true);
    expect(grid.specId[grid.index(2, 4)]).toBe(salt.specId); // fell to the floor
  });

  it('does not freeze a cone cell no tube claims -- a stale mask must not strand matter forever', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(5, 5);
    grid.set(2, 2, water.specId, water.phase);
    grid.tubeMask[grid.index(2, 2)] = TubeMaskValue.Cone;
    const rng = mulberry32(1);

    for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick);
    expect(grid.isEmptyAt(grid.index(2, 2))).toBe(true);
  });

  it('still lets ordinary movement fall/spread INTO a cone cell from outside it', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const water = findEntry(palette, 'H2O');

    const grid = new SimGrid(3, 5);
    grid.set(1, 0, water.specId, water.phase);
    grid.tubeMask[grid.index(1, 1)] = TubeMaskValue.Cone;
    const rng = mulberry32(2);

    stepMovement(grid, species, rng, 0);
    expect(grid.specId[grid.index(1, 1)]).toBe(water.specId);
    expect(grid.isEmptyAt(grid.index(1, 0))).toBe(true);
  });

  it('blocks a solid from falling straight into a filtered cell unless its species is allowed', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const iron = findEntry(palette, 'Fe');

    const grid = new SimGrid(1, 2);
    grid.set(0, 0, iron.specId, iron.phase);
    grid.filterMask[grid.index(0, 1)] = 1;
    const rng = mulberry32(1);

    stepMovement(grid, species, rng, 0);
    expect(grid.specId[grid.index(0, 0)]).toBe(iron.specId); // no allow-list -- blocked, stayed put

    stepMovement(grid, species, rng, 1, new Map([[1, new Set([iron.specId])]]));
    expect(grid.specId[grid.index(0, 1)]).toBe(iron.specId); // now allowed -- passed through
  });

  it('blocks a gas from rising straight into a filtered cell unless its species is allowed', () => {
    const palette = buildPalette();
    const species = new SpeciesTable();
    const hydrogen = findEntry(palette, 'H2');

    const grid = new SimGrid(1, 2);
    grid.set(0, 1, hydrogen.specId, hydrogen.phase);
    grid.filterMask[grid.index(0, 0)] = 1;
    const rng = mulberry32(2);

    stepMovement(grid, species, rng, 0);
    expect(grid.specId[grid.index(0, 1)]).toBe(hydrogen.specId); // no allow-list -- blocked

    stepMovement(grid, species, rng, 1, new Map([[1, new Set([hydrogen.specId])]]));
    expect(grid.specId[grid.index(0, 0)]).toBe(hydrogen.specId); // now allowed -- passed through
  });

  it('blocks lateral liquid spread into a filtered cell unless its species is allowed', () => {
    // moveFalling's lateral-spread loop checks isEmptyAt/isWallSpecId
    // directly rather than going through canDisplace/blockedTarget, so this
    // exercises a different code path than the straight-fall test above.
    const species = new SpeciesTable();

    function run(filterAllow: FilterAllow | undefined): { reachedFiltered: boolean; reachedOpen: boolean } {
      const grid = new SimGrid(5, 2);
      for (let x = 0; x < 5; x++) grid.set(x, 1, SpeciesId.Fe, PhaseCode.Solid);
      grid.set(2, 0, SpeciesId.H2O, PhaseCode.Liquid);
      grid.filterMask[grid.index(1, 0)] = 1; // left neighbor is filtered, right neighbor is open
      const rng = mulberry32(42);
      let reachedFiltered = false;
      let reachedOpen = false;
      for (let tick = 0; tick < 300; tick++) {
        stepMovement(grid, species, rng, tick, filterAllow);
        if (grid.specId[grid.index(1, 0)] === SpeciesId.H2O) reachedFiltered = true;
        if (grid.specId[grid.index(3, 0)] === SpeciesId.H2O) reachedOpen = true;
      }
      return { reachedFiltered, reachedOpen };
    }

    const blocked = run(undefined);
    expect(blocked.reachedFiltered).toBe(false);
    expect(blocked.reachedOpen).toBe(true); // spread still works on the unfiltered side, proving movement wasn't just frozen

    const allowed = run(new Map([[1, new Set([SpeciesId.H2O])]]));
    expect(allowed.reachedFiltered).toBe(true);
  });

  it('never lets a falling solid cut the corner of a diagonal wall (regression: "falling through glass")', () => {
    // The mover is boxed in by two wall pixels meeting at a corner: one
    // directly below it, one directly beside it. The open cell diagonally
    // between them is inside the vessel, and a single diagonal step used to
    // reach it -- matter slipping through a sealed wall without ever passing
    // its mouth. This is why the flask's vesselMask existed; the corner rule
    // replaces it and covers hand-drawn diagonal glass too.
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 3);
    grid.set(0, 1, GLASS_WALL_SPEC_ID, WALL_PHASE); // below the mover
    grid.set(1, 0, GLASS_WALL_SPEC_ID, WALL_PHASE); // beside the mover
    grid.set(0, 0, SpeciesId.Fe, PhaseCode.Solid); // the mover, in the corner's outside
    const rng = mulberry32(1);

    for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick);

    expect(grid.isEmptyAt(grid.index(1, 1))).toBe(true); // never squeezed through the corner
    expect(grid.specId[grid.index(0, 0)]).toBe(SpeciesId.Fe);
  });

  it('still lets a grain slide past a wall corner with one open side', () => {
    // The same geometry minus the second wall pixel: only one of the two
    // shared orthogonal neighbours is blocked, so this is an ordinary outer
    // corner and the grain must still slide around it as it piles up.
    const species = new SpeciesTable();
    const grid = new SimGrid(3, 3);
    grid.set(0, 1, GLASS_WALL_SPEC_ID, WALL_PHASE); // below the mover; (1,0) stays open
    grid.set(0, 0, SpeciesId.Fe, PhaseCode.Solid);
    const rng = mulberry32(1);

    for (let tick = 0; tick < 20; tick++) stepMovement(grid, species, rng, tick);

    expect(grid.specId[grid.index(0, 0)]).not.toBe(SpeciesId.Fe); // it got past the corner
  });

  it('holds liquid and gas inside a sealed one-pixel diagonal vessel indefinitely', () => {
    // A diamond of single-pixel diagonal glass: every wall run is 1px and
    // every corner is a 45-degree join, which is the shape hand-drawn
    // glassware makes and the shape that leaked on main (vesselMask only ever
    // covered stamped flasks, never the Glass tool's own vessels).
    const species = new SpeciesTable();
    const grid = new SimGrid(21, 21);
    const cx = 10;
    const cy = 10;
    const r = 7;
    for (let k = 0; k <= r; k++) {
      for (const [x, y] of [
        [cx - r + k, cy - k],
        [cx + r - k, cy - k],
        [cx - r + k, cy + k],
        [cx + r - k, cy + k],
      ]) {
        grid.set(x as number, y as number, GLASS_WALL_SPEC_ID, WALL_PHASE);
      }
    }
    const inside: number[] = [];
    for (let y = cy - 3; y <= cy + 3; y++) {
      for (let x = cx - 3; x <= cx + 3; x++) inside.push(grid.index(x, y));
    }
    for (const idx of inside.slice(0, 24)) grid.setAt(idx, SpeciesId.H2O, PhaseCode.Liquid, 0);
    for (const idx of inside.slice(24)) grid.setAt(idx, SpeciesId.H2, PhaseCode.Gas, 0);
    const contained = inside.length;
    const rng = mulberry32(9);

    for (let tick = 0; tick < 2000; tick++) stepMovement(grid, species, rng, tick);

    let still = 0;
    for (let i = 0; i < grid.specId.length; i++) {
      if (grid.specId[i] === SpeciesId.H2O || grid.specId[i] === SpeciesId.H2) still++;
    }
    expect(still).toBe(contained); // conservation, and nothing escaped the diamond
    let outside = 0;
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        const i = grid.index(x, y);
        if (grid.specId[i] !== SpeciesId.H2O && grid.specId[i] !== SpeciesId.H2) continue;
        if (Math.abs(x - cx) + Math.abs(y - cy) >= r) outside++;
      }
    }
    expect(outside).toBe(0);
  });

  it('leaves EMPTY untouched when the grid is all vacuum', () => {
    const species = new SpeciesTable();
    const grid = new SimGrid(4, 4);
    const rng = mulberry32(5);
    stepMovement(grid, species, rng, 0);
    for (let i = 0; i < grid.width * grid.height; i++) {
      expect(grid.specId[i]).toBe(EMPTY);
    }
  });
});
