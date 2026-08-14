// Hand-authored pixel shape for the premade Erlenmeyer-flask apparatus: a
// conical body (straight sloped sides, flat closed base) narrowing up into a
// straight glass neck with an open mouth at the top -- same "outline only,
// not a filled triangle" convention as the funnel (apparatus-shapes.ts),
// so the flask is a hollow vessel with real matter poured in through its
// mouth. Unlike the funnel there's no spout: the base row is fully closed
// (a real Erlenmeyer sits sealed on a benchtop), only the neck's top is open.
//
// The canonical shape is authored once for facing "up" (mouth up, base
// resting at the anchor) at sizeScale 1, then rotated for the other 7
// facings and scaled uniformly for other sizes -- see flaskShapeFor.
import type { Offset } from './apparatus-shapes';

export type FlaskFacing = 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left';

export const FLASK_FACINGS: readonly FlaskFacing[] = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];

export const MIN_FLASK_SIZE_SCALE = 0.5;
export const MAX_FLASK_SIZE_SCALE = 2.0;
export const DEFAULT_FLASK_SIZE_SCALE = 1.0;

const NECK_HALF_WIDTH = 3; // half-width of the straight neck -> 7px across at scale 1 (+50% over the original 5px)
const BASE_HALF_WIDTH = 12; // half-width of the flat base -> 25px across at scale 1
const CONE_ROWS = 16; // rows the conical body tapers over, from base up to the neck
const NECK_ROWS = 10; // straight neck rows above the cone

interface ScaledProfile {
  readonly neckHalfWidth: number;
  readonly baseHalfWidth: number;
  readonly coneRows: number;
  readonly neckRows: number;
  readonly bodyRows: number;
}

function scaledProfile(sizeScale: number): ScaledProfile {
  const neckHalfWidth = Math.max(1, Math.round(NECK_HALF_WIDTH * sizeScale));
  const baseHalfWidth = Math.max(neckHalfWidth + 1, Math.round(BASE_HALF_WIDTH * sizeScale));
  const coneRows = Math.max(1, Math.round(CONE_ROWS * sizeScale));
  const neckRows = Math.max(1, Math.round(NECK_ROWS * sizeScale));
  return { neckHalfWidth, baseHalfWidth, coneRows, neckRows, bodyRows: coneRows + neckRows };
}

/** Canonical "facing up" outline at the given size: a closed flat base row
 * at the anchor (dy = 0), the conical body tapering upward (dy < 0) into a
 * straight neck, open at its top row (mouth). */
function buildCanonicalCells(p: ScaledProfile): Offset[] {
  const cells: Offset[] = [];
  for (let row = 0; row < p.neckRows; row++) {
    const dy = -(p.bodyRows - row);
    cells.push({ dx: -p.neckHalfWidth, dy });
    cells.push({ dx: p.neckHalfWidth, dy });
  }
  for (let row = 0; row < p.coneRows; row++) {
    const t = p.coneRows === 1 ? 1 : row / (p.coneRows - 1);
    const halfWidth = Math.round(p.neckHalfWidth + (p.baseHalfWidth - p.neckHalfWidth) * t);
    const dy = -(p.coneRows - row);
    cells.push({ dx: -halfWidth, dy });
    cells.push({ dx: halfWidth, dy });
  }
  for (let dx = -p.baseHalfWidth; dx <= p.baseHalfWidth; dx++) cells.push({ dx, dy: 0 });
  return cells;
}

/** The flask's open interior per canonical row (strictly between the two
 * wall edges, one cell short on each side) -- used for the stirred variant's
 * stirrerMask paint region (see worker.ts's 'placeFlask' handler). Excludes
 * the closed base row, which has no interior of its own. */
function buildCanonicalReservoirCells(p: ScaledProfile): Offset[] {
  const cells: Offset[] = [];
  for (let row = 0; row < p.neckRows; row++) {
    const dy = -(p.bodyRows - row);
    for (let dx = -(p.neckHalfWidth - 1); dx <= p.neckHalfWidth - 1; dx++) cells.push({ dx, dy });
  }
  for (let row = 0; row < p.coneRows; row++) {
    const t = p.coneRows === 1 ? 1 : row / (p.coneRows - 1);
    const halfWidth = Math.round(p.neckHalfWidth + (p.baseHalfWidth - p.neckHalfWidth) * t);
    const dy = -(p.coneRows - row);
    for (let dx = -(halfWidth - 1); dx <= halfWidth - 1; dx++) cells.push({ dx, dy });
  }
  return cells;
}

/** Rotates a canonical ("facing up") offset by the facing's angle (a
 * multiple of 45 degrees) via a standard rotation matrix, rounded to the
 * nearest grid cell. Exact for the 4 cardinal facings (cos/sin of 0/90/180/
 * 270 degrees round cleanly); the 4 diagonal facings are an approximation --
 * matrix-rotated-and-rounded rather than a hand-tuned raster, so they read
 * very slightly less crisp than the cardinal orientations. Acceptable for
 * v1; easy to replace with hand-authored diagonal offsets later if it looks
 * poor in practice. */
export function rotateFlaskOffset(offset: Offset, facing: FlaskFacing): Offset {
  const index = FLASK_FACINGS.indexOf(facing);
  const theta = (index * Math.PI) / 4;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    dx: Math.round(offset.dx * cos - offset.dy * sin),
    dy: Math.round(offset.dx * sin + offset.dy * cos),
  };
}

export function nextFlaskFacing(current: FlaskFacing, delta: number): FlaskFacing {
  const idx = FLASK_FACINGS.indexOf(current);
  const next = (idx + delta + FLASK_FACINGS.length) % FLASK_FACINGS.length;
  return FLASK_FACINGS[next] as FlaskFacing;
}

export interface FlaskShape {
  readonly cells: readonly Offset[];
  readonly reservoirCells: readonly Offset[];
}

export function flaskShapeFor(facing: FlaskFacing, sizeScale: number): FlaskShape {
  const p = scaledProfile(sizeScale);
  const cells = buildCanonicalCells(p).map((o) => rotateFlaskOffset(o, facing));
  const reservoirCells = buildCanonicalReservoirCells(p).map((o) => rotateFlaskOffset(o, facing));
  return { cells, reservoirCells };
}

/** Bounding box of cells+reservoirCells together, in offsets from the
 * anchor -- used for the ghost preview's client-side sizing, same role as
 * apparatus-shapes.ts's funnelBounds. */
export function flaskBounds(shape: FlaskShape): { minDx: number; maxDx: number; minDy: number; maxDy: number } {
  let minDx = 0;
  let maxDx = 0;
  let minDy = 0;
  let maxDy = 0;
  for (const { dx, dy } of [...shape.cells, ...shape.reservoirCells]) {
    if (dx < minDx) minDx = dx;
    if (dx > maxDx) maxDx = dx;
    if (dy < minDy) minDy = dy;
    if (dy > maxDy) maxDy = dy;
  }
  return { minDx, maxDx, minDy, maxDy };
}
