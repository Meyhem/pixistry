// Apparatus undo/redo (entity-history.ts) and locked scenario entities --
// phases 6c/6d of .grill/entity-overhaul.md. The interesting rule is when a
// checkpoint is *not* taken: a gesture that sends fifty messages has to
// rewind as one step, or undo becomes useless during a drag.
import { beforeEach, describe, expect, it } from 'vitest';
import { compositeEntities } from './entity-composite';
import { EntityHistory } from './entity-history';
import { resetEntityIds } from './entity-id';
import { moveEntityBy, placeEntityFromWire, type AnyEntity } from './entity';
import { SimGrid } from './grid';
import { applyScenarioSetup } from './scenario';
import type { Scenario } from './scenario-data';
import { SCENARIOS } from './scenario-data';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';

const species = new SpeciesTable();

beforeEach(() => {
  resetEntityIds();
});

describe('undo checkpoints', () => {
  it('takes one checkpoint per gesture, however many messages it sends', () => {
    const history = new EntityHistory();
    const entities: AnyEntity[] = [];

    // Two drags of fifty messages each, then two discrete ops. Four steps:
    // one per drag (the tag coalesces each), one per discrete op (an
    // untagged op never coalesces, not even with another untagged one).
    for (let i = 0; i < 50; i++) history.checkpoint(entities, 'drag:1');
    for (let i = 0; i < 50; i++) history.checkpoint(entities, 'drag:2');
    history.checkpoint(entities);
    history.checkpoint(entities);

    expect(depth(history)).toBe(4);
  });

  it('coalesces a drag down to one step -- undo during a drag would be useless otherwise', () => {
    const history = new EntityHistory();
    for (let i = 0; i < 50; i++) history.checkpoint([], 'drag:1');
    expect(depth(history)).toBe(1);
  });

  it('separates two slider drags of different fields, and coalesces each', () => {
    const history = new EntityHistory();
    const entities: AnyEntity[] = [];
    for (let i = 0; i < 10; i++) history.checkpoint(entities, 'settings:7:tempC');
    for (let i = 0; i < 10; i++) history.checkpoint(entities, 'settings:7:ratePerMinute');
    expect(depth(history)).toBe(2);
  });

  it('redoes what it undid, and drops the redo once a new edit lands', () => {
    const history = new EntityHistory();
    const a = benchOf(10);
    const b = benchOf(20);
    history.checkpoint(a);

    expect(history.canRedo).toBe(false);
    const undone = history.undo(b);
    expect(flaskX(undone)).toBe(10);
    expect(history.canRedo).toBe(true);
    expect(flaskX(history.redo(undone as AnyEntity[]))).toBe(20);

    history.undo(b);
    history.checkpoint(a, 'drag:1');
    expect(history.canRedo).toBe(false);
  });

  it('is a no-op at either end of the stack', () => {
    const history = new EntityHistory();
    expect(history.undo([])).toBeNull();
    expect(history.redo([])).toBeNull();
    expect(history.canUndo).toBe(false);
  });

  it('forgets everything on clear -- a new bench has no history of the old one', () => {
    const history = new EntityHistory();
    history.checkpoint(benchOf(10));
    history.clear();
    expect(history.canUndo).toBe(false);
    expect(history.undo([])).toBeNull();
  });

  it('restores the bench a gesture started from', () => {
    const grid = new SimGrid(60, 40);
    const flask = placeEntityFromWire(grid, { kind: 'flask', x: 20, y: 20, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' });
    if (!flask) throw new Error('expected the flask to place');
    const entities = [flask];
    compositeEntities(grid, species, entities);

    const history = new EntityHistory();
    history.checkpoint(entities, 'drag:1');
    for (let i = 0; i < 8; i++) moveEntityBy(grid, flask, 1, 0);
    compositeEntities(grid, species, entities);
    expect(flaskX(entities)).toBe(28);

    // Undo = swap the live list for the stack frame and recomposite.
    const restored = history.undo(entities);
    if (!restored) throw new Error('expected a stack frame to restore');
    compositeEntities(grid, species, restored);
    expect(flaskX(restored)).toBe(20);
  });
});

describe('locked scenario entities', () => {
  it('locks every apparatus a scenario places, and nothing the player places', () => {
    const grid = new SimGrid(160, 100);
    const scenario: Scenario = {
      ...(SCENARIOS[0] as Scenario),
      setup: [
        { kind: 'flask', x: 40, y: 60, facing: 'up', sizeScale: 1, stirred: false },
        { kind: 'funnel', x: 20, y: 20, facing: 'down', specId: SpeciesId.H2O, ratePerMinute: 60, total: null, enabled: true },
        { kind: 'radiator', x: 80, y: 50, radius: 4, targetTempC: 200 },
      ],
    };
    const entities: AnyEntity[] = [];
    applyScenarioSetup(grid, species, entities, scenario);

    expect(entities).toHaveLength(3);
    for (const entity of entities) expect(entity.locked).toBe(true);

    const playerPlaced = placeEntityFromWire(grid, { kind: 'flask', x: 100, y: 60, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' });
    expect(playerPlaced?.locked).toBeUndefined();
  });

  it('keeps the lock across a structuredClone -- undo and snapshot both copy the bench that way', () => {
    const grid = new SimGrid(160, 100);
    const entities: AnyEntity[] = [];
    applyScenarioSetup(grid, species, entities, { ...(SCENARIOS[0] as Scenario), setup: [{ kind: 'flask', x: 40, y: 60, facing: 'up', sizeScale: 1, stirred: false }] });

    const cloned = structuredClone(entities);

    expect(cloned[0]?.locked).toBe(true);
  });
});

/** How many steps deep the undo stack is, measured the way a player would:
 * how many times Undo does something before it stops. Drains the stack, so
 * it's the last thing a test asks. */
function depth(history: EntityHistory): number {
  let steps = 0;
  while (history.undo([])) steps++;
  return steps;
}

function benchOf(x: number): AnyEntity[] {
  const grid = new SimGrid(60, 40);
  const flask = placeEntityFromWire(grid, { kind: 'flask', x, y: 20, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' });
  if (!flask) throw new Error('expected the flask to place');
  return [flask];
}

function flaskX(entities: AnyEntity[] | null): number {
  const flask = entities?.[0];
  if (flask?.kind !== 'flask') throw new Error('expected the entity to be the flask');
  return flask.x;
}
