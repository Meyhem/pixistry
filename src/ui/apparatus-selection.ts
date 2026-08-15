// The select-apparatus tool's selection/drag state for every apparatus kind
// (funnel, tube, flask, filter, radiator, glass polygon) -- app.ts used to
// carry parallel per-kind copies of the same idea, plus per-kind copies of
// the "nearest match across every placed instance" hit-test loop. This class
// owns the selection/drag state and a single hitTest() returning a tagged
// union telling the caller which kind of apparatus (if any) a click landed
// on, so app.ts's pointerdown handler is one dispatch.
//
// Dragging speaks protocol v2's two verbs and nothing else: grab a *handle*
// (a tube knee, a line end, a glass corner) and every pointermove sends an
// absolute 'dragEntityHandle'; grab anything else and the whole entity
// slides via relative 'moveEntity' deltas. One consequence worth naming: a
// tube's segments are body now, so dragging one moves the whole tube --
// reshaping is what its knee handles are for. (The old per-segment drag was
// the one interaction with no protocol-v2 counterpart, and it mostly got
// used accidentally when a knee grab missed.)
import { funnelBounds, funnelShapeFor, type FunnelFacing } from '../sim/apparatus-shapes';
import { flaskBounds, flaskShapeFor, type FlaskFacing, type FlaskKind } from '../sim/flask-shapes';
import type {
  EntityWire,
  FilterWire,
  FlaskWire,
  FunnelWire,
  GlassWire,
  MainToWorkerMessage,
  RadiatorWire,
  TubeWire,
} from '../sim/protocol';
import { nearestKneeIndex, nearestSegmentIndex, pointSegmentDistance, type Point } from '../sim/tube-shapes';

// How close (in grid cells) a click/hover needs to be to grab a tube's knee
// or segment with the select-apparatus tool -- knees get first refusal
// (checked before segments, see hitTest below) so a click near a knee never
// accidentally grabs the segment it terminates instead.
const TUBE_KNEE_HIT_RADIUS = 3;
const TUBE_SEGMENT_HIT_RADIUS = 2;
// A filter/radiator line is one cell wide with no knees, so the body of one
// gets the same forgiving band a tube segment does...
const FILTER_HIT_RADIUS = 2;
// ...and its two ends get their own, slightly tighter, so grabbing an end
// reshapes the line while grabbing anywhere else slides it whole. Same
// knees-before-segments precedence a tube already has. Glass corners use
// this too -- a corner is a line end that happens to have two segments.
const LINE_END_HIT_RADIUS = 2;
// A glass polygon is a chain of one-cell-wide walls, hit-tested against its
// segments so clicking anywhere along a wall picks the vessel up.
const GLASS_HIT_RADIUS = 2;

export type ApparatusHit =
  | { kind: 'funnel'; entityId: number }
  | { kind: 'tube-knee'; entityId: number; kneeIndex: number }
  | { kind: 'tube-segment'; entityId: number; segIndex: number }
  | { kind: 'flask'; entityId: number }
  | { kind: 'filter'; entityId: number }
  | { kind: 'filter-end'; entityId: number; endIndex: 0 | 1 }
  | { kind: 'radiator'; entityId: number }
  | { kind: 'radiator-end'; entityId: number; endIndex: 0 | 1 }
  | { kind: 'glass'; entityId: number }
  | { kind: 'glass-corner'; entityId: number; cornerIndex: number }
  | { kind: 'none' };

/** Which hits land on a draggable handle (an absolute 'dragEntityHandle'
 * reshape) rather than a body (a relative 'moveEntity' slide) -- shared by
 * beginSelection's drag arming and app.ts's hover cursor. */
export function isHandleHit(hit: ApparatusHit): boolean {
  return hit.kind === 'tube-knee' || hit.kind === 'filter-end' || hit.kind === 'radiator-end' || hit.kind === 'glass-corner';
}

/** A two-point line's ends, in the order their coordinates appear in the
 * wire snapshot -- shared by the filter and radiator hit tests, which are the
 * same test over two different snapshot shapes. */
