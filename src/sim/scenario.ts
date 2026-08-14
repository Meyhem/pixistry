// Turns a Scenario's `setup` into real grid state, and enforces its `rules`
// against incoming worker messages -- see .grill/campaign-mode.md's §3
// "Engine" section. Built entirely out of primitives that already exist
// (grid.set, stampGlass/wallList) -- no new physics, same "data entry, not
// engine work" philosophy scenario-data.ts's doc comment describes for
// authoring a level.
import { AMBIENT_TEMPERATURE_K, celsiusToKelvin, energyForTemperature, massOf } from './heat';
import { type SimGrid } from './grid';
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

/** Stamps every one of a scenario's setup commands onto a freshly-cleared
 * grid, in order. Callers are responsible for clearing prior state first
 * (see worker.ts's 'loadScenario' handler) -- this only adds, it never
 * clears. */
export function applyScenarioSetup(grid: SimGrid, species: SpeciesTable, scenario: Scenario): void {
  for (const cmd of scenario.setup) {
    switch (cmd.kind) {
      case 'rect':
        applyRect(grid, species, cmd);
        break;
      case 'wallRect':
        applyWallRect(grid, species, cmd);
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
