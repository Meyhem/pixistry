// The select-apparatus tool's selection/drag state for all four apparatus
// types (funnel, tube, flask, filter) -- app.ts used to carry two parallel copies of the
// same idea (selectedFunnelId/editDraft/lastFunnels/findFunnel/selectFunnel
// vs selectedTubeId/tubeEditDraft/lastTubes/findTube/selectTube), plus two
// copies of the "nearest match across every placed instance" hit-test loop
// (hitTestTubeKnee/hitTestTubeSegment). This class owns both apparatus
// types' selection/drag state and a single hitTest() returning a tagged
// union telling the caller which kind of apparatus (if any) a click landed
// on, so app.ts's pointerdown handler is one dispatch instead of three
// sequential hit-tests with near-identical bodies.
import { funnelBounds, funnelShapeFor } from '../sim/apparatus-shapes';
import { flaskBounds, flaskShapeFor, type FlaskFacing, type FlaskKind } from '../sim/flask-shapes';
import type { FilterSnapshot, FlaskSnapshot, FunnelSnapshot, MainToWorkerMessage, TubeSnapshot } from '../sim/protocol';
import { nearestKneeIndex, nearestSegmentIndex, pointSegmentDistance, type Point } from '../sim/tube-shapes';

// How close (in grid cells) a click/hover needs to be to grab a tube's knee
// or segment with the select-apparatus tool -- knees get first refusal
// (checked before segments, see hitTest below) so a click near a knee never
// accidentally grabs the segment it terminates instead.
const TUBE_KNEE_HIT_RADIUS = 3;
const TUBE_SEGMENT_HIT_RADIUS = 2;
// A filter is a one-cell-wide line with no knees, so it gets the same
// forgiving band a tube segment does.
const FILTER_HIT_RADIUS = 2;

export type ApparatusHit =
  | { kind: 'funnel'; id: number; anchorX: number; anchorY: number }
  | { kind: 'tube-knee'; tubeId: number; kneeIndex: number }
  | { kind: 'tube-segment'; tubeId: number; segIndex: number }
  | { kind: 'flask'; id: number; anchorX: number; anchorY: number }
  | { kind: 'filter'; id: number }
  | { kind: 'none' };

/** Local draft for the select-apparatus tool's funnel edit panel -- mirrors
 * a selected funnel's live config so every field edit (temp/rate/species/
 * total) sends a complete 'updateFunnel' message built from this draft
 * rather than from the worker's last snapshot, which only refreshes once
 * per frame and would otherwise let a second quick edit clobber the first.
 * Re-seeded from the snapshot whenever the selection changes (see
 * selectFunnel). */
export interface FunnelEditDraft {
  specId: number;
  tempC: number;
  ratePerMinute: number;
  totalMode: 'finite' | 'infinite';
  totalAmount: number;
}

/** Same role as FunnelEditDraft, but a tube's own points only ever change
 * through a knee/segment drag, never through this draft, so it only covers
 * coneSize/filter. */
export interface TubeEditDraft {
  coneSize: number;
  filter: Set<number> | null;
}

/** Same role again for a placed flask: every field edit re-sends the whole
 * config as one 'updateFlask', which re-stamps the vessel (see flask.ts's
 * updateFlaskInstance). */
/** Same role again for a placed filter line: its allow-list is the only
 * thing editable (the line's own geometry only changes by dragging it), so
 * this is a single Set -- and unlike a tube's, never null: an empty filter
 * allow-list blocks everything rather than passing everything. */
export interface FilterEditDraft {
  species: Set<number>;
}

export interface FlaskEditDraft {
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  kind: FlaskKind;
}

function bestByDistance<T>(candidates: readonly { value: T; dist: number }[]): T | null {
  let best: { value: T; dist: number } | null = null;
  for (const c of candidates) {
    if (!best || c.dist < best.dist) best = c;
  }
  return best ? best.value : null;
}

