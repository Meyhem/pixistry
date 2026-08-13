// Synthetic wall materials (glass/steel/insulator, plus heater-glass/
// cooler-glass) -- M4. These are NOT chemistry molecules: the v1 element set
// has no silicon (so "glass"/SiO2 can't be interned) and "steel" isn't a
// single compound anyway. They live as a small fixed table with their own
// thermal/physical constants, with no InternedPool/MoleculeGraph involvement
// at all.
//
// Heater-glass/cooler-glass are drawn exactly like any other wall material
// (paint tool, brush-width radius) but carry a nonzero radiatorWatts: once
// placed, every such cell radiates its fixed wattage into cells within the
// player-configurable radiation radius, every tick, for as long as it sits
// on the grid -- see heat.ts's stepGlassRadiators. This replaced an earlier
// burner/coolant tool that injected heat at the cursor only while the
// pointer was held down; the drawn-apparatus model reads better for a
// lab-bench sim (Bunsen burner under a flask vs. a magic heat ray).
//
// specIds are reserved in a disjoint range (0xFF00..0xFF04), well above any
// real chemistry specId (InternedPool grows from 0, currently ~16 species)
// and below EMPTY (0xffff), so grid.specId can stay one flat Uint16Array
// and SpeciesTable/heat.ts/movement.ts just need one range check to branch.
import { PhaseCode } from './grid';
import type { ThermalProfile } from './species';

export const WALL_SPEC_BASE = 0xff00;

export type WallKind = 'glass' | 'steel' | 'insulator' | 'heater-glass' | 'cooler-glass';

export interface WallMaterial {
  readonly specId: number;
  readonly kind: WallKind;
  readonly label: string;
  readonly color: string;
  /** Walls don't melt/vaporize in v1: this is set absurdly high so
   * heat.ts's existing melt/boil plateau logic simply never triggers in
   * practice -- no special-case code needed there. */
  readonly meltK: number;
  readonly thermalConductivity: number;
  readonly density: number;
  /** Zero for passive wall materials. Nonzero only for heater-glass/
   * cooler-glass: the fixed wattage each placed cell of this material
   * radiates (see heat.ts's stepGlassRadiators) into every cell within the
   * player-configurable radiation radius, every tick -- positive heats,
   * negative cools. This replaced an earlier cursor-anchored burner/coolant
   * tool: baking the wattage into the material itself, rather than passing
   * it around in tool messages, means a placed radiator keeps radiating for
   * as long as it sits on the grid instead of only while the pointer is
   * held down. */
  readonly radiatorWatts: number;
}

const NEVER_MELTS_K = 1e9;
const HEATER_GLASS_WATTS = 400;
const COOLER_GLASS_WATTS = -400;

const WALLS: readonly WallMaterial[] = [
  {
    specId: WALL_SPEC_BASE + 0,
    kind: 'glass',
    label: 'Glass',
    color: '#a9d6e8',
    meltK: NEVER_MELTS_K,
    thermalConductivity: 1.0,
    density: 2.5,
    radiatorWatts: 0,
  },
  {
    specId: WALL_SPEC_BASE + 1,
    kind: 'steel',
    label: 'Steel',
    color: '#8a8f96',
    meltK: NEVER_MELTS_K,
    thermalConductivity: 45,
    density: 7.8,
    radiatorWatts: 0,
  },
  {
    specId: WALL_SPEC_BASE + 2,
    kind: 'insulator',
    label: 'Insulator',
    color: '#5a4632',
    meltK: NEVER_MELTS_K,
    thermalConductivity: 0.03,
    density: 1.5,
    radiatorWatts: 0,
  },
  {
    specId: WALL_SPEC_BASE + 3,
    kind: 'heater-glass',
    label: 'Heating Glass',
    color: '#ff9d5c',
    meltK: NEVER_MELTS_K,
    thermalConductivity: 1.0,
    density: 2.5,
    radiatorWatts: HEATER_GLASS_WATTS,
  },
  {
    specId: WALL_SPEC_BASE + 4,
    kind: 'cooler-glass',
    label: 'Cooling Glass',
    color: '#5cc8ff',
    meltK: NEVER_MELTS_K,
    thermalConductivity: 1.0,
    density: 2.5,
    radiatorWatts: COOLER_GLASS_WATTS,
  },
];

export function isWallSpecId(specId: number): boolean {
  return specId >= WALL_SPEC_BASE && specId < 0xffff;
}

export function getWall(specId: number): WallMaterial {
  const wall = WALLS[specId - WALL_SPEC_BASE];
  if (!wall) throw new Error(`no wall material for specId ${specId}`);
  return wall;
}

export function wallList(): readonly WallMaterial[] {
  return WALLS;
}

/** A wall's ThermalProfile, in the same shape heat.ts already consumes for
 * real species -- solid/liquid/gas branches are identical since a wall never
 * leaves PhaseCode.Solid, and heat of fusion/vaporization are irrelevant
 * because meltK/boilK are unreachable in practice. */
export function wallThermalProfile(wall: WallMaterial): ThermalProfile {
  return {
    meltK: wall.meltK,
    boilK: wall.meltK * 2,
    specificHeatSolid: 0.5,
    specificHeatLiquid: 0.5,
    specificHeatGas: 0.5,
    heatOfFusion: 0,
    heatOfVaporization: 0,
    thermalConductivitySolid: wall.thermalConductivity,
    thermalConductivityLiquid: wall.thermalConductivity,
    thermalConductivityGas: wall.thermalConductivity,
    density: wall.density,
  };
}

/** Walls are always solid -- movement.ts and species.ts both need this. */
export const WALL_PHASE = PhaseCode.Solid;
