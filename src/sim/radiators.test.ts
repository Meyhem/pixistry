import { describe, expect, it } from 'vitest';
import { RADIATOR_WATTS } from './radiators';

describe('radiators', () => {
  it('exposes a positive radiation magnitude shared by every placed radiator', () => {
    expect(RADIATOR_WATTS).toBeGreaterThan(0);
  });
});
