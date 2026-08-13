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

export class SimGrid {
  readonly width: number;
  readonly height: number;
  readonly specId: Uint16Array;
  readonly u: Float32Array;
  readonly phase: Uint8Array;
  /** Heater/cooler radiator wattage per cell (0 = none, sign gives
   * heater/cooler) -- entirely separate from specId/phase/u and deliberately
   * untouched by set/clear/swap, so a radiator is a fixed background field
   * rather than matter: it doesn't move, doesn't occupy the movement grid's
   * collision slot, and coexists with whatever species (or nothing) passes
   * through the same cell. See heat.ts's stepRadiators and radiators.ts. */
  readonly radiator: Int16Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    const size = width * height;
    this.specId = new Uint16Array(size).fill(EMPTY);
    this.u = new Float32Array(size);
    this.phase = new Uint8Array(size);
    this.radiator = new Int16Array(size);
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