function lineEnds(line: { x0: number; y0: number; x1: number; y1: number }): [Point, Point] {
  return [
    { x: line.x0, y: line.y0 },
    { x: line.x1, y: line.y1 },
  ];
}

function nearestLineEnd<T extends { entityId: number; x0: number; y0: number; x1: number; y1: number }>(
  lines: readonly T[],
  x: number,
  y: number,
): { entityId: number; endIndex: 0 | 1 } | null {
  const candidates = lines.flatMap((line) =>
    lineEnds(line).flatMap((end, index) => {
      const dist = Math.hypot(end.x - x, end.y - y);
      return dist <= LINE_END_HIT_RADIUS ? [{ value: { entityId: line.entityId, endIndex: index as 0 | 1 }, dist }] : [];
    }),
  );
  return bestByDistance(candidates);
}

function nearestLine<T extends { entityId: number; x0: number; y0: number; x1: number; y1: number }>(lines: readonly T[], x: number, y: number): T | null {
  const candidates = lines.flatMap((line) => {
    const [a, b] = lineEnds(line);
    const dist = pointSegmentDistance({ x, y }, a, b);
    return dist <= FILTER_HIT_RADIUS ? [{ value: line, dist }] : [];
  });
  return bestByDistance(candidates);
}

/** Local draft for the select-apparatus tool's funnel edit panel -- mirrors
 * a selected funnel's live config so every field edit (temp/rate/species/
 * total) sends a complete settings message built from this draft rather
 * than from the worker's last snapshot, which only refreshes once per frame
 * and would otherwise let a second quick edit clobber the first. Re-seeded
 * from the snapshot whenever the selection changes. */
export interface FunnelEditDraft {
  specId: number;
  tempC: number;
  ratePerMinute: number;
  totalMode: 'finite' | 'infinite';
  totalAmount: number;
  /** Changed by the scroll wheel rather than by a panel field, before
   * placement and after it alike -- see app.ts's wheel handler. */
  facing: FunnelFacing;
}

/** Same role as FunnelEditDraft, but a tube's own points only ever change
 * through a knee/body drag, never through this draft, so its allow-list
 * is all that's left. */
export interface TubeEditDraft {
  filter: Set<number> | null;
}

/** Same role again for a placed filter line: its allow-list is the only
 * thing editable (the line's own geometry only changes by dragging it), so
 * this is a single Set -- and unlike a tube's, never null: an empty filter
 * allow-list blocks everything rather than passing everything. */
export interface FilterEditDraft {
  species: Set<number>;
}

/** Same role again for a placed radiator line: reach and target temperature
 * are the whole of its config, and unlike every other draft here this one is
 * also what the *pre-placement* sliders write into when nothing is selected
 * (see app.ts's radiatorSetter). */
export interface RadiatorEditDraft {
  radiationRadius: number;
  targetTempC: number;
}

/** Same role again for a placed flask: every field edit re-sends the whole
 * config as one settings message, which re-stamps the vessel (see flask.ts's
 * updateFlaskInstance). */
export interface FlaskEditDraft {
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  flaskKind: FlaskKind;
}

function bestByDistance<T>(candidates: readonly { value: T; dist: number }[]): T | null {
  let best: { value: T; dist: number } | null = null;
  for (const c of candidates) {
    if (!best || c.dist < best.dist) best = c;
  }
  return best ? best.value : null;
}

export class ApparatusSelection {
  private funnels: readonly FunnelWire[] = [];
  private tubes: readonly TubeWire[] = [];
  private flasks: readonly FlaskWire[] = [];
  private filters: readonly FilterWire[] = [];
  private radiators: readonly RadiatorWire[] = [];
  private glass: readonly GlassWire[] = [];

