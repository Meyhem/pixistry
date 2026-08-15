// Hand-authored pixel shapes for the premade glassware apparatus -- two
// kinds, both hollow open-topped vessels built from the same "outline only,
// not a filled shape" convention as the funnel (apparatus-shapes.ts), so
// real matter is poured in through the mouth:
//
//   'erlenmeyer' -- a conical body (straight sloped sides, flat closed base)
//                   narrowing up into a straight glass neck.
//   'beaker'     -- straight vertical walls on a flat closed base, mouth as
//                   wide as the body.
//   'sepfunnel'  -- a separating funnel: a wide conical mouth tapering down
//                   into a narrow stem whose bottom row is an aperture
//                   (apertureCells) the instance can open and close, like a
//                   real stopcock. The other two kinds have no aperture.
//
// Unlike the funnel neither of the first two has a spout: the base row is
// fully closed (real glassware sits sealed on a benchtop), only the top row
// is open. The sep funnel's base is its aperture -- sealed with glass while
// closed, empty while open, decided by the instance (see flask.ts's
// flaskFootprint), not baked into the shape.
//
// The canonical shape is authored once for facing "up" (mouth up, base
// resting at the anchor) at sizeScale 1, then rotated for the other 7
// facings and scaled uniformly for other sizes -- see flaskShapeFor.
import type { Offset } from './apparatus-shapes';

export type FlaskFacing = 'up' | 'up-right' | 'right' | 'down-right' | 'down' | 'down-left' | 'left' | 'up-left';

/** Which piece of glassware the flask tool stamps. All kinds share the tool,
 * the facing/size settings and the stirred toggle -- only the outline (and,
 * for the sep funnel, the openable aperture) differs. */
export type FlaskKind = 'erlenmeyer' | 'beaker' | 'sepfunnel';

export const DEFAULT_FLASK_KIND: FlaskKind = 'erlenmeyer';

export const FLASK_FACINGS: readonly FlaskFacing[] = ['up', 'up-right', 'right', 'down-right', 'down', 'down-left', 'left', 'up-left'];

export const MIN_FLASK_SIZE_SCALE = 0.5;
export const MAX_FLASK_SIZE_SCALE = 2.0;
export const DEFAULT_FLASK_SIZE_SCALE = 1.0;

const NECK_HALF_WIDTH = 3; // half-width of the straight neck -> 7px across at scale 1 (+50% over the original 5px)
const BASE_HALF_WIDTH = 12; // half-width of the flat base -> 25px across at scale 1
const CONE_ROWS = 16; // rows the conical body tapers over, from base up to the neck
const NECK_ROWS = 10; // straight neck rows above the cone
// A beaker is a plain straight-sided cylinder: narrower than the Erlenmeyer's
// base but taller than its cone, so the two read as clearly different vessels
// at the same size scale.
const BEAKER_HALF_WIDTH = 10; // -> 21px across at scale 1
const BEAKER_ROWS = 22; // straight wall rows above the closed base
// The separating funnel's stem interior deliberately does NOT scale: the
// openable bottom aperture is exactly 3px wide at every size, so the drain
// rate through an open stopcock is a property of the vessel kind rather
// than of how big the player drew it.
const SEP_STEM_HALF_WIDTH = 2; // walls at +/-2 -> a fixed 3px open interior
const SEP_STEM_ROWS = 6; // straight stem rows above the aperture row
const SEP_CONE_ROWS = 15; // rows the cone flares over, stem up to the mouth
const SEP_MOUTH_HALF_WIDTH = 12; // -> 25px across at scale 1

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

interface BeakerProfile {
  readonly halfWidth: number;
  readonly rows: number;
}

function scaledBeakerProfile(sizeScale: number): BeakerProfile {
  return {
    halfWidth: Math.max(2, Math.round(BEAKER_HALF_WIDTH * sizeScale)),
    rows: Math.max(2, Math.round(BEAKER_ROWS * sizeScale)),
  };
}

/** Canonical "facing up" beaker outline: two straight vertical wall runs on
 * a closed flat base row at the anchor (dy = 0), open across the top. */
function buildCanonicalBeakerCells(p: BeakerProfile): Offset[] {
  const cells: Offset[] = [];
  for (let row = 1; row <= p.rows; row++) {
    cells.push({ dx: -p.halfWidth, dy: -row });
    cells.push({ dx: p.halfWidth, dy: -row });
  }
  for (let dx = -p.halfWidth; dx <= p.halfWidth; dx++) cells.push({ dx, dy: 0 });
  return cells;
}

/** The beaker's open interior, same "strictly between the wall edges" rule
 * as buildCanonicalReservoirCells. */
function buildCanonicalBeakerReservoirCells(p: BeakerProfile): Offset[] {
  const cells: Offset[] = [];
  for (let row = 1; row <= p.rows; row++) {
    for (let dx = -(p.halfWidth - 1); dx <= p.halfWidth - 1; dx++) cells.push({ dx, dy: -row });
  }
  return cells;
}

interface SepFunnelProfile {
  readonly stemRows: number;
  readonly coneRows: number;
  readonly mouthHalfWidth: number;
}