export class ApparatusSelection {
  private funnels: readonly FunnelSnapshot[] = [];
  private tubes: readonly TubeSnapshot[] = [];
  private flasks: readonly FlaskSnapshot[] = [];
  private filters: readonly FilterSnapshot[] = [];

  selectedFunnelId: number | null = null;
  editDraft: FunnelEditDraft | null = null;
  selectedTubeId: number | null = null;
  tubeEditDraft: TubeEditDraft | null = null;
  selectedFlaskId: number | null = null;
  flaskEditDraft: FlaskEditDraft | null = null;
  selectedFilterId: number | null = null;
  filterEditDraft: FilterEditDraft | null = null;

  // Drag-to-move/reshape state, mutually exclusive across the three kinds --
  // set by beginSelection, read by continueDrag, cleared by endDrag.
  // dragOffsetX/Y is the click point's offset from the funnel's anchor at
  // grab time, so the funnel moves relative to where it was grabbed rather
  // than snapping its anchor to the cursor. Segment dragging tracks the
  // last processed cursor cell so each continueDrag call can send just the
  // incremental delta since the previous one (moveTubeSegment applies a
  // relative translation) -- knee dragging needs no such tracking since
  // moveTubeKnee already takes an absolute target and re-resolves fully
  // from the tube's current neighbor points every call.
  private draggingFunnelId: number | null = null;
  private dragOffsetX = 0;
  private dragOffsetY = 0;
  private draggingTubeKnee: number | null = null;
  private draggingTubeSegment: number | null = null;
  private tubeSegmentDragLastX = 0;
  private tubeSegmentDragLastY = 0;
  private draggingFlaskId: number | null = null;
  private flaskDragOffsetX = 0;
  private flaskDragOffsetY = 0;
  // A filter line slides as a whole (moveFilter takes a relative
  // translation), so it tracks the last processed cursor cell and sends the
  // incremental delta, exactly like a tube segment does.
  private draggingFilterId: number | null = null;
  private filterDragLastX = 0;
  private filterDragLastY = 0;

  /** Refreshed once per incoming worker frame -- see app.ts's
   * worker.onmessage 'frame' handler. */
  setFunnels(funnels: readonly FunnelSnapshot[]): void {
    this.funnels = funnels;
  }

  setTubes(tubes: readonly TubeSnapshot[]): void {
    this.tubes = tubes;
  }

  setFlasks(flasks: readonly FlaskSnapshot[]): void {
    this.flasks = flasks;
  }

  setFilters(filters: readonly FilterSnapshot[]): void {
    this.filters = filters;
  }

  findFunnel(id: number | null): FunnelSnapshot | undefined {
    return id === null ? undefined : this.funnels.find((f) => f.id === id);
  }

  findTube(id: number | null): TubeSnapshot | undefined {
    return id === null ? undefined : this.tubes.find((t) => t.id === id);
  }

  findFlask(id: number | null): FlaskSnapshot | undefined {
    return id === null ? undefined : this.flasks.find((f) => f.id === id);
  }

  findFilter(id: number | null): FilterSnapshot | undefined {
    return id === null ? undefined : this.filters.find((f) => f.id === id);
  }

  /** At most one apparatus is ever selected, so selecting any one kind
   * clears the other three (and their edit drafts) -- the edit panel shows
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
  }

  selectFunnel(id: number | null): void {
    this.clearSelections();
    this.selectedFunnelId = id;
  }

  selectTube(id: number | null): void {
    this.clearSelections();
    this.selectedTubeId = id;
  }

  selectFlask(id: number | null): void {
    this.clearSelections();
    this.selectedFlaskId = id;
  }

  selectFilter(id: number | null): void {
    this.clearSelections();
    this.selectedFilterId = id;
    const snapshot = this.findFilter(id);
    this.filterEditDraft = snapshot ? { species: new Set(snapshot.species) } : null;
  }

  /** Drops a selection whose apparatus no longer exists (it was erased, or a
   * Reset/Restore replaced the whole instance list) -- called once per
   * render so an edit panel never points at nothing. */
  dropStaleSelection(): void {
    if (this.selectedFunnelId !== null && !this.findFunnel(this.selectedFunnelId)) this.selectFunnel(null);
    if (this.selectedTubeId !== null && !this.findTube(this.selectedTubeId)) this.selectTube(null);
    if (this.selectedFlaskId !== null && !this.findFlask(this.selectedFlaskId)) this.selectFlask(null);
    if (this.selectedFilterId !== null && !this.findFilter(this.selectedFilterId)) this.selectFilter(null);
  }

