// scenario.ts's applyScenarioSetup (does a scenario's setup actually land
// on the grid?) and its restriction-check helpers, plus an automated
// "is this level even possible" check: a BFS over REACTIONS starting from
// each scenario's allowed paint/funnel species plus whatever `setup` stamps
// onto the grid, asserting every goal's target species is reachable. This
// catches an authored-by-hand impossible level at CI time -- see
// .grill/campaign-mode.md's §3.
import { describe, expect, it } from 'vitest';
import { compositeEntities } from './entity-composite';
import type { AnyEntity } from './entity';
import { EMPTY, PhaseCode, SimGrid, SinkMaskValue } from './grid';
import { REACTIONS } from './reactions';
import { applyScenarioSetup, isFunnelSpeciesAllowed, isPaintAllowed, isToolAllowed } from './scenario';
import { SCENARIOS, type Goal, type Scenario } from './scenario-data';
import { SPECIES, SpeciesId } from './species-data';
import { SpeciesTable } from './species';
import { GLASS_WALL_SPEC_ID } from './walls';

describe('applyScenarioSetup', () => {
  it('is a no-op for a scenario with an empty setup list', () => {
    const grid = new SimGrid(160, 100);
    const species = new SpeciesTable();
    const scenario: Scenario = { ...SCENARIOS[0] as Scenario, setup: [] };
    applyScenarioSetup(grid, species, [], scenario);
    expect(grid.specId.every((s) => s === EMPTY)).toBe(true);
  });

  it("places a 'sink' command as a locked port entity, not a hand-written mask", () => {
    // A scenario's collection port has to be a tracked instance for the same
    // reason its glassware does: sinkMask is compositor-derived, so a mask
    // written straight onto the grid here would be wiped the first time the
    // player placed anything (see scenario.ts's applySink).
    const grid = new SimGrid(160, 100);
    const species = new SpeciesTable();
    const entities: AnyEntity[] = [];
    const scenario: Scenario = {
      ...(SCENARIOS[0] as Scenario),
      setup: [
        { kind: 'sink', x0: 20, y0: 80, x1: 30, y1: 80, width: 0 },
        { kind: 'sink', x0: 20, y0: 90, x1: 30, y1: 90, width: 0, port: SinkMaskValue.Vent },
      ],
    };
    applyScenarioSetup(grid, species, entities, scenario);
    compositeEntities(grid, species, entities);

    expect(entities.map((e) => e.kind)).toEqual(['sink', 'vent']);
    expect(entities.every((e) => e.locked)).toBe(true);
    expect(grid.sinkMask[grid.index(25, 80)]).toBe(SinkMaskValue.Sink);
    expect(grid.sinkMask[grid.index(25, 90)]).toBe(SinkMaskValue.Vent);

    // And it survives an unrelated recomposite, which the old mask stamp
    // would not have.
    compositeEntities(grid, species, entities);
    expect(grid.sinkMask[grid.index(25, 80)]).toBe(SinkMaskValue.Sink);
  });

  it("fills a 'rect' command's whole footprint with the given species", () => {
    const grid = new SimGrid(160, 100);
    const species = new SpeciesTable();
    const scenario: Scenario = {
      ...(SCENARIOS[0] as Scenario),
      setup: [{ kind: 'rect', x: 10, y: 10, w: 3, h: 2, specId: SpeciesId.H2O, tempC: 21 }],
    };
    applyScenarioSetup(grid, species, [], scenario);
    for (let y = 10; y < 12; y++) {
      for (let x = 10; x < 13; x++) {
        expect(grid.specId[grid.index(x, y)]).toBe(SpeciesId.H2O);
        expect(grid.phase[grid.index(x, y)]).toBe(PhaseCode.Liquid);
      }
    }
    // Nothing outside the rect.
    expect(grid.specId[grid.index(9, 10)]).toBe(EMPTY);
    expect(grid.specId[grid.index(13, 10)]).toBe(EMPTY);
  });

  it("draws a 'wallRect' as a hollow outline, not a filled block", () => {
    const grid = new SimGrid(160, 100);
    const species = new SpeciesTable();
    const scenario: Scenario = {
      ...(SCENARIOS[0] as Scenario),
      setup: [{ kind: 'wallRect', x: 10, y: 10, w: 5, h: 5, wall: 'glass' }],
    };
    applyScenarioSetup(grid, species, [], scenario);
    // Border cells are glass.
    expect(grid.specId[grid.index(10, 10)]).toBe(GLASS_WALL_SPEC_ID);
    expect(grid.specId[grid.index(14, 10)]).toBe(GLASS_WALL_SPEC_ID);
    expect(grid.specId[grid.index(10, 14)]).toBe(GLASS_WALL_SPEC_ID);
    expect(grid.specId[grid.index(14, 14)]).toBe(GLASS_WALL_SPEC_ID);
    // Interior stays empty.
    expect(grid.specId[grid.index(12, 12)]).toBe(EMPTY);
  });

  it('applies every setup command in order, later commands winning where they overlap', () => {
    const grid = new SimGrid(160, 100);
    const species = new SpeciesTable();
    const scenario: Scenario = {
      ...(SCENARIOS[0] as Scenario),
      setup: [
        { kind: 'rect', x: 20, y: 20, w: 4, h: 4, specId: SpeciesId.H2O, tempC: 21 },
        { kind: 'rect', x: 21, y: 21, w: 1, h: 1, specId: SpeciesId.NaCl },
      ],
    };
    applyScenarioSetup(grid, species, [], scenario);
    expect(grid.specId[grid.index(21, 21)]).toBe(SpeciesId.NaCl);
    expect(grid.specId[grid.index(20, 20)]).toBe(SpeciesId.H2O);
  });
});

