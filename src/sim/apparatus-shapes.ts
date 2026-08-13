// Hand-authored pixel shape for the addition-funnel apparatus: a wide mouth
// tapering through straight glass walls down to a single protruding "spout"
// pixel, ~40px tall/wide. Only an OUTLINE (two wall edges per row, not a
// filled triangle) so the funnel is a hollow vessel -- the open interior is
// where the decorative reservoir fill (see funnelReservoirCells) is drawn,
// and where real matter could otherwise sit undisturbed.
//
// Every offset is authored once for the canonical "facing down" orientation
// (spout points down, body extends upward from the anchor) and rotated for
// the other 3 facings via rotateForFacing -- see placement's rotate-by-wheel
// in app.ts.
export interface Offset {
  readonly dx: number;
  readonly dy: number;
}

export type FunnelFacing = 'down' | 'left' | 'up' | 'right';

export const FUNNEL_FACINGS: readonly FunnelFacing[] = ['down', 'left', 'up', 'right'];

const MOUTH_RADIUS = 19; // half-width at the wide mouth -> 39px across
const NECK_HALF_WIDTH = 1; // half-width of the straight neck tube -> 3px across
const TAPER_ROWS: number = 25; // rows over which the mouth narrows down to the neck
const NECK_ROWS = 13; // straight rows of neck tube below the taper
const BODY_ROWS = TAPER_ROWS + NECK_ROWS; // rows of glass above the anchor's spout pixel

/** Canonical "facing down" outline: body above the anchor (dy < 0), a single
 * protruding spout pixel AT the anchor (dy = 0, narrower than the neck tube
 * directly above it) -- the empty cell just past the anchor (spawnOffset) is
 * where spawned pixels actually appear. */
function buildCanonicalCells(): Offset[] {
  const cells: Offset[] = [];
  for (let row = 0; row < TAPER_ROWS; row++) {
    const t = TAPER_ROWS === 1 ? 0 : row / (TAPER_ROWS - 1);
    const halfWidth = Math.round(MOUTH_RADIUS * (1 - t) + NECK_HALF_WIDTH * t);
    const dy = -(BODY_ROWS - row);
    cells.push({ dx: -halfWidth, dy });
    if (halfWidth > 0) cells.push({ dx: halfWidth, dy });
  }
  for (let row = 0; row < NECK_ROWS; row++) {
    const dy = -(NECK_ROWS - row);
    cells.push({ dx: -NECK_HALF_WIDTH, dy });
    cells.push({ dx: NECK_HALF_WIDTH, dy });
  }
  cells.push({ dx: 0, dy: 0 });
  return cells;
}

/** The funnel's open interior per canonical row -- everything strictly
 * between the two wall edges, used only for the decorative reservoir fill
 * (see funnelReservoirCells), never for collision. */
function buildCanonicalReservoirCells(): Offset[] {
  const cells: Offset[] = [];
  for (let row = 0; row < TAPER_ROWS; row++) {
    const t = TAPER_ROWS === 1 ? 0 : row / (TAPER_ROWS - 1);
    const halfWidth = Math.round(MOUTH_RADIUS * (1 - t) + NECK_HALF_WIDTH * t);
    const dy = -(BODY_ROWS - row);
    for (let dx = -(halfWidth - 1); dx <= halfWidth - 1; dx++) cells.push({ dx, dy });
  }
  for (let row = 0; row < NECK_ROWS; row++) {
    const dy = -(NECK_ROWS - row);
    cells.push({ dx: 0, dy });
  }
  return cells;
}

const CANONICAL_CELLS = buildCanonicalCells();
const CANONICAL_RESERVOIR_CELLS = buildCanonicalReservoirCells();

const SPAWN_OFFSET_BY_FACING: Record<FunnelFacing, Offset> = {
  down: { dx: 0, dy: 1 },
  up: { dx: 0, dy: -1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
};

/** Rotates a canonical ("facing down") offset onto one of the 4 facings.
 * 'down' is identity; 'up' mirrors vertically; 'left'/'right' are the two
 * 90-degree rotations, verified by where the spawn-adjacent canonical point
 * (0, -1) lands: 'left' -> (1, 0) (body to the right of a left-pointing
 * spout), 'right' -> (-1, 0) (body to the left of a right-pointing spout). */
export function rotateForFacing(offset: Offset, facing: FunnelFacing): Offset {
  const { dx, dy } = offset;
  switch (facing) {
    case 'down':
      return { dx, dy };
    case 'up':
      return { dx, dy: -dy };
    case 'left':
      return { dx: -dy, dy: dx };
    case 'right':
      return { dx: dy, dy: -dx };
  }
}

export interface FunnelShape {
  readonly cells: readonly Offset[];
  readonly reservoirCells: readonly Offset[];
  readonly spawnOffset: Offset;
}

export function funnelShapeFor(facing: FunnelFacing): FunnelShape {
  return {
    cells: CANONICAL_CELLS.map((o) => rotateForFacing(o, facing)),
    reservoirCells: CANONICAL_RESERVOIR_CELLS.map((o) => rotateForFacing(o, facing)),
    spawnOffset: funnelSpawnOffset(facing),
  };
}

/** Just the spawn point, without remapping the full outline -- the per-tick
 * hot path (stepFunnels in funnel.ts) only ever needs this one offset. */
export function funnelSpawnOffset(facing: FunnelFacing): Offset {
  return SPAWN_OFFSET_BY_FACING[facing];
}

export function nextFunnelFacing(current: FunnelFacing, delta: number): FunnelFacing {
  const idx = FUNNEL_FACINGS.indexOf(current);
  const next = (idx + delta + FUNNEL_FACINGS.length) % FUNNEL_FACINGS.length;
  return FUNNEL_FACINGS[next] as FunnelFacing;
}

/** Bounding box of cells+reservoirCells together, in offsets from the
 * anchor -- used for the selection box and preview sizing. */
export function funnelBounds(shape: FunnelShape): { minDx: number; maxDx: number; minDy: number; maxDy: number } {
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
