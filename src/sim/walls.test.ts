import { describe, expect, it } from 'vitest';
import { EMPTY } from './grid';
import { getWall, isWallSpecId, wallList, wallThermalProfile, WALL_SPEC_BASE } from './walls';

describe('walls', () => {
  it('reserves a specId range disjoint from real chemistry species and below EMPTY', () => {
    expect(WALL_SPEC_BASE).toBeGreaterThan(1000);
    expect(WALL_SPEC_BASE).toBeLessThan(EMPTY);
    for (const wall of wallList()) {
      expect(wall.specId).toBeGreaterThanOrEqual(WALL_SPEC_BASE);
      expect(wall.specId).toBeLessThan(EMPTY);
    }
  });

  it('exposes exactly glass, steel, insulator, heater-glass, cooler-glass', () => {
    const kinds = wallList().map((w) => w.kind);
    expect(kinds).toEqual(['glass', 'steel', 'insulator', 'heater-glass', 'cooler-glass']);
  });

  it('only heater-glass/cooler-glass carry a nonzero radiatorWatts, with opposite signs', () => {
    for (const wall of wallList()) {
      if (wall.kind === 'heater-glass') expect(wall.radiatorWatts).toBeGreaterThan(0);
      else if (wall.kind === 'cooler-glass') expect(wall.radiatorWatts).toBeLessThan(0);
      else expect(wall.radiatorWatts).toBe(0);
    }
  });

  it('isWallSpecId identifies the wall range and excludes chemistry/EMPTY specIds', () => {
    expect(isWallSpecId(0)).toBe(false);
    expect(isWallSpecId(15)).toBe(false);
    expect(isWallSpecId(WALL_SPEC_BASE)).toBe(true);
    expect(isWallSpecId(WALL_SPEC_BASE + 2)).toBe(true);
    expect(isWallSpecId(EMPTY)).toBe(false);
  });

  it('getWall round-trips each wall by specId', () => {
    for (const wall of wallList()) {
      expect(getWall(wall.specId)).toBe(wall);
    }
  });

  it('getWall throws for a specId outside the table', () => {
    expect(() => getWall(WALL_SPEC_BASE + 99)).toThrow();
  });

  it('produces a thermal profile with an unreachable melt/boil point', () => {
    const steel = getWall(WALL_SPEC_BASE + 1);
    const thermal = wallThermalProfile(steel);
    expect(thermal.meltK).toBeGreaterThan(1e6);
    expect(thermal.thermalConductivitySolid).toBe(steel.thermalConductivity);
    expect(thermal.density).toBe(steel.density);
  });
});
