import { describe, expect, it } from 'vitest';
import { COOLER_WATTS, HEATER_WATTS, RADIATORS, radiatorFor } from './radiators';

describe('radiators', () => {
  it('exposes a heater and a cooler with opposite-signed wattage', () => {
    expect(RADIATORS.map((r) => r.sign)).toEqual([1, -1]);
    expect(HEATER_WATTS).toBeGreaterThan(0);
    expect(COOLER_WATTS).toBeLessThan(0);
  });

  it('radiatorFor round-trips each kind by sign', () => {
    for (const r of RADIATORS) expect(radiatorFor(r.sign)).toBe(r);
  });
});
