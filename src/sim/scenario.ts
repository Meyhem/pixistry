// Turns a Scenario's `setup` into real grid state, and enforces its `rules`
// against incoming worker messages -- see .grill/campaign-mode.md's §3
// "Engine" section. Built entirely out of primitives that already exist
// (grid.set, stampGlass/wallList) -- no new physics, same "data entry, not
// engine work" philosophy scenario-data.ts's doc comment describes for
// authoring a level.
import { AMBIENT_TEMPERATURE_K, celsiusToKelvin, energyForTemperature, massOf } from './heat';
import { SinkMaskValue, type SimGrid } from './grid';
import { forEachCellInRadius } from './geometry';
import { DEFAULT_FLASK_KIND } from './flask-shapes';
import type { AnyEntity } from './entity';
import { placeFlaskInstance } from './flask';
import { placeFunnelInstance, setFunnelEnabledInstance } from './funnel';
import { placeRadiatorInstance } from './radiators';
import { sinkLineCells } from './sink';
import type { SpeciesTable } from './species';
import type { Restrictions, Scenario, SetupCommand, ToolKind } from './scenario-data';
import { wallList, type WallKind } from './walls';

function wallSpecIdFor(kind: WallKind): number {
  const wall = wallList().find((w) => w.kind === kind);
  if (!wall) throw new Error(`no wall material for kind ${kind}`);
  return wall.specId;
}

function applyRect(grid: SimGrid, species: SpeciesTable, cmd: Extract<SetupCommand, { kind: 'rect' }>): void {
  const tempK = cmd.tempC !== undefined ? celsiusToKelvin(cmd.tempC) : AMBIENT_TEMPERATURE_K;
  const mass = massOf(species, cmd.specId);
  const thermal = species.thermalOf(cmd.specId);
  const { u, phase } = energyForTemperature(thermal, mass, tempK);
  for (let py = cmd.y; py < cmd.y + cmd.h; py++) {
    for (let px = cmd.x; px < cmd.x + cmd.w; px++) {
      if (grid.inBounds(px, py)) grid.set(px, py, cmd.specId, phase, u);
    }
  }
}

/** A hollow rectangular outline (a container's walls), not a filled block --
 * a filled wallRect would just be a solid brick with nowhere for the player
 * to work. */
function applyWallRect(grid: SimGrid, species: SpeciesTable, cmd: Extract<SetupCommand, { kind: 'wallRect' }>): void {
  const wallSpecId = wallSpecIdFor(cmd.wall);
  const mass = massOf(species, wallSpecId);
  const thermal = species.thermalOf(wallSpecId);
  const { u, phase } = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
  const set = (px: number, py: number) => {
    if (grid.inBounds(px, py)) grid.set(px, py, wallSpecId, phase, u);
  };
  for (let px = cmd.x; px < cmd.x + cmd.w; px++) {
    set(px, cmd.y);
    set(px, cmd.y + cmd.h - 1);
  }
  for (let py = cmd.y + 1; py < cmd.y + cmd.h - 1; py++) {
    set(cmd.x, py);
    set(cmd.x + cmd.w - 1, py);
  }
}

/** A wall drawn along a straight line rather than a hollow rectangle's
 * outline -- reuses sink.ts's sinkLineCells Bresenham (already thickened by
 * a `width` parameter) against a wall specId instead of the sink mask,
 * rather than hand-rolling a second line rasterizer. */
function applyWallLine(grid: SimGrid, species: SpeciesTable, cmd: Extract<SetupCommand, { kind: 'wallLine' }>): void {
  const wallSpecId = wallSpecIdFor(cmd.wall);
  const mass = massOf(species, wallSpecId);
  const thermal = species.thermalOf(wallSpecId);
  const { u, phase } = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K);
  for (const { x, y } of sinkLineCells(cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.width)) {
    if (grid.inBounds(x, y)) grid.set(x, y, wallSpecId, phase, u);
  }
}

/** A tracked flask instance, exactly like the interactive Flask tool's
 * 'placeFlask' handler produces. Scenario glassware used to be an untracked
 * one-shot stamp, which stopped being possible once apparatus became derived
 * state: the first recomposite clears every cell no live entity claims, so an
 * untracked scenario bench would simply vanish the first time the player
 * placed anything. */
function applyFlask(entities: AnyEntity[], cmd: Extract<SetupCommand, { kind: 'flask' }>): void {
  entities.push(
    lock(placeFlaskInstance({ x: cmd.x, y: cmd.y, facing: cmd.facing, sizeScale: cmd.sizeScale, stirred: cmd.stirred, flaskKind: cmd.glassware ?? DEFAULT_FLASK_KIND })),
  );
}

/** Scenario apparatus is the level's own bench furniture, not the player's:
 * locking it means a puzzle's pre-plumbed feed or its collection vessel can
 * be selected and inspected but not dragged away, reconfigured or deleted
 * (see worker.ts's isLocked). Everything the player places is unlocked. */
function lock<T extends AnyEntity>(entity: T): T {
  return { ...entity, locked: true };
}

/** Places a funnel already dripping if the scenario says so -- unlike the
 * interactive placeFunnel message (worker.ts), whose instance always starts
 * disabled until a player opts in from the edit panel, a Tier 3
 * continuous-process scenario's pre-plumbed feed needs to be live the moment
 * the bench loads, with no player action to enable it. Defaults to ambient
 * temperature -- SetupCommand's 'funnel' kind has no tempC of its own,
 * matching .grill/campaign-mode.md's §3 SetupCommand type. */
