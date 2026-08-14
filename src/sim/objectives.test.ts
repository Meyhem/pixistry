// Pure evaluateGoals tests -- no grid, no worker, just synthetic snapshots.
// See objectives.ts's doc comment for why this stays gridless.
import { describe, expect, it } from 'vitest';
import { evaluateGoals, type GoalHistoryEntry, type GoalSnapshot } from './objectives';
import { SPECIES } from './species-data';

const NA_CL = 16; // SpeciesId.NaCl, avoiding a species-data import purely for readability here
const H2O = 15;

function snapshot(overrides: Partial<GoalSnapshot> = {}): GoalSnapshot {
  return {
    totals: new Uint32Array(SPECIES.length),
    history: [],
    tick: 0,
    maxTempK: 0,
    ...overrides,
  };
}

describe('evaluateGoals: collect', () => {
  it('is incomplete below the target amount', () => {
    const totals = new Uint32Array(SPECIES.length);
    totals[NA_CL] = 50;
    const [progress] = evaluateGoals([{ kind: 'collect', specId: NA_CL, amount: 100 }], snapshot({ totals }));
    expect(progress).toMatchObject({ current: 50, complete: false });
  });

  it('completes at or above the target amount', () => {
    const totals = new Uint32Array(SPECIES.length);
    totals[NA_CL] = 100;
    const [progress] = evaluateGoals([{ kind: 'collect', specId: NA_CL, amount: 100 }], snapshot({ totals }));
    expect(progress).toMatchObject({ current: 100, complete: true });
  });
});

describe('evaluateGoals: collectAny', () => {
  it('sums across every listed species', () => {
    const totals = new Uint32Array(SPECIES.length);
    totals[NA_CL] = 30;
    totals[H2O] = 25;
    const [progress] = evaluateGoals([{ kind: 'collectAny', specIds: [NA_CL, H2O], amount: 50 }], snapshot({ totals }));
    expect(progress).toMatchObject({ current: 55, complete: true });
  });
});

describe('evaluateGoals: purity', () => {
  it('is the fraction of everything sunk, not just the raw count', () => {
    const totals = new Uint32Array(SPECIES.length);
    totals[NA_CL] = 90;
    totals[H2O] = 10;
    const [progress] = evaluateGoals([{ kind: 'purity', specId: NA_CL, minFraction: 0.9 }], snapshot({ totals }));
    expect(progress).toMatchObject({ currentFraction: 0.9, complete: true });
  });

  it('is 0, not NaN, when nothing has been sunk yet', () => {
    const [progress] = evaluateGoals([{ kind: 'purity', specId: NA_CL, minFraction: 0.5 }], snapshot());
    expect(progress).toMatchObject({ currentFraction: 0, complete: false });
  });
});

describe('evaluateGoals: limit', () => {
  it('fails once the tracked species exceeds the max', () => {
    const totals = new Uint32Array(SPECIES.length);
    totals[H2O] = 31;
    const [progress] = evaluateGoals([{ kind: 'limit', specId: H2O, max: 30 }], snapshot({ totals }));
    expect(progress).toMatchObject({ current: 31, failed: true });
  });

  it('does not fail exactly at the max', () => {
    const totals = new Uint32Array(SPECIES.length);
    totals[H2O] = 30;
    const [progress] = evaluateGoals([{ kind: 'limit', specId: H2O, max: 30 }], snapshot({ totals }));
    expect(progress).toMatchObject({ current: 30, failed: false });
  });
});

describe('evaluateGoals: maxTempK', () => {
  it('fails once the observed max temperature exceeds the limit', () => {
    const [progress] = evaluateGoals([{ kind: 'maxTempK', limitK: 500 }], snapshot({ maxTempK: 501 }));
    expect(progress).toMatchObject({ currentMaxK: 501, failed: true });
  });

  it('does not fail at or below the limit', () => {
    const [progress] = evaluateGoals([{ kind: 'maxTempK', limitK: 500 }], snapshot({ maxTempK: 500 }));
    expect(progress).toMatchObject({ failed: false });
  });
});

describe('evaluateGoals: rate', () => {
  function historyAt(tick: number, count: number): GoalHistoryEntry {
    const totals = new Uint32Array(SPECIES.length);
    totals[NA_CL] = count;
    return { tick, totals };
  }

  it('reports 0 and incomplete with no history', () => {
    const [progress] = evaluateGoals([{ kind: 'rate', specId: NA_CL, perSecond: 10, sustainSeconds: 5 }], snapshot());
    expect(progress).toMatchObject({ currentRatePerSecond: 0, sustainedSeconds: 0, complete: false });
  });

  it('sustains across a run of seconds each meeting the target rate', () => {
    // 10/s for 3 straight one-second steps (60 ticks apart), ending at "now".
    const history = [historyAt(0, 0), historyAt(60, 10), historyAt(120, 20), historyAt(180, 30)];
    const [progress] = evaluateGoals([{ kind: 'rate', specId: NA_CL, perSecond: 10, sustainSeconds: 3 }], snapshot({ history }));
    expect(progress).toMatchObject({ currentRatePerSecond: 10, sustainedSeconds: 3, complete: true });
  });

  it('stops accumulating at the first second that falls below the target rate', () => {
    // Held 10/s for two seconds, then dropped to 2/s for the most recent one.
    const history = [historyAt(0, 0), historyAt(60, 10), historyAt(120, 20), historyAt(180, 22)];
    const [progress] = evaluateGoals([{ kind: 'rate', specId: NA_CL, perSecond: 10, sustainSeconds: 3 }], snapshot({ history }));
    expect(progress).toMatchObject({ currentRatePerSecond: 2, sustainedSeconds: 0, complete: false });
  });
});
