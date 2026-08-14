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

  it('exposes exactly glass', () => {
    const kinds = wallList().map((w) => w.kind);
    expect(kinds).toEqual(['glass']);
  });

  it('isWallSpecId identifies the wall range and excludes chemistry/EMPTY specIds', () => {
    expect(isWallSpecId(0)).toBe(false);
    expect(isWallSpecId(15)).toBe(false);
    // The whole reserved range reads as "a wall", not just the entries the
    // table currently fills -- movement/heat branch on the range, so a future
    // material must not need those checks widened.
    expect(isWallSpecId(WALL_SPEC_BASE)).toBe(true);
    expect(isWallSpecId(WALL_SPEC_BASE + 1)).toBe(true);
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
    const glass = getWall(WALL_SPEC_BASE);
    const thermal = wallThermalProfile(glass);
    expect(thermal.meltK).toBeGreaterThan(1e6);
    expect(thermal.thermalConductivitySolid).toBe(glass.thermalConductivity);
    expect(thermal.density).toBe(glass.density);
  });
});
