// The compositor's contract (see entity-composite.ts): apparatus grid state
// is derived, so it can be re-derived, so nothing one piece of apparatus does
// can damage another. Most of what's here is the regression history of the
// old incremental-unstamp design written down as invariants -- the beaker a
// tube used to punch a hole in (commit f8f5379), the conveyor a beaker used to
// plug, the tube whose lumen mask outlived it.
import { beforeEach, describe, expect, it } from 'vitest';
import { compositeEntities, entityFootprints, NO_ENTITIES } from './entity-composite';
import { resetEntityIds } from './entity-id';
import { placeFilterInstance } from './filter';
import { flaskFootprint, placeFlaskInstance } from './flask';
import { funnelGlassCells, placeFunnelInstance } from './funnel';
import { glassCells, placeGlassInstance } from './glass';
import { EMPTY, PhaseCode, SimGrid, SinkMaskValue, TubeMaskValue } from './grid';
import { placeRadiatorInstance } from './radiators';
import { movePortInstance, placePortInstance, updatePortInstance } from './sink';
import { SpeciesTable } from './species';
import { SpeciesId } from './species-data';
import { moveTubeKnee, placeTubeInstance } from './tube';
import { GLASS_WALL_SPEC_ID } from './walls';

const species = new SpeciesTable();

/** Everything the compositor is allowed to write, as one comparable blob --
 * what "running it twice changes nothing" is asserted against. */
function derivedState(grid: SimGrid): unknown[] {
  return [
    [...grid.specId],
    [...grid.phase],
    [...grid.u],
    [...grid.tubeMask],
    [...grid.radiatorRadius],
    [...grid.radiatorTargetK],
    [...grid.sinkMask],
    [...grid.entityOwner],
  ];
}

function isGlass(grid: SimGrid, x: number, y: number): boolean {
  return grid.specId[grid.index(x, y)] === GLASS_WALL_SPEC_ID;
}

beforeEach(() => {
  resetEntityIds();
});