  /** Bounding box hit-test against every placed funnel's rotated outline --
   * good enough for "click anywhere near the funnel selects it" without
   * pixel-perfect glass hit-testing. Returns the first match; overlapping
   * funnels are an edge case not worth resolving more precisely. */
  private hitTestFunnel(x: number, y: number): FunnelSnapshot | null {
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
  private hitTestFlask(x: number, y: number): FlaskSnapshot | null {
    for (const f of this.flasks) {
      const bounds = flaskBounds(flaskShapeFor(f.facing, f.sizeScale, f.kind));
      if (x >= f.x + bounds.minDx && x <= f.x + bounds.maxDx && y >= f.y + bounds.minDy && y <= f.y + bounds.maxDy) {
        return f;
      }
    }
    return null;
  }

  private hitTestTubeKnee(x: number, y: number): { tubeId: number; kneeIndex: number } | null {
    const candidates = this.tubes.flatMap((t) => {
      const kneeIndex = nearestKneeIndex(t.points, { x, y }, TUBE_KNEE_HIT_RADIUS);
      if (kneeIndex === null) return [];
      const p = t.points[kneeIndex] as Point;
      return [{ value: { tubeId: t.id, kneeIndex }, dist: Math.hypot(p.x - x, p.y - y) }];
    });
    return bestByDistance(candidates);
  }

  private hitTestTubeSegment(x: number, y: number): { tubeId: number; segIndex: number } | null {
    const candidates = this.tubes.flatMap((t) => {
      const segIndex = nearestSegmentIndex(t.points, { x, y }, TUBE_SEGMENT_HIT_RADIUS);
      if (segIndex === null) return [];
      const dist = pointSegmentDistance({ x, y }, t.points[segIndex] as Point, t.points[segIndex + 1] as Point);
      return [{ value: { tubeId: t.id, segIndex }, dist }];
    });
    return bestByDistance(candidates);
  }

  private hitTestFilter(x: number, y: number): FilterSnapshot | null {
    const candidates = this.filters.flatMap((f) => {
      const dist = pointSegmentDistance({ x, y }, { x: f.x0, y: f.y0 }, { x: f.x1, y: f.y1 });
      return dist <= FILTER_HIT_RADIUS ? [{ value: f, dist }] : [];
    });
    return bestByDistance(candidates);
  }

  /** Funnel bounding box first, then the nearest tube knee, then the
   * nearest tube segment, then the nearest filter line, then the (much
   * larger) flask box -- knee before segment so a click near a knee never
   * accidentally grabs the segment it terminates instead, filter before
   * flask because a membrane drawn across a vessel's mouth would otherwise
   * be unreachable, and flask last so apparatus standing inside a vessel
   * stays clickable. */
  hitTest(x: number, y: number): ApparatusHit {
    const funnel = this.hitTestFunnel(x, y);
    if (funnel) return { kind: 'funnel', id: funnel.id, anchorX: funnel.anchorX, anchorY: funnel.anchorY };
    const knee = this.hitTestTubeKnee(x, y);
    if (knee) return { kind: 'tube-knee', tubeId: knee.tubeId, kneeIndex: knee.kneeIndex };
    const segment = this.hitTestTubeSegment(x, y);
    if (segment) return { kind: 'tube-segment', tubeId: segment.tubeId, segIndex: segment.segIndex };
    const filter = this.hitTestFilter(x, y);
    if (filter) return { kind: 'filter', id: filter.id };
    const flask = this.hitTestFlask(x, y);
    if (flask) return { kind: 'flask', id: flask.id, anchorX: flask.x, anchorY: flask.y };
    return { kind: 'none' };
  }

  /** The select-apparatus tool's pointerdown: hit-tests, updates selection
   * accordingly, and arms drag state for a matched funnel/knee/segment
   * (clears it for 'none', along with both selections). */
  beginSelection(x: number, y: number): ApparatusHit {
    this.draggingFunnelId = null;
    this.draggingTubeKnee = null;
    this.draggingTubeSegment = null;
    this.draggingFlaskId = null;
    this.draggingFilterId = null;

    const hit = this.hitTest(x, y);
    if (hit.kind === 'funnel') {
      this.selectFunnel(hit.id);
      this.draggingFunnelId = hit.id;
      this.dragOffsetX = x - hit.anchorX;
      this.dragOffsetY = y - hit.anchorY;
    } else if (hit.kind === 'tube-knee') {
      this.selectTube(hit.tubeId);
      this.draggingTubeKnee = hit.kneeIndex;
    } else if (hit.kind === 'tube-segment') {
      this.selectTube(hit.tubeId);
      this.draggingTubeSegment = hit.segIndex;
      this.tubeSegmentDragLastX = x;
      this.tubeSegmentDragLastY = y;
    } else if (hit.kind === 'filter') {
      this.selectFilter(hit.id);
      this.draggingFilterId = hit.id;
      this.filterDragLastX = x;
      this.filterDragLastY = y;
    } else if (hit.kind === 'flask') {
      this.selectFlask(hit.id);
      this.draggingFlaskId = hit.id;
      this.flaskDragOffsetX = x - hit.anchorX;
      this.flaskDragOffsetY = y - hit.anchorY;
    } else {
      this.selectFunnel(null);
    }
    return hit;
  }

  /** The select-apparatus tool's pointermove while a drag is active --
   * returns the worker message to send, or null if nothing is being
   * dragged (or a segment drag's delta this move was zero, so there's
   * nothing to send). */
  continueDrag(x: number, y: number): MainToWorkerMessage | null {
    if (this.draggingFunnelId !== null) {
      return { type: 'moveFunnel', id: this.draggingFunnelId, x: x - this.dragOffsetX, y: y - this.dragOffsetY };
    }
    if (this.draggingTubeKnee !== null && this.selectedTubeId !== null) {
      return { type: 'moveTubeKnee', id: this.selectedTubeId, kneeIndex: this.draggingTubeKnee, x, y };
    }
    if (this.draggingTubeSegment !== null && this.selectedTubeId !== null) {
      const dx = x - this.tubeSegmentDragLastX;
      const dy = y - this.tubeSegmentDragLastY;
      if (dx === 0 && dy === 0) return null;
      this.tubeSegmentDragLastX = x;
      this.tubeSegmentDragLastY = y;
      return { type: 'moveTubeSegment', id: this.selectedTubeId, segIndex: this.draggingTubeSegment, dx, dy };
    }
    if (this.draggingFlaskId !== null) {
      return { type: 'moveFlask', id: this.draggingFlaskId, x: x - this.flaskDragOffsetX, y: y - this.flaskDragOffsetY };
    }
    if (this.draggingFilterId !== null) {
      const dx = x - this.filterDragLastX;
      const dy = y - this.filterDragLastY;
      if (dx === 0 && dy === 0) return null;
      this.filterDragLastX = x;
      this.filterDragLastY = y;
      return { type: 'moveFilter', id: this.draggingFilterId, dx, dy };
    }
    return null;
  }

  endDrag(): void {
    this.draggingFunnelId = null;
    this.draggingTubeKnee = null;
    this.draggingTubeSegment = null;
    this.draggingFlaskId = null;
    this.draggingFilterId = null;
  }
}