  selectedFunnelId: number | null = null;
  editDraft: FunnelEditDraft | null = null;
  selectedTubeId: number | null = null;
  tubeEditDraft: TubeEditDraft | null = null;
  selectedFlaskId: number | null = null;
  flaskEditDraft: FlaskEditDraft | null = null;
  selectedFilterId: number | null = null;
  filterEditDraft: FilterEditDraft | null = null;
  selectedRadiatorId: number | null = null;
  radiatorEditDraft: RadiatorEditDraft | null = null;
  // A glass polygon's only editable value is which way round it is, so its
  // "draft" is that one number. It exists for the same reason every other
  // draft here does: the worker's snapshot only catches up a frame later, and
  // two wheel notches inside one frame would otherwise both read the same
  // rotation and send the same absolute step, so the second notch would be a
  // no-op and a quick scroll would drop most of its turn.
  selectedGlassId: number | null = null;
  glassRotationDraft: number | null = null;

  // Drag state, one pair for the whole bench: every body drag is the same
  // relative 'moveEntity' (tracked against the last processed cursor cell so
  // each continueDrag sends just the incremental delta), and every handle
  // drag is the same absolute 'dragEntityHandle' (no tracking needed -- the
  // worker re-resolves fully from the instance's current shape every call).
  // Set by beginSelection, read by continueDrag, cleared by endDrag.
  private draggingBodyId: number | null = null;
  private bodyDragLastX = 0;
  private bodyDragLastY = 0;
  private draggingHandle: { entityId: number; handleId: number } | null = null;

  /** Refreshed once per incoming worker frame -- see app.ts's
   * worker.onmessage 'frame' handler. One list in, split per kind here,
   * since the hit tests below are shape-specific. */
  setEntities(entities: readonly EntityWire[]): void {
    this.funnels = entities.filter((e): e is FunnelWire => e.kind === 'funnel');
    this.tubes = entities.filter((e): e is TubeWire => e.kind === 'tube');
    this.flasks = entities.filter((e): e is FlaskWire => e.kind === 'flask');
    this.filters = entities.filter((e): e is FilterWire => e.kind === 'filter');
    this.radiators = entities.filter((e): e is RadiatorWire => e.kind === 'radiator');
    this.glass = entities.filter((e): e is GlassWire => e.kind === 'glass');
  }

  /** Every placed instance of each kind, for the select tool's handle
   * overlay -- it draws a grab dot on every knee/end/corner on the bench, not
   * just the selected one's, so what can be dragged is visible before you
   * click anything. */
  allTubes(): readonly TubeWire[] {
    return this.tubes;
  }

  allFilters(): readonly FilterWire[] {
    return this.filters;
  }

  allRadiators(): readonly RadiatorWire[] {
    return this.radiators;
  }

  allGlass(): readonly GlassWire[] {
    return this.glass;
  }

  findFunnel(entityId: number | null): FunnelWire | undefined {
    return entityId === null ? undefined : this.funnels.find((f) => f.entityId === entityId);
  }

  findTube(entityId: number | null): TubeWire | undefined {
    return entityId === null ? undefined : this.tubes.find((t) => t.entityId === entityId);
  }

  findFlask(entityId: number | null): FlaskWire | undefined {
    return entityId === null ? undefined : this.flasks.find((f) => f.entityId === entityId);
  }

  findFilter(entityId: number | null): FilterWire | undefined {
    return entityId === null ? undefined : this.filters.find((f) => f.entityId === entityId);
  }

  findRadiator(entityId: number | null): RadiatorWire | undefined {
    return entityId === null ? undefined : this.radiators.find((r) => r.entityId === entityId);
  }

  findGlass(entityId: number | null): GlassWire | undefined {
    return entityId === null ? undefined : this.glass.find((g) => g.entityId === entityId);
  }

  /** At most one apparatus is ever selected, so selecting any one kind
   * clears the others (and their edit drafts) -- the edit panel shows
   * exactly one apparatus's fields. */
  private clearSelections(): void {
    this.selectedFunnelId = null;
    this.editDraft = null;
    this.selectedTubeId = null;
    this.tubeEditDraft = null;
    this.selectedFlaskId = null;
    this.flaskEditDraft = null;
    this.selectedFilterId = null;
    this.filterEditDraft = null;
    this.selectedRadiatorId = null;
    this.radiatorEditDraft = null;
    this.selectedGlassId = null;
    this.glassRotationDraft = null;
  }