function scaledSepFunnelProfile(sizeScale: number): SepFunnelProfile {
  const mouthHalfWidth = Math.max(SEP_STEM_HALF_WIDTH + 2, Math.round(SEP_MOUTH_HALF_WIDTH * sizeScale));
  return {
    stemRows: Math.max(2, Math.round(SEP_STEM_ROWS * sizeScale)),
    // The cone must always out-row its flare: keeping the per-row half-width
    // delta at 0 or 1 is what makes the sloped glass a proper 1px diagonal
    // wall movement.ts's corner-cut rule can't tunnel through (tryDiagonal).
    coneRows: Math.max(mouthHalfWidth - SEP_STEM_HALF_WIDTH, Math.round(SEP_CONE_ROWS * sizeScale)),
    mouthHalfWidth,
  };
}

/** Half-width of the cone at row r (0 = the row just above the stem),
 * tapering linearly from the stem's width up to the mouth's. */
function sepConeHalfWidth(p: SepFunnelProfile, r: number): number {
  const t = (r + 1) / p.coneRows;
  return Math.round(SEP_STEM_HALF_WIDTH + (p.mouthHalfWidth - SEP_STEM_HALF_WIDTH) * t);
}

/** Canonical "facing up" separating funnel: the aperture row at the anchor
 * (dy = 0, its walls only -- the 3 interior cells are apertureCells, owned
 * by the instance's open/closed state), a straight narrow stem above it,
 * then the cone flaring out to an open mouth. */
function buildCanonicalSepFunnelCells(p: SepFunnelProfile): Offset[] {
  const cells: Offset[] = [];
  for (let row = 0; row < p.stemRows; row++) {
    cells.push({ dx: -SEP_STEM_HALF_WIDTH, dy: -row });
    cells.push({ dx: SEP_STEM_HALF_WIDTH, dy: -row });
  }
  for (let r = 0; r < p.coneRows; r++) {
    const halfWidth = sepConeHalfWidth(p, r);
    const dy = -(p.stemRows + r);
    cells.push({ dx: -halfWidth, dy });
    cells.push({ dx: halfWidth, dy });
  }
  return cells;
}

/** The 3 cells sealing the stem's bottom -- glass while the stopcock is
 * closed, empty while it's open (see flask.ts's flaskFootprint). */
function buildCanonicalSepFunnelApertureCells(): Offset[] {
  const cells: Offset[] = [];
  for (let dx = -(SEP_STEM_HALF_WIDTH - 1); dx <= SEP_STEM_HALF_WIDTH - 1; dx++) cells.push({ dx, dy: 0 });
  return cells;
}

/** The sep funnel's open interior, same "strictly between the wall edges"
 * rule as the other kinds. Starts one row above the aperture row -- the
 * aperture cells belong to the stopcock, not the reservoir. */
function buildCanonicalSepFunnelReservoirCells(p: SepFunnelProfile): Offset[] {
  const cells: Offset[] = [];
  for (let row = 1; row < p.stemRows; row++) {
    for (let dx = -(SEP_STEM_HALF_WIDTH - 1); dx <= SEP_STEM_HALF_WIDTH - 1; dx++) cells.push({ dx, dy: -row });
  }
  for (let r = 0; r < p.coneRows; r++) {
    const halfWidth = sepConeHalfWidth(p, r);
    const dy = -(p.stemRows + r);
    for (let dx = -(halfWidth - 1); dx <= halfWidth - 1; dx++) cells.push({ dx, dy });
  }
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
  /** The openable stopcock cells -- empty for every kind but 'sepfunnel'.
   * Not part of `cells`: whether they exist as glass is the instance's
   * open/closed state, resolved in flask.ts's flaskFootprint. */
  readonly apertureCells: readonly Offset[];
}

export function flaskShapeFor(facing: FlaskFacing, sizeScale: number, kind: FlaskKind = DEFAULT_FLASK_KIND): FlaskShape {
  const canonical = (() => {
    if (kind === 'beaker') {
      const p = scaledBeakerProfile(sizeScale);
      return { cells: buildCanonicalBeakerCells(p), reservoirCells: buildCanonicalBeakerReservoirCells(p), apertureCells: [] as Offset[] };
    }
    if (kind === 'sepfunnel') {
      const p = scaledSepFunnelProfile(sizeScale);
      return {
        cells: buildCanonicalSepFunnelCells(p),
        reservoirCells: buildCanonicalSepFunnelReservoirCells(p),
        apertureCells: buildCanonicalSepFunnelApertureCells(),
      };
    }
    const p = scaledProfile(sizeScale);
    return { cells: buildCanonicalCells(p), reservoirCells: buildCanonicalReservoirCells(p), apertureCells: [] as Offset[] };
  })();
  return {
    cells: canonical.cells.map((o) => rotateFlaskOffset(o, facing)),
    reservoirCells: canonical.reservoirCells.map((o) => rotateFlaskOffset(o, facing)),
    apertureCells: canonical.apertureCells.map((o) => rotateFlaskOffset(o, facing)),
  };
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
