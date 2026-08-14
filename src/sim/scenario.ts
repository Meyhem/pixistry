// Turns a Scenario's `setup` into real grid state, and enforces its `rules`
// against incoming worker messages -- see .grill/campaign-mode.md's §3
// "Engine" section. Built entirely out of primitives that already exist
// (grid.set, stampGlass/wallList) -- no new physics, same "data entry, not
// engine work" philosophy scenario-data.ts's doc comment describes for
// authoring a level.
import { AMBIENT_TEMPERATURE_K, celsiusToKelvin, energyForTemperature, massOf } from './heat';
import { SinkMaskValue, type SimGrid } from './grid';
import { forEachCellInRadius } from './geometry';
import { stampGlass } from './apparatus';
import { flaskShapeFor } from './flask-shapes';
import { placeFunnelInstance, setFunnelEnabledInstance, type FunnelInstance } from './funnel';
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

/** A one-shot glass stamp, same as the interactive Flask tool's 'placeFlask'
 * handler (worker.ts) -- not tracked instance state, since a flask has no
 * per-tick behavior of its own beyond the vessel/stirrer masks it sets. */
function applyFlask(grid: SimGrid, species: SpeciesTable, cmd: Extract<SetupCommand, { kind: 'flask' }>): void {
  const shape = flaskShapeFor(cmd.facing, cmd.sizeScale, cmd.glassware);
  stampGlass(
    grid,
    species,
    shape.cells.map((cell) => ({ x: cmd.x + cell.dx, y: cmd.y + cell.dy })),
  );
  for (const cell of shape.reservoirCells) {
    const x = cmd.x + cell.dx;
    const y = cmd.y + cell.dy;
    if (!grid.inBounds(x, y)) continue;
    const idx = grid.index(x, y);
    grid.vesselMask[idx] = 1;
    if (cmd.stirred) grid.stirrerMask[idx] = 1;
  }
}

/** Places a funnel already dripping if the scenario says so -- unlike the
 * interactive placeFunnel message (worker.ts), whose instance always starts
 * disabled until a player opts in from the edit panel, a Tier 3
 * continuous-process scenario's pre-plumbed feed needs to be live the moment
 * the bench loads, with no player action to enable it. Defaults to ambient
 * temperature -- SetupCommand's 'funnel' kind has no tempC of its own,
 * matching .grill/campaign-mode.md's §3 SetupCommand type. */
function applyFunnel(grid: SimGrid, species: SpeciesTable, funnels: FunnelInstance[], cmd: Extract<SetupCommand, { kind: 'funnel' }>): void {
  const instance = placeFunnelInstance(grid, species, {
    x: cmd.x,
    y: cmd.y,
    facing: cmd.facing,
    specId: cmd.specId,
    tempC: 21,
    ratePerMinute: cmd.ratePerMinute,
    total: cmd.total,
  });
  if (cmd.enabled) setFunnelEnabledInstance(instance, true);
  funnels.push(instance);
}

/** A non-physical per-cell heat-source overlay, same as the interactive
 * Radiator tool's 'paintRadiator' handler (worker.ts) -- a single `radius`
 * doubles as both the painted brush area and each cell's own radiation
 * reach, since SetupCommand's 'radiator' kind (matching the design doc)
 * exposes only one radius parameter, not the tool's separate brush/radiation
 * radii. */
function applyRadiator(grid: SimGrid, cmd: Extract<SetupCommand, { kind: 'radiator' }>): void {
  const targetK = celsiusToKelvin(cmd.targetTempC);
  forEachCellInRadius(grid, cmd.x, cmd.y, cmd.radius, (px, py) => {
    const idx = grid.index(px, py);
    grid.radiatorRadius[idx] = cmd.radius;
    grid.radiatorTargetK[idx] = targetK;
  });
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
 * grid, in order. Callers are responsible for clearing prior state first
 * (see worker.ts's 'loadScenario' handler) -- this only adds, it never
 * clears. `funnels` is the worker's own live instance array, mutated in
 * place (pushed onto) the same way worker.ts's own 'placeFunnel' handler
 * does -- there's no 'tube' SetupCommand yet, so applyScenarioSetup doesn't
 * take a tubes array too (the design doc's own sketch signature includes
 * one; added only once a scenario actually needs to pre-place a tube, same
 * "don't pre-build untested primitives" rule this file's own history
 * follows). */
export function applyScenarioSetup(grid: SimGrid, species: SpeciesTable, funnels: FunnelInstance[], scenario: Scenario): void {
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
        applyFlask(grid, species, cmd);
        break;
      case 'funnel':
        applyFunnel(grid, species, funnels, cmd);
        break;
      case 'radiator':
        applyRadiator(grid, cmd);
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