  selectFunnel(entityId: number | null): void {
    this.clearSelections();
    this.selectedFunnelId = entityId;
  }

  selectTube(entityId: number | null): void {
    this.clearSelections();
    this.selectedTubeId = entityId;
  }

  selectFlask(entityId: number | null): void {
    this.clearSelections();
    this.selectedFlaskId = entityId;
  }

  selectFilter(entityId: number | null): void {
    this.clearSelections();
    this.selectedFilterId = entityId;
    const snapshot = this.findFilter(entityId);
    this.filterEditDraft = snapshot ? { species: new Set(snapshot.species) } : null;
  }

  selectRadiator(entityId: number | null): void {
    this.clearSelections();
    this.selectedRadiatorId = entityId;
    const snapshot = this.findRadiator(entityId);
    this.radiatorEditDraft = snapshot ? { radiationRadius: snapshot.radiationRadius, targetTempC: snapshot.targetTempC } : null;
  }

  selectGlass(entityId: number | null): void {
    this.clearSelections();
    this.selectedGlassId = entityId;
    this.glassRotationDraft = this.findGlass(entityId)?.rotation ?? null;
  }

  /** What's selected, as kind + entityId -- the entityId is what a Delete or
   * a keyboard nudge names on the wire, and the kind is what the panel logic
   * branches on. Null when nothing is selected. */
  selectedRef(): { kind: 'funnel' | 'tube' | 'flask' | 'filter' | 'radiator' | 'glass'; entityId: number } | null {
    if (this.selectedFunnelId !== null) return { kind: 'funnel', entityId: this.selectedFunnelId };
    if (this.selectedTubeId !== null) return { kind: 'tube', entityId: this.selectedTubeId };
    if (this.selectedFlaskId !== null) return { kind: 'flask', entityId: this.selectedFlaskId };
    if (this.selectedFilterId !== null) return { kind: 'filter', entityId: this.selectedFilterId };
    if (this.selectedRadiatorId !== null) return { kind: 'radiator', entityId: this.selectedRadiatorId };
    if (this.selectedGlassId !== null) return { kind: 'glass', entityId: this.selectedGlassId };
    return null;
  }

  /** Drops a selection whose apparatus no longer exists (it was deleted, or
   * a Reset/Restore replaced the whole entity list) -- called once per
   * render so an edit panel never points at nothing. */
  dropStaleSelection(): void {
    if (this.selectedFunnelId !== null && !this.findFunnel(this.selectedFunnelId)) this.selectFunnel(null);
    if (this.selectedTubeId !== null && !this.findTube(this.selectedTubeId)) this.selectTube(null);
    if (this.selectedFlaskId !== null && !this.findFlask(this.selectedFlaskId)) this.selectFlask(null);
    if (this.selectedFilterId !== null && !this.findFilter(this.selectedFilterId)) this.selectFilter(null);
    if (this.selectedRadiatorId !== null && !this.findRadiator(this.selectedRadiatorId)) this.selectRadiator(null);
    if (this.selectedGlassId !== null && !this.findGlass(this.selectedGlassId)) this.selectGlass(null);
  }

  /** Bounding box hit-test against every placed funnel's rotated outline --
   * good enough for "click anywhere near the funnel selects it" without
   * pixel-perfect glass hit-testing. Returns the first match; overlapping
   * funnels are an edge case not worth resolving more precisely. */
  private hitTestFunnel(x: number, y: number): FunnelWire | null {
    for (const f of this.funnels) {
      const bounds = funnelBounds(funnelShapeFor(f.facing));
      if (x >= f.anchorX + bounds.minDx && x <= f.anchorX + bounds.maxDx && y >= f.anchorY + bounds.minDy && y <= f.anchorY + bounds.maxDy) {
        return f;
      }
    }
    return null;
  }

