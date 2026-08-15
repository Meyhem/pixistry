// Apparatus undo/redo: bounded stacks of whole entity lists.
//
// Cloning the bench per step rather than tracking per-op inverses -- it's at
// most a few dozen small objects, and a clone can't drift out of sync with
// the real thing the way an inverse can (an inverse for "drag a knee" has to
// know what the geometry rebuild did).
//
// Matter is deliberately NOT covered: rewinding the chemistry is what
// world-snapshot.ts is for, and conflating the two would mean an accidental
// vessel nudge could only be undone by also throwing away a minute of
// reaction.
import type { AnyEntity } from './entity';

const MAX_UNDO_DEPTH = 50;

export class EntityHistory {
  private undoStack: AnyEntity[][] = [];
  private redoStack: AnyEntity[][] = [];
  /** The gesture the last checkpoint belonged to (see protocol.ts's
   * `undoTag`). Null means "the next mutation starts a new step whatever it
   * is", which is what a discrete op leaves behind. */
  private lastTag: string | null = null;

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** Records the bench as it stands *before* a mutation, unless that mutation
   * continues the gesture the last checkpoint already covers -- so a drag
   * that sends fifty messages under one tag rewinds in a single step, while
   * two separate drags rewind separately. An untagged (discrete) op always
   * gets its own step. */
  checkpoint(entities: readonly AnyEntity[], undoTag?: string): void {
    if (undoTag !== undefined && undoTag === this.lastTag) return;
    this.undoStack.push(structuredClone(entities as AnyEntity[]));
    if (this.undoStack.length > MAX_UNDO_DEPTH) this.undoStack.shift();
    // Anything redone-past is unreachable once a new edit lands, same as
    // every other undo stack.
    this.redoStack = [];
    this.lastTag = undoTag ?? null;
  }

  /** Steps back one entry, given the live bench; returns what to replace it
   * with, or null at the end of the stack. The caller recomposites and
   * reseeds ids -- this only owns the stacks. */
  undo(current: readonly AnyEntity[]): AnyEntity[] | null {
    return this.step(this.undoStack, this.redoStack, current);
  }

  redo(current: readonly AnyEntity[]): AnyEntity[] | null {
    return this.step(this.redoStack, this.undoStack, current);
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.lastTag = null;
  }

  private step(from: AnyEntity[][], to: AnyEntity[][], current: readonly AnyEntity[]): AnyEntity[] | null {
    const restored = from.pop();
    if (!restored) return null;
    to.push(structuredClone(current as AnyEntity[]));
    // The next edit starts a fresh step rather than coalescing into whatever
    // gesture happened to be in flight before the undo.
    this.lastTag = null;
    return restored;
  }
}
