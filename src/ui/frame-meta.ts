// One-pass scan over a live frame's specId/phase/tempK arrays -- computes
// everything app.ts's species-discovery tracking (see cabinet.ts) and
// achievement checks (see achievements.ts) need, without walking the grid
// (16,000 cells at 160x100) more than once per frame for each concern.
import { EMPTY, PhaseCode } from '../sim/grid';
import { SpeciesId } from '../sim/species-data';

export interface FrameMeta {
  /** Every distinct non-empty specId present on the grid this frame. */
  readonly presentSpecIds: ReadonlySet<number>;
  /** Highest live cell temperature this frame, in Kelvin (0 if the grid is
   * entirely empty). */
  readonly maxTempK: number;
  /** Count of liquid-phase H2O cells this frame -- see achievements.ts's
   * "Made It Rain". */
  readonly liquidH2OCount: number;
}

export function scanFrameMeta(specId: Uint16Array, phase: Uint8Array, tempK: Float32Array): FrameMeta {
  const presentSpecIds = new Set<number>();
  let maxTempK = 0;
  let liquidH2OCount = 0;
  for (let idx = 0; idx < specId.length; idx++) {
    const id = specId[idx] as number;
    if (id === EMPTY) continue;
    presentSpecIds.add(id);
    const t = tempK[idx] as number;
    if (t > maxTempK) maxTempK = t;
    if (id === SpeciesId.H2O && phase[idx] === PhaseCode.Liquid) liquidH2OCount++;
  }
  return { presentSpecIds, maxTempK, liquidH2OCount };
}