  /** Same bounding-box test as hitTestFunnel, over a flask's rotated
   * outline. Checked last (see hitTest) because a flask's box is big enough
   * to swallow a funnel or a tube knee standing inside it, and the small
   * apparatus is what a click in there almost always means. */
  private hitTestFlask(x: number, y: number): FlaskWire | null {
    for (const f of this.flasks) {
      const bounds = flaskBounds(flaskShapeFor(f.facing, f.sizeScale, f.flaskKind));
      if (x >= f.x + bounds.minDx && x <= f.x + bounds.maxDx && y >= f.y + bounds.minDy && y <= f.y + bounds.maxDy) {
        return f;
      }
    }
    return null;
  }

  private hitTestTubeKnee(x: number, y: number): { entityId: number; kneeIndex: number } | null {
    const candidates = this.tubes.flatMap((t) => {
      const kneeIndex = nearestKneeIndex(t.points, { x, y }, TUBE_KNEE_HIT_RADIUS);
      if (kneeIndex === null) return [];
      const p = t.points[kneeIndex] as Point;
      return [{ value: { entityId: t.entityId, kneeIndex }, dist: Math.hypot(p.x - x, p.y - y) }];
    });
    return bestByDistance(candidates);
  }

  private hitTestTubeSegment(x: number, y: number): { entityId: number; segIndex: number } | null {
    const candidates = this.tubes.flatMap((t) => {
      const segIndex = nearestSegmentIndex(t.points, { x, y }, TUBE_SEGMENT_HIT_RADIUS);
      if (segIndex === null) return [];
      const dist = pointSegmentDistance({ x, y }, t.points[segIndex] as Point, t.points[segIndex + 1] as Point);
      return [{ value: { entityId: t.entityId, segIndex }, dist }];
    });
    return bestByDistance(candidates);
  }

  /** Nearest glass polygon corner within grabbing distance -- corners are
   * individually draggable handles (each one reshapes the chain through
   * 'dragEntityHandle', the same way a tube knee does), where the chain's
   * segments are body and slide the whole vessel. */
  private hitTestGlassCorner(x: number, y: number): { entityId: number; cornerIndex: number } | null {
    const candidates = this.glass.flatMap((g) =>
      g.points.flatMap((p, cornerIndex) => {
        const dist = Math.hypot(p.x - x, p.y - y);
        return dist <= LINE_END_HIT_RADIUS ? [{ value: { entityId: g.entityId, cornerIndex }, dist }] : [];
      }),
    );
    return bestByDistance(candidates);
  }

  private hitTestGlass(x: number, y: number): GlassWire | null {
    const candidates = this.glass.flatMap((g) => {
      const dists = g.points.slice(0, -1).map((p, i) => pointSegmentDistance({ x, y }, p, g.points[i + 1] as Point));
      const dist = Math.min(...(dists.length > 0 ? dists : [Infinity]));
      return dist <= GLASS_HIT_RADIUS ? [{ value: g, dist }] : [];
    });
    return bestByDistance(candidates);
  }

