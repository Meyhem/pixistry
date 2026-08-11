import { describe, expect, it } from 'vitest';
import { evansPolanyiEa, R, reactionProbability } from './kinetics';

describe('evansPolanyiEa', () => {
  it('is never negative even for very exothermic reactions', () => {
    expect(evansPolanyiEa(50, -1000)).toBe(0);
  });

  it('increases with bonds broken and with less-negative (or positive) deltaH', () => {
    const weak = evansPolanyiEa(100, -50);
    const strong = evansPolanyiEa(400, -50);
    expect(strong).toBeGreaterThan(weak);

    const exothermic = evansPolanyiEa(200, -100);
    const endothermic = evansPolanyiEa(200, 100);
    expect(endothermic).toBeGreaterThan(exothermic);
  });

  it('matches the documented formula for a representative case', () => {
    // Ea = 0.5*bondsBroken + 0.3*deltaH
    expect(evansPolanyiEa(400, 100)).toBeCloseTo(0.5 * 400 + 0.3 * 100, 6);
  });
});

describe('reactionProbability', () => {
  it('is 1 when Ea is 0', () => {
    expect(reactionProbability(0, 298)).toBe(1);
  });

  it('is in (0, 1] for positive Ea and positive T', () => {
    const p = reactionProbability(200, 298);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThanOrEqual(1);
  });

  it('is 0 at absolute-zero-or-below temperature', () => {
    expect(reactionProbability(50, 0)).toBe(0);
    expect(reactionProbability(50, -10)).toBe(0);
  });

  it('increases monotonically with temperature for fixed Ea', () => {
    const low = reactionProbability(200, 298);
    const mid = reactionProbability(200, 800);
    const high = reactionProbability(200, 2000);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
  });

  it('decreases monotonically with Ea for fixed T', () => {
    const small = reactionProbability(50, 500);
    const large = reactionProbability(300, 500);
    expect(small).toBeGreaterThan(large);
  });

  it('produces near-zero probability at room temperature for a high-Ea bond (e.g. N2 dissociation-scale)', () => {
    const p = reactionProbability(900, 298);
    expect(p).toBeLessThan(1e-100);
  });

  it('produces a substantial probability at combustion-scale temperatures for a moderate Ea', () => {
    const p = reactionProbability(80, 1500);
    expect(p).toBeGreaterThan(1e-4);
  });

  it('uses the exact gas constant value', () => {
    expect(R).toBeCloseTo(0.0083145, 7);
  });
});