describe('idempotence', () => {
  it('leaves the grid byte-identical when run twice over the same bench', () => {
    const grid = new SimGrid(60, 40);
    const placed = [
      placeFunnelInstance({ x: 10, y: 10, facing: 'down', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null }),
      placeTubeInstance(grid, { points: [{ x: 20, y: 20 }, { x: 30, y: 20 }], filter: null }),
      placeFlaskInstance({ x: 40, y: 30, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' }),
      placeFilterInstance(5, 30, 15, 30, [SpeciesId.H2O]),
      placeRadiatorInstance({ x0: 50, y0: 5, x1: 55, y1: 5, radius: 3, targetK: 500 }),
      placeGlassInstance([{ x: 5, y: 5 }, { x: 5, y: 15 }]),
    ];

    compositeEntities(grid, species, placed);
    const once = derivedState(grid);
    compositeEntities(grid, species, placed);

    expect(derivedState(grid)).toEqual(once);
  });

  it('stamps in placement order regardless of list order', () => {
    const first = placeGlassInstance([{ x: 10, y: 10 }, { x: 20, y: 10 }]);
    const second = placeFlaskInstance({ x: 15, y: 14, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' });

    const ids = entityFootprints([second, first]).map((e) => e.entityId);

    expect(ids).toEqual([first.entityId, second.entityId]);
  });
});

describe('apparatus cannot damage other apparatus', () => {
  it('dragging a tube across a vessel and away leaves the vessel whole', () => {
    // The f8f5379 regression: the tube's lumen bored a permanent hole through
    // the beaker's wall, because the bore was a destructive edit rather than
    // a derived one.
    const grid = new SimGrid(60, 40);
    const vessel = placeGlassInstance([{ x: 25, y: 10 }, { x: 25, y: 30 }]);
    const tube = placeTubeInstance(grid, { points: [{ x: 18, y: 20 }, { x: 32, y: 20 }], filter: null });
    const placed = [vessel, tube];
    compositeEntities(grid, species, placed);
    expect(grid.isEmptyAt(grid.index(25, 20))).toBe(true); // plumbed through

    moveTubeKnee(grid, tube, 0, { x: 18, y: 34 });
    moveTubeKnee(grid, tube, 1, { x: 32, y: 34 });
    compositeEntities(grid, species, placed);

    for (const cell of glassCells(vessel)) expect(isGlass(grid, cell.x, cell.y)).toBe(true);
  });

  it('dragging a vessel across a tube and away leaves the tube conveying', () => {
    const grid = new SimGrid(60, 40);
    const tube = placeTubeInstance(grid, { points: [{ x: 10, y: 20 }, { x: 40, y: 20 }], filter: null });
    const flask = placeFlaskInstance({ x: 25, y: 24, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' });
    const placed = [tube, flask];
    compositeEntities(grid, species, placed);

    flask.x = 55; // dragged clear
    compositeEntities(grid, species, placed);

    for (const i of tube.geometry.lumenIdx) {
      expect(grid.tubeMask[i]).toBe(TubeMaskValue.Lumen);
      expect(grid.specId[i]).not.toBe(GLASS_WALL_SPEC_ID); // nothing plugging the channel
    }
    for (const cell of tube.geometry.wallCells) expect(isGlass(grid, cell.x, cell.y)).toBe(true);
  });

  it('a removed entity takes only its own cells, not a neighbour it overlapped', () => {
    const grid = new SimGrid(40, 40);
    const across = placeGlassInstance([{ x: 5, y: 20 }, { x: 35, y: 20 }]);
    const down = placeGlassInstance([{ x: 20, y: 5 }, { x: 20, y: 35 }]);
    compositeEntities(grid, species, [across, down]);
    expect(isGlass(grid, 20, 20)).toBe(true);

    compositeEntities(grid, species, [across]);

    expect(isGlass(grid, 20, 20)).toBe(true); // the crossing is the survivor's now
    expect(isGlass(grid, 20, 30)).toBe(false); // the vertical line is gone
  });
});

describe('collection ports', () => {
  // Sinks and Vents were painted terrain until phase 6e of
  // .grill/entity-overhaul.md -- a brush stroke straight into sinkMask that
  // nothing could move or take back. These are the properties that changed.
  it('derives a port line from its entity, tagged with the tally it feeds', () => {
    const grid = new SimGrid(40, 40);
    const sink = placePortInstance('sink', { x0: 5, y0: 10, x1: 9, y1: 10, width: 0 });
    const vent = placePortInstance('vent', { x0: 5, y0: 20, x1: 9, y1: 20, width: 0 });

    compositeEntities(grid, species, [sink, vent]);

    expect(grid.sinkMask[grid.index(7, 10)]).toBe(SinkMaskValue.Sink);
    expect(grid.sinkMask[grid.index(7, 20)]).toBe(SinkMaskValue.Vent);
    // A port is a field, not matter, and claims nothing: matter falls onto it
    // exactly as onto open ground, and it has no glass to keep provenance of.
    expect(grid.specId[grid.index(7, 10)]).toBe(EMPTY);
    expect(grid.entityOwner[grid.index(7, 10)]).toBe(0);
  });

  it('takes the mask back when the port moves, widens or leaves the bench', () => {
    const grid = new SimGrid(40, 40);
    const sink = placePortInstance('sink', { x0: 5, y0: 10, x1: 9, y1: 10, width: 0 });
    compositeEntities(grid, species, [sink]);

    movePortInstance(sink, 0, 5);
    compositeEntities(grid, species, [sink]);
    expect(grid.sinkMask[grid.index(7, 10)]).toBe(SinkMaskValue.None);
    expect(grid.sinkMask[grid.index(7, 15)]).toBe(SinkMaskValue.Sink);

    updatePortInstance(sink, 2);
    compositeEntities(grid, species, [sink]);
    expect(grid.sinkMask[grid.index(7, 16)]).toBe(SinkMaskValue.Sink);

    compositeEntities(grid, species, NO_ENTITIES);
    expect([...grid.sinkMask].every((v) => v === SinkMaskValue.None)).toBe(true);
  });

  it('wipes a hand-written mask cell -- sinkMask is derived, not painted', () => {
    // The rule this reverses: sinkMask used to be in the compositor's
    // hands-off list alongside stirrerMask and catalystStrength (see
    // CLAUDE.md). Anything writing it directly now is a bug that would
    // silently vanish on the next edit, so it fails loudly here instead.
    const grid = new SimGrid(40, 40);
    grid.sinkMask[grid.index(3, 5)] = SinkMaskValue.Sink;

    compositeEntities(grid, species, NO_ENTITIES);

    expect(grid.sinkMask[grid.index(3, 5)]).toBe(SinkMaskValue.None);
  });
});

describe('what the compositor leaves alone', () => {
  it("never touches painted matter, painted terrain, or a vessel's contents", () => {
    const grid = new SimGrid(40, 40);
    grid.set(3, 3, SpeciesId.H2O, PhaseCode.Liquid, 12);
    grid.stirrerMask[grid.index(3, 4)] = 1;
    grid.catalystStrength[grid.index(3, 6)] = 4;
    const flask = placeFlaskInstance({ x: 20, y: 30, facing: 'up', sizeScale: 1, stirred: true, flaskKind: 'beaker' });
    const inside = flaskFootprint(flask).reservoirCells[0] as { x: number; y: number };
    grid.set(inside.x, inside.y, SpeciesId.NaCl, PhaseCode.Solid, 7);

    compositeEntities(grid, species, [flask]);

    expect(grid.specId[grid.index(3, 3)]).toBe(SpeciesId.H2O);
    expect(grid.stirrerMask[grid.index(3, 4)]).toBe(1);
    expect(grid.catalystStrength[grid.index(3, 6)]).toBe(4);
    expect(grid.specId[grid.index(inside.x, inside.y)]).toBe(SpeciesId.NaCl);
  });

  it('leaves hot glass hot when an unrelated entity elsewhere is edited', () => {
    // A recomposite runs on every edit anywhere on the bench. Re-stamping
    // wall cells unconditionally would quietly reset every vessel's glass
    // temperature to ambient each time anything moved.
    const grid = new SimGrid(60, 40);
    const vessel = placeGlassInstance([{ x: 10, y: 10 }, { x: 10, y: 20 }]);
    const other = placeGlassInstance([{ x: 40, y: 10 }, { x: 40, y: 20 }]);
    const placed = [vessel, other];
    compositeEntities(grid, species, placed);

    const hot = grid.index(10, 15);
    grid.u[hot] = (grid.u[hot] as number) + 5000;
    const before = grid.u[hot] as number;

    other.dx += 3; // an edit somewhere else entirely
    compositeEntities(grid, species, placed);

    expect(grid.u[hot]).toBe(before);
  });
});

describe('ownership', () => {
  it('marks every wall cell with its owner and clears it when the entity goes', () => {
    const grid = new SimGrid(40, 40);
    const funnel = placeFunnelInstance({ x: 20, y: 20, facing: 'down', specId: SpeciesId.H2O, tempC: 21, ratePerMinute: 60, total: null });
    const cells = funnelGlassCells(funnel).filter((c) => grid.inBounds(c.x, c.y));
    expect(cells.length).toBeGreaterThan(0);
    compositeEntities(grid, species, [funnel]);
    for (const cell of cells) {
      expect(grid.entityOwner[grid.index(cell.x, cell.y)]).toBe(funnel.entityId);
    }

    compositeEntities(grid, species, NO_ENTITIES);

    for (const cell of cells) {
      expect(grid.entityOwner[grid.index(cell.x, cell.y)]).toBe(0);
      expect(grid.specId[grid.index(cell.x, cell.y)]).toBe(EMPTY);
    }
  });

  it('hands an overlapped wall cell back to the entity underneath when the top one leaves', () => {
    const grid = new SimGrid(40, 40);
    const under = placeGlassInstance([{ x: 10, y: 10 }, { x: 30, y: 10 }]);
    const over = placeFlaskInstance({ x: 20, y: 14, facing: 'up', sizeScale: 1, stirred: false, flaskKind: 'beaker' });
    compositeEntities(grid, species, [under, over]);

    compositeEntities(grid, species, [under]);

    for (const cell of glassCells(under)) {
      expect(isGlass(grid, cell.x, cell.y)).toBe(true);
      expect(grid.entityOwner[grid.index(cell.x, cell.y)]).toBe(under.entityId);
    }
  });
});