function applyFunnel(entities: AnyEntity[], cmd: Extract<SetupCommand, { kind: 'funnel' }>): void {
  const instance = placeFunnelInstance({
    x: cmd.x,
    y: cmd.y,
    facing: cmd.facing,
    specId: cmd.specId,
    tempC: 21,
    ratePerMinute: cmd.ratePerMinute,
    total: cmd.total,
  });
  if (cmd.enabled) setFunnelEnabledInstance(instance, true);
  entities.push(lock(instance));
}

/** A tracked radiator instance, same as the interactive Radiator tool's
 * 'paintRadiatorLine' handler produces -- and tracked for the same reason
 * applyFlask's vessels are. A single `radius` doubles as both the emitter's
 * own painted area and each cell's radiation reach, since SetupCommand's
 * 'radiator' kind (matching the design doc) exposes only one radius
 * parameter, not the tool's separate brush/radiation radii; a zero-length
 * line of that width is exactly the disc this used to paint by hand (see
 * radiators.ts's `width`). */
function applyRadiator(entities: AnyEntity[], cmd: Extract<SetupCommand, { kind: 'radiator' }>): void {
  entities.push(
    lock(placeRadiatorInstance({
      x0: cmd.x,
      y0: cmd.y,
      x1: cmd.x,
      y1: cmd.y,
      radius: cmd.radius,
      targetK: celsiusToKelvin(cmd.targetTempC),
      width: cmd.radius,
    })),
  );
}

/** A pre-placed sink -- unlike every other scenario so far (where the player
 * draws their own sink with the Sink tool), a puzzle scenario that only
 * grants the Tube tool (see the 'rube-goldberg' scenario) needs its
 * destination already marked, since the player has no way to place one
 * themselves. Reuses the same sinkLineCells Bresenham applyWallLine does. */
function applySink(grid: SimGrid, cmd: Extract<SetupCommand, { kind: 'sink' }>): void {
  const port = cmd.port ?? SinkMaskValue.Sink;
  for (const { x, y } of sinkLineCells(cmd.x0, cmd.y0, cmd.x1, cmd.y1, cmd.width)) {
    if (grid.inBounds(x, y)) grid.sinkMask[grid.index(x, y)] = port;
  }
}

/** A pre-painted catalyst pad, same as the interactive Catalyst tool's
 * 'paintCatalyst' handler (worker.ts) -- a plain brush stamp into
 * grid.catalystStrength, with none of the radiator's per-cell radiation
 * reach (see the 'catalyst' SetupCommand's doc comment). */
function applyCatalyst(grid: SimGrid, cmd: Extract<SetupCommand, { kind: 'catalyst' }>): void {
  forEachCellInRadius(grid, cmd.x, cmd.y, cmd.radius, (px, py) => {
    grid.catalystStrength[grid.index(px, py)] = cmd.strength;
  });
}

/** Stamps every one of a scenario's setup commands onto a freshly-cleared
 * grid, in order, and pushes its apparatus onto the worker's own live
 * `entities` list, exactly the way the interactive 'placeEntity' handler
 * does. Callers are responsible for clearing prior state first and for
 * compositing afterwards (see worker.ts's 'loadScenario' handler) -- this
 * only adds, it never clears, and the apparatus it places reaches the grid
 * the same way the player's own does. There's no 'tube' SetupCommand yet
 * (added only once a scenario actually needs to pre-place a tube, same
 * "don't pre-build untested primitives" rule this file's own history
 * follows). */
export function applyScenarioSetup(grid: SimGrid, species: SpeciesTable, entities: AnyEntity[], scenario: Scenario): void {
  for (const cmd of scenario.setup) {
    switch (cmd.kind) {
      case 'rect':
        applyRect(grid, species, cmd);
        break;
      case 'wallRect':
        applyWallRect(grid, species, cmd);
        break;
      case 'wallLine':
        applyWallLine(grid, species, cmd);
        break;
      case 'flask':
        applyFlask(entities, cmd);
        break;
      case 'funnel':
        applyFunnel(entities, cmd);
        break;
      case 'radiator':
        applyRadiator(entities, cmd);
        break;
      case 'sink':
        applySink(grid, cmd);
        break;
      case 'catalyst':
        applyCatalyst(grid, cmd);
        break;
    }
  }
}

/** Whether a scenario permits manually painting `specId` -- `restrictions`
 * null means unrestricted (sandbox mode, no active scenario). */
export function isPaintAllowed(restrictions: Restrictions | null, specId: number): boolean {
  if (!restrictions) return true;
  if (restrictions.paintSpecies === 'all') return true;
  if (restrictions.paintSpecies === 'none') return false;
  return restrictions.paintSpecies.includes(specId);
}

/** Whether a scenario permits a funnel to be configured to dispense
 * `specId`. */
export function isFunnelSpeciesAllowed(restrictions: Restrictions | null, specId: number): boolean {
  if (!restrictions) return true;
  if (restrictions.funnelSpecies === 'none') return false;
  return restrictions.funnelSpecies.includes(specId);
}

/** Whether a scenario permits using `tool` at all (a "locked" tool per the
 * design doc's toolbar treatment). */
export function isToolAllowed(restrictions: Restrictions | null, tool: ToolKind): boolean {
  if (!restrictions) return true;
  if (restrictions.tools === 'all') return true;
  return restrictions.tools.includes(tool);
}