  /** Grab handles first (a tube knee, either end of a filter/radiator line,
   * or a glass corner), then whole objects: funnel box, tube segment, filter
   * line, radiator line, glass polygon, and last the (much larger) flask box.
   *
   * Handles before bodies for the same reason a tube's knee is tested before
   * its segments -- a handle is the more specific thing to have aimed at, and
   * it's a couple of cells wide, so a click that lands on one is never an
   * accident. Flask stays last so apparatus standing *inside* a vessel is
   * still clickable, and glass sits just above it for the same reason: a
   * hand-drawn vessel's walls shouldn't swallow clicks meant for whatever is
   * plumbed through them. */
  hitTest(x: number, y: number): ApparatusHit {
    const filterEnd = nearestLineEnd(this.filters, x, y);
    if (filterEnd) return { kind: 'filter-end', entityId: filterEnd.entityId, endIndex: filterEnd.endIndex };
    const radiatorEnd = nearestLineEnd(this.radiators, x, y);
    if (radiatorEnd) return { kind: 'radiator-end', entityId: radiatorEnd.entityId, endIndex: radiatorEnd.endIndex };
    const knee = this.hitTestTubeKnee(x, y);
    if (knee) return { kind: 'tube-knee', entityId: knee.entityId, kneeIndex: knee.kneeIndex };
    const corner = this.hitTestGlassCorner(x, y);
    if (corner) return { kind: 'glass-corner', entityId: corner.entityId, cornerIndex: corner.cornerIndex };
    const funnel = this.hitTestFunnel(x, y);
    if (funnel) return { kind: 'funnel', entityId: funnel.entityId };
    const segment = this.hitTestTubeSegment(x, y);
    if (segment) return { kind: 'tube-segment', entityId: segment.entityId, segIndex: segment.segIndex };
    const filter = nearestLine(this.filters, x, y);
    if (filter) return { kind: 'filter', entityId: filter.entityId };
    const radiator = nearestLine(this.radiators, x, y);
    if (radiator) return { kind: 'radiator', entityId: radiator.entityId };
    const glass = this.hitTestGlass(x, y);
    if (glass) return { kind: 'glass', entityId: glass.entityId };
    const flask = this.hitTestFlask(x, y);
    if (flask) return { kind: 'flask', entityId: flask.entityId };
    return { kind: 'none' };
  }

  /** The select-apparatus tool's pointerdown: hit-tests, updates selection
   * accordingly, and arms drag state -- a handle hit arms an absolute
   * handle drag, anything else arms a whole-entity body drag (clears both
   * for 'none', along with every selection). */
  beginSelection(x: number, y: number): ApparatusHit {
    this.endDrag();

    const hit = this.hitTest(x, y);
    switch (hit.kind) {
      case 'funnel':
        this.selectFunnel(hit.entityId);
        break;
      case 'tube-knee':
        this.selectTube(hit.entityId);
        this.draggingHandle = { entityId: hit.entityId, handleId: hit.kneeIndex };
        break;
      case 'tube-segment':
        this.selectTube(hit.entityId);
        break;
      case 'flask':
        this.selectFlask(hit.entityId);
        break;
      case 'filter':
        this.selectFilter(hit.entityId);
        break;
      case 'filter-end':
        this.selectFilter(hit.entityId);
        this.draggingHandle = { entityId: hit.entityId, handleId: hit.endIndex };
        break;
      case 'radiator':
        this.selectRadiator(hit.entityId);
        break;
      case 'radiator-end':
        this.selectRadiator(hit.entityId);
        this.draggingHandle = { entityId: hit.entityId, handleId: hit.endIndex };
        break;
      case 'glass':
        this.selectGlass(hit.entityId);
        break;
      case 'glass-corner':
        this.selectGlass(hit.entityId);
        this.draggingHandle = { entityId: hit.entityId, handleId: hit.cornerIndex };
        break;
      case 'none':
        this.selectFunnel(null); // clears every kind's selection
        return hit;
    }
    if (!this.draggingHandle) {
      this.draggingBodyId = hit.entityId;
      this.bodyDragLastX = x;
      this.bodyDragLastY = y;
    }
    return hit;
  }

  /** The select-apparatus tool's pointermove while a drag is active --
   * returns the worker message to send, or null if nothing is being
   * dragged (or a body drag's delta this move was zero, so there's
   * nothing to send). */
  continueDrag(x: number, y: number): MainToWorkerMessage | null {
    if (this.draggingHandle) {
      return { type: 'dragEntityHandle', entityId: this.draggingHandle.entityId, handleId: this.draggingHandle.handleId, x, y };
    }
    if (this.draggingBodyId !== null) {
      const dx = x - this.bodyDragLastX;
      const dy = y - this.bodyDragLastY;
      if (dx === 0 && dy === 0) return null;
      this.bodyDragLastX = x;
      this.bodyDragLastY = y;
      return { type: 'moveEntity', entityId: this.draggingBodyId, dx, dy };
    }
    return null;
  }

  endDrag(): void {
    this.draggingBodyId = null;
    this.draggingHandle = null;
  }
}
