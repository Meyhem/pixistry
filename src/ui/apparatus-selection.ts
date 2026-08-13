// The select-apparatus tool's selection/drag state for both apparatus
// types (funnel, tube) -- app.ts used to carry two parallel copies of the
// same idea (selectedFunnelId/editDraft/lastFunnels/findFunnel/selectFunnel
// vs selectedTubeId/tubeEditDraft/lastTubes/findTube/selectTube), plus two
// copies of the "nearest match across every placed instance" hit-test loop
// (hitTestTubeKnee/hitTestTubeSegment). This class owns both apparatus
// types' selection/drag state and a single hitTest() returning a tagged
// union telling the caller which kind of apparatus (if any) a click landed
// on, so app.ts's pointerdown handler is one dispatch instead of three
// sequential hit-tests with near-identical bodies.
import { funnelBounds, funnelShapeFor } from '../sim/apparatus-shapes';
import type { FunnelSnapshot, MainToWorkerMessage, TubeSnapshot } from '../sim/protocol';
import { nearestKneeIndex, nearestSegmentIndex, pointSegmentDistance, type Point } from '../sim/tube-shapes';

// How close (in grid cells) a click/hover needs to be to grab a tube's knee
// or segment with the select-apparatus tool -- knees get first refusal
// (checked before segments, see hitTest below) so a click near a knee never
// accidentally grabs the segment it terminates instead.
const TUBE_KNEE_HIT_RADIUS = 3;
const TUBE_SEGMENT_HIT_RADIUS = 2;

export type ApparatusHit =
  | { kind: 'funnel'; id: number; anchorX: number; anchorY: number }
  | { kind: 'tube-knee'; tubeId: number; kneeIndex: number }
  | { kind: 'tube-segment'; tubeId: number; segIndex: number }
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

  selectedFunnelId: number | null = null;
  editDraft: FunnelEditDraft | null = null;
  selectedTubeId: number | null = null;
  tubeEditDraft: TubeEditDraft | null = null;

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

  /** Refreshed once per incoming worker frame -- see app.ts's
   * worker.onmessage 'frame' handler. */
  setFunnels(funnels: readonly FunnelSnapshot[]): void {
    this.funnels = funnels;
  }

  setTubes(tubes: readonly TubeSnapshot[]): void {
    this.tubes = tubes;
  }

  findFunnel(id: number | null): FunnelSnapshot | undefined {
    return id === null ? undefined : this.funnels.find((f) => f.id === id);
  }

  findTube(id: number | null): TubeSnapshot | undefined {
    return id === null ? undefined : this.tubes.find((t) => t.id === id);
  }

  selectFunnel(id: number | null): void {
    this.selectedFunnelId = id;
    this.editDraft = null;
    if (id !== null) this.selectTube(null);
  }

  selectTube(id: number | null): void {
    this.selectedTubeId = id;
    this.tubeEditDraft = null;
    if (id !== null) this.selectFunnel(null);
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

  /** Funnel bounding box first, then the nearest tube knee, then the
   * nearest tube segment -- knee before segment so a click near a knee
   * never accidentally grabs the segment it terminates instead. */
  hitTest(x: number, y: number): ApparatusHit {
    const funnel = this.hitTestFunnel(x, y);
    if (funnel) return { kind: 'funnel', id: funnel.id, anchorX: funnel.anchorX, anchorY: funnel.anchorY };
    const knee = this.hitTestTubeKnee(x, y);
    if (knee) return { kind: 'tube-knee', tubeId: knee.tubeId, kneeIndex: knee.kneeIndex };
    const segment = this.hitTestTubeSegment(x, y);
    if (segment) return { kind: 'tube-segment', tubeId: segment.tubeId, segIndex: segment.segIndex };
    return { kind: 'none' };
  }

  /** The select-apparatus tool's pointerdown: hit-tests, updates selection
   * accordingly, and arms drag state for a matched funnel/knee/segment
   * (clears it for 'none', along with both selections). */
  beginSelection(x: number, y: number): ApparatusHit {
    this.draggingFunnelId = null;
    this.draggingTubeKnee = null;
    this.draggingTubeSegment = null;

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
    } else {
      this.selectFunnel(null);
      this.selectTube(null);
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
    return null;
  }

  endDrag(): void {
    this.draggingFunnelId = null;
    this.draggingTubeKnee = null;
    this.draggingTubeSegment = null;
  }
}
