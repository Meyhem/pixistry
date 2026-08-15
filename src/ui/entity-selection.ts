// The Select tool's selection, draft and drag state -- one of each, for
// every apparatus kind.
//
// This used to be six selected-ids, six draft fields and twelve drag fields,
// with a hand-ordered hit-test chain per kind and two different conventions
// for when a draft got seeded. All of that collapsed once entities got one
// id space and one protocol (see sim/entity.ts): the hit test is
// `hitTestEntities` over the registry, the drag is either a relative
// 'moveEntity' (body) or an absolute 'dragEntityHandle' (handle), and the
// draft is one tagged union seeded in exactly one place -- `select`.
//
// The drafts themselves are still per-kind shapes, because the settings pane
// still has per-kind fields; phase 4 of the overhaul plan replaces them with
// one schema-driven values object.
import { FUNNEL_FACINGS, type FunnelFacing } from '../sim/apparatus-shapes';
import { FLASK_FACINGS, type FlaskFacing, type FlaskKind } from '../sim/flask-shapes';
import { entityRotation, hitTestEntities, type EntityHit, type EntityKind } from '../sim/entity';
import type { EntityWire, MainToWorkerMessage } from '../sim/protocol';

/** How close (in cells) a click has to land to grab a handle -- a tube knee,
 * a line end, a glass corner. Slightly generous, since handles are the
 * precise half of the interaction and a miss silently moves the whole
 * entity instead. */
const HANDLE_HIT_RADIUS = 2.5;

export type { EntityHit } from '../sim/entity';

/** Mirrors a selected funnel's live config so every field edit sends a
 * complete settings message built from this draft rather than from the
 * worker's last frame, which only refreshes once a tick and would otherwise
 * let a second quick edit clobber the first. */
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

/** Same role, but a tube's points only ever change through a knee or body
 * drag, never through this draft, so its allow-list is all that's left. */
export interface TubeEditDraft {
  filter: Set<number> | null;
}

/** Same role again for a filter line. Unlike a tube's, never null: an empty
 * allow-list blocks everything rather than passing everything. */
export interface FilterEditDraft {
  species: Set<number>;
}

/** Same role again for a radiator line -- and unlike every other draft here,
 * this one is also what the *pre-placement* sliders write into when nothing
 * is selected (see app.ts's radiatorSetter). */
export interface RadiatorEditDraft {
  radiationRadius: number;
  targetTempC: number;
}

export interface FlaskEditDraft {
  facing: FlaskFacing;
  sizeScale: number;
  stirred: boolean;
  flaskKind: FlaskKind;
}

/** A glass polygon's only editable value is which way round it is, so its
 * "draft" is that one number. It exists for the same reason the others do:
 * the worker's frame only catches up a tick later, so two wheel notches
 * inside one frame would both read the same rotation and send the same
 * absolute step -- a quick scroll would drop most of its turn. */
export interface GlassEditDraft {
  rotation: number;
}

export type EntityDraft =
  | ({ kind: 'funnel' } & FunnelEditDraft)
  | ({ kind: 'tube' } & TubeEditDraft)
  | ({ kind: 'flask' } & FlaskEditDraft)
  | ({ kind: 'filter' } & FilterEditDraft)
  | ({ kind: 'radiator' } & RadiatorEditDraft)
  | ({ kind: 'glass' } & GlassEditDraft);

type DraftOfKind<K extends EntityKind> = Extract<EntityDraft, { kind: K }>;
type WireOfKind<K extends EntityKind> = Extract<EntityWire, { kind: K }>;

/** Seeds a draft from the entity's current settings -- the one place this
 * happens, so a selected entity's panel can never show a half-populated or
 * stale draft depending on which path selected it. */
function draftFor(wire: EntityWire, fallbackTotalAmount: number): EntityDraft {
  switch (wire.kind) {
    case 'funnel':
      return {
        kind: 'funnel',
        specId: wire.specId,
        tempC: wire.tempC,
        ratePerMinute: wire.ratePerMinute,
        totalMode: wire.total === null ? 'infinite' : 'finite',
        totalAmount: wire.total ?? fallbackTotalAmount,
        facing: wire.facing,
      };
    case 'tube':
      return { kind: 'tube', filter: wire.filter ? new Set(wire.filter) : null };
    case 'flask':
      return { kind: 'flask', facing: wire.facing, sizeScale: wire.sizeScale, stirred: wire.stirred, flaskKind: wire.flaskKind };
    case 'filter':
      return { kind: 'filter', species: new Set(wire.species) };
    case 'radiator':
      return { kind: 'radiator', radiationRadius: wire.radiationRadius, targetTempC: wire.targetTempC };
    case 'glass':
      return { kind: 'glass', rotation: wire.rotation };
  }
}

export class EntitySelection {
  private entities: readonly EntityWire[] = [];

  selectedId: number | null = null;
  /** The selected entity's editable settings, seeded on select. */
  draft: EntityDraft | null = null;

  /** A body drag tracks the last processed cursor cell so each move sends
   * only the delta since the previous one ('moveEntity' is relative); a
   * handle drag needs no tracking, since 'dragEntityHandle' is absolute and
   * the worker re-resolves from the instance's current shape every call. */
  private dragState:
    | { mode: 'body'; entityId: number; lastX: number; lastY: number; undoTag: string }
    | { mode: 'handle'; entityId: number; handleId: number; undoTag: string }
    | null = null;

  /** Makes each gesture's undo tag distinct from the last one's, so two
   * consecutive drags of the same entity rewind separately (see protocol.ts's
   * `undoTag`). Monotonic rather than random: two tags only ever need to
   * differ, not to mean anything. */
  private gestureCount = 0;

