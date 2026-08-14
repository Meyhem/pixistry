// Synthetic wall materials -- M4. These are NOT chemistry molecules: the v1
// element set has no silicon (so "glass"/SiO2 can't be interned). They live
// as a small fixed table with their own thermal/physical constants, with no
// InternedPool/MoleculeGraph involvement at all. (A "steel" and an
// "insulator" material used to live here too; both are gone -- steel wasn't a
// real compound, and the insulator was a second wall you drew exactly like
// glass but couldn't shape, select or see through, so every vessel worth
// building got built out of glass anyway.)
//
// One material is left, and the table stays a table rather than collapsing
// into a bare constant: the specId range, getWall and wallThermalProfile are
// all shaped around "some fixed set of wall materials", and a future
// material would otherwise have to reintroduce all of it.
//
// Heater/cooler apparatus used to live here too (as heater-glass/
// cooler-glass wall materials), occupying grid.specId and blocking movement
// like any other wall. That's been replaced by a non-physical radiator
// overlay (SimGrid.radiator, see radiators.ts) so a placed heater/cooler no
// longer collides with anything -- see radiators.ts for that model.
//
// specIds are reserved in a disjoint range (0xFF00..0xFF01), well above any
// real chemistry specId (InternedPool grows from 0, currently ~16 species)
// and below EMPTY (0xffff), so grid.specId can stay one flat Uint16Array
// and SpeciesTable/heat.ts/movement.ts just need one range check to branch.
import { PhaseCode } from './grid';
import type { ThermalProfile } from './species';

export const WALL_SPEC_BASE = 0xff00;

export type WallKind = 'glass';

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
}

const NEVER_MELTS_K = 1e9;

const WALLS: readonly WallMaterial[] = [
  {
    specId: WALL_SPEC_BASE + 0,
    kind: 'glass',
    label: 'Glass',
    color: '#a9d6e8',
    meltK: NEVER_MELTS_K,
    thermalConductivity: 1.0,
    density: 2.5,
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

/** The addition-funnel apparatus (see apparatus-shapes.ts/funnel.ts) is
 * always built from glass, same as the plain glass wall tool -- this is that
 * material's specId, named rather than re-deriving WALL_SPEC_BASE + 0 at
 * every call site. */
export const GLASS_WALL_SPEC_ID = WALL_SPEC_BASE + 0;

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
    alwaysLiquid: false,
  };
}

/** Walls are always solid -- movement.ts and species.ts both need this. */
export const WALL_PHASE = PhaseCode.Solid;
