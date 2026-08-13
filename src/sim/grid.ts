// Flat typed-array grid, per the design doc's cell layout:
// { specId: u16, U: f32, phase }. EMPTY is a sentinel
// specId (0xffff) rather than a valid pool index -- specId 0 is a real
// interned species (H2, since it's the first one built in species.ts).

export const EMPTY = 0xffff;

export enum PhaseCode {
  Empty = 0,
  Solid = 1,
  Liquid = 2,
  Gas = 3,
}

export enum TubeMaskValue {
  None = 0,
  Lumen = 1,
  Cone = 2,
}

export class SimGrid {
  readonly width: number;
  readonly height: number;
  readonly specId: Uint16Array;
  readonly u: Float32Array;
  readonly phase: Uint8Array;
  /** Heater/cooler radiator overlay -- entirely separate from specId/phase/u
   * and deliberately untouched by set/clear/swap, so a radiator is a fixed
   * background field rather than matter: it doesn't move, doesn't occupy
   * the movement grid's collision slot, and coexists with whatever species
   * (or nothing) passes through the same cell. radiatorRadius is 0 where no
   * radiator is placed; where nonzero it's that cell's radiation reach, and
   * radiatorTargetK is its target temperature -- both are a snapshot of the
   * side panel's sliders taken once, at paint time (see worker.ts's
   * 'paintRadiator' handler), so moving those sliders afterward never
   * retroactively changes a radiator already on the grid. See heat.ts's
   * stepRadiators and radiators.ts. */
  readonly radiatorRadius: Uint8Array;
  readonly radiatorTargetK: Float32Array;
  /** Stirrer apparatus overlay -- same "fixed background field, not matter"
   * convention as radiatorRadius above: painted once by the stirrer tool
   * (see worker.ts's 'paintStirrer' handler) into a per-cell flag (nonzero
   * = inside a drawn stirrer shape), left untouched by set/clear/swap, and
   * read every tick by stirrer.ts's stepStirrers to keep randomizing
   * whatever liquid/gas cells sit inside it. */
  readonly stirrerMask: Uint8Array;
  /** Conveyor-tube overlay -- same "fixed background field, not matter"
   * convention as radiatorRadius/stirrerMask above: painted once by
   * placeTubeInstance/moveTubeKnee/moveTubeSegment (see tube.ts), left
   * untouched by set/clear/swap, and read every tick by both movement.ts
   * (a lumen cell is never a valid destination for ordinary falling-sand
   * movement -- only stepTubes moves matter along it) and tube.ts's
   * stepTubes (which walks the lumen and pulls matching cells through the
   * cone). TubeMaskValue.None everywhere a tube isn't drawn. */
  readonly tubeMask: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const size = width * height;
    this.specId = new Uint16Array(size).fill(EMPTY);
    this.u = new Float32Array(size);
    this.phase = new Uint8Array(size);
    this.radiatorRadius = new Uint8Array(size);
    this.radiatorTargetK = new Float32Array(size);
    this.stirrerMask = new Uint8Array(size);
    this.tubeMask = new Uint8Array(size);
  }

  index(x: number, y: number): number {
    return y * this.width + x;
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  isEmptyAt(idx: number): boolean {
    return this.specId[idx] === EMPTY;
  }

  set(x: number, y: number, specId: number, phase: PhaseCode, u = 0): void {
    this.setAt(this.index(x, y), specId, phase, u);
  }

  clear(x: number, y: number): void {
    this.clearAt(this.index(x, y));
  }

  setAt(idx: number, specId: number, phase: PhaseCode, u = 0): void {
    this.specId[idx] = specId;
    this.phase[idx] = phase;
    this.u[idx] = u;
  }

  clearAt(idx: number): void {
    this.specId[idx] = EMPTY;
    this.phase[idx] = PhaseCode.Empty;
    this.u[idx] = 0;
  }

  swap(i: number, j: number): void {
    const specId = this.specId[i] as number;
    const phase = this.phase[i] as number;
    const u = this.u[i] as number;
    this.specId[i] = this.specId[j] as number;
    this.phase[i] = this.phase[j] as number;
    this.u[i] = this.u[j] as number;
    this.specId[j] = specId;
    this.phase[j] = phase;
    this.u[j] = u;
  }
}