  /** Seeds a funnel draft's Amount field when the selected funnel is set to
   * infinite supply and therefore carries no number of its own. */
  constructor(private readonly defaultFunnelTotal: number) {}

  /** Refreshed once per incoming worker frame -- see app.ts's
   * worker.onmessage 'frame' handler. */
  setEntities(entities: readonly EntityWire[]): void {
    this.entities = entities;
  }

  all(): readonly EntityWire[] {
    return this.entities;
  }

  find(entityId: number | null): EntityWire | undefined {
    return entityId === null ? undefined : this.entities.find((e) => e.entityId === entityId);
  }

  selected(): EntityWire | undefined {
    return this.find(this.selectedId);
  }

  selectedKind(): EntityKind | null {
    return this.selected()?.kind ?? null;
  }

  /** Whether the selection is scenario bench furniture: selectable and
   * inspectable, but the worker refuses every edit (see worker.ts's
   * isLocked), so the UI shows it read-only rather than offering controls
   * that silently do nothing. */
  isSelectionLocked(): boolean {
    return this.selected()?.locked === true;
  }

  /** The selected entity, narrowed to `kind`, or undefined if something else
   * (or nothing) is selected -- what the per-kind panel branches read. */
  selectedOf<K extends EntityKind>(kind: K): WireOfKind<K> | undefined {
    const wire = this.selected();
    return wire?.kind === kind ? (wire as WireOfKind<K>) : undefined;
  }

  /** The live draft, narrowed the same way. */
  draftOf<K extends EntityKind>(kind: K): DraftOfKind<K> | null {
    return this.draft?.kind === kind ? (this.draft as DraftOfKind<K>) : null;
  }

  select(entityId: number | null): void {
    this.selectedId = entityId;
    const wire = this.find(entityId);
    this.draft = wire ? draftFor(wire, this.defaultFunnelTotal) : null;
  }

  /** Drops a selection whose entity no longer exists (it was deleted, or a
   * Reset/Restore replaced the whole bench) -- called once per render so an
   * edit panel never points at nothing. */
  dropStaleSelection(): void {
    if (this.selectedId !== null && !this.selected()) this.select(null);
  }

  hitTest(x: number, y: number): EntityHit | null {
    return hitTestEntities(this.entities, x, y, HANDLE_HIT_RADIUS);
  }

  /** The Select tool's pointerdown: hit-tests, selects, and arms the drag --
   * a handle hit arms an absolute handle drag, a body hit a relative whole-
   * entity slide. A miss clears the selection. */
  beginSelection(x: number, y: number): EntityHit | null {
    this.endDrag();
    const hit = this.hitTest(x, y);
    this.select(hit ? hit.entityId : null);
    if (!hit) return null;
    if (hit.locked) return hit;
    const undoTag = `drag:${(this.gestureCount += 1)}`;
    this.dragState =
      hit.handleId === null
        ? { mode: 'body', entityId: hit.entityId, lastX: x, lastY: y, undoTag }
        : { mode: 'handle', entityId: hit.entityId, handleId: hit.handleId, undoTag };
    return hit;
  }

  /** The Select tool's pointermove while a drag is active -- the message to
   * send, or null if nothing is being dragged (or a body drag's delta this
   * move was zero, so there's nothing to say). */
  continueDrag(x: number, y: number): MainToWorkerMessage | null {
    const drag = this.dragState;
    if (!drag) return null;
    if (drag.mode === 'handle') {
      return { type: 'dragEntityHandle', entityId: drag.entityId, handleId: drag.handleId, x, y, undoTag: drag.undoTag };
    }
    const dx = x - drag.lastX;
    const dy = y - drag.lastY;
    if (dx === 0 && dy === 0) return null;
    drag.lastX = x;
    drag.lastY = y;
    return { type: 'moveEntity', entityId: drag.entityId, dx, dy, undoTag: drag.undoTag };
  }

  endDrag(): void {
    this.dragState = null;
  }

  /** One wheel notch (or R press) on the selection: the message to send, or
   * null when nothing rotatable is selected. Counted off the local draft
   * rather than the frame -- see GlassEditDraft on why the frame can't be
   * what it counts from -- and the draft follows, so the panel and the ghost
   * agree with the bench immediately rather than a tick later. */
  rotateSelection(step: 1 | -1): MainToWorkerMessage | null {
    const wire = this.selected();
    if (!wire || wire.locked) return null;
    const current = this.draftRotation(wire) ?? entityRotation(wire);
    if (current === null) return null;
    const rotation = current + step;
    this.applyRotationToDraft(rotation);
    return { type: 'rotateEntity', entityId: wire.entityId, rotation };
  }

  /** Where the draft thinks the entity is pointing, for the kinds whose
   * facing the draft carries -- so a fast scroll counts off its own previous
   * notch instead of the frame's stale one. */
  private draftRotation(wire: EntityWire): number | null {
    const draft = this.draft;
    if (!draft || draft.kind !== wire.kind) return null;
    if (draft.kind === 'funnel' || draft.kind === 'flask') return entityRotation({ ...wire, facing: draft.facing } as EntityWire);
    if (draft.kind === 'glass') return draft.rotation;
    return null;
  }

  private applyRotationToDraft(rotation: number): void {
    const wire = this.selected();
    const draft = this.draft;
    if (!wire || !draft || draft.kind !== wire.kind) return;
    if (draft.kind === 'glass') {
      draft.rotation = rotation;
      return;
    }
    if (draft.kind === 'funnel') draft.facing = facingAt(FUNNEL_FACINGS, rotation);
    else if (draft.kind === 'flask') draft.facing = facingAt(FLASK_FACINGS, rotation);
  }
}

function facingAt<T>(cycle: readonly T[], rotation: number): T {
  return cycle[((rotation % cycle.length) + cycle.length) % cycle.length] as T;
}