describe('restriction checks', () => {
  it('allows everything when restrictions is null (sandbox mode)', () => {
    expect(isPaintAllowed(null, SpeciesId.Na)).toBe(true);
    expect(isToolAllowed(null, 'funnel')).toBe(true);
    expect(isFunnelSpeciesAllowed(null, SpeciesId.Na)).toBe(true);
  });

  it("paintSpecies 'none' blocks every species", () => {
    const restrictions = { paintSpecies: 'none' as const, tools: 'all' as const, funnelSpecies: 'none' as const };
    expect(isPaintAllowed(restrictions, SpeciesId.Na)).toBe(false);
    expect(isPaintAllowed(restrictions, SpeciesId.H2O)).toBe(false);
  });

  it('paintSpecies as a list only allows the listed species', () => {
    const restrictions = { paintSpecies: [SpeciesId.Na, SpeciesId.Cl2], tools: 'all' as const, funnelSpecies: 'none' as const };
    expect(isPaintAllowed(restrictions, SpeciesId.Na)).toBe(true);
    expect(isPaintAllowed(restrictions, SpeciesId.Cl2)).toBe(true);
    expect(isPaintAllowed(restrictions, SpeciesId.H2O)).toBe(false);
  });

  it("tools as a list only allows the listed tools; 'all' allows every tool", () => {
    const restricted = { paintSpecies: 'none' as const, tools: ['sink' as const], funnelSpecies: 'none' as const };
    expect(isToolAllowed(restricted, 'sink')).toBe(true);
    expect(isToolAllowed(restricted, 'funnel')).toBe(false);
    const unrestricted = { paintSpecies: 'none' as const, tools: 'all' as const, funnelSpecies: 'none' as const };
    expect(isToolAllowed(unrestricted, 'funnel')).toBe(true);
  });

  it("funnelSpecies 'none' blocks every species, a list only allows what's listed", () => {
    const none = { paintSpecies: 'none' as const, tools: 'all' as const, funnelSpecies: 'none' as const };
    expect(isFunnelSpeciesAllowed(none, SpeciesId.H2O)).toBe(false);
    const list = { paintSpecies: 'none' as const, tools: 'all' as const, funnelSpecies: [SpeciesId.H2O] };
    expect(isFunnelSpeciesAllowed(list, SpeciesId.H2O)).toBe(true);
    expect(isFunnelSpeciesAllowed(list, SpeciesId.Na)).toBe(false);
  });
});

function reachableSpecies(seed: Iterable<number>): Set<number> {
  const reachable = new Set<number>(seed);
  let changed = true;
  while (changed) {
    changed = false;
    for (const rule of REACTIONS) {
      const [a, b] = rule.reactants;
      if (reachable.has(a) && reachable.has(b)) {
        for (const product of rule.products) {
          if (!reachable.has(product)) {
            reachable.add(product);
            changed = true;
          }
        }
      }
    }
  }
  return reachable;
}

function seedSpeciesFor(scenario: Scenario): number[] {
  const seed = new Set<number>();
  if (scenario.rules.paintSpecies === 'all') {
    SPECIES.forEach((s, id) => {
      if (s.paintable) seed.add(id);
    });
  } else if (scenario.rules.paintSpecies !== 'none') {
    for (const specId of scenario.rules.paintSpecies) seed.add(specId);
  }
  if (scenario.rules.funnelSpecies !== 'none') {
    for (const specId of scenario.rules.funnelSpecies) seed.add(specId);
  }
  for (const cmd of scenario.setup) {
    if (cmd.kind === 'rect' || cmd.kind === 'funnel') seed.add(cmd.specId);
  }
  return [...seed];
}

/** Goal kinds that name a species the player has to actually *produce*.
 * 'limit'/'ventLimit'/'maxTempK' are constraints on what's already
 * reachable, not production targets, so they're excluded from the
 * reachability check. */
function productionTargetsOf(goal: Goal): number[] {
  switch (goal.kind) {
    case 'collect':
    case 'rate':
    case 'purity':
      return [goal.specId];
    case 'collectAny':
      return [...goal.specIds];
    case 'limit':
    case 'ventLimit':
    case 'maxTempK':
      return [];
  }
}

describe('scenario solvability', () => {
  for (const scenario of SCENARIOS) {
    it(`${scenario.id}: every goal's target species is reachable from what the player is allowed to use`, () => {
      const reachable = reachableSpecies(seedSpeciesFor(scenario));
      for (const goal of scenario.goals) {
        for (const specId of productionTargetsOf(goal)) {
          expect(reachable.has(specId), `${SPECIES[specId]?.name ?? specId} should be reachable in ${scenario.id}`).toBe(true);
        }
      }
    });
  }
});
