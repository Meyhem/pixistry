// Static species table -- the fixed list of every substance the sim can
// ever put on the grid. No graph search, no interning: ids are plain array
// indices assigned once, physical constants are hand-curated real-world
// values (mostly carried over from the old src/chem/overrides.ts curated
// table). This is what guarantees a reaction can never produce a species
// with made-up/estimated properties -- only what's listed here exists.
export type PhaseAtSTP = 'solid' | 'liquid' | 'gas' | 'aqueous';

export interface SpeciesData {
  readonly name: string;
  readonly molarMass: number; // g/mol
  readonly color: string;
  readonly density: number; // g/cm3
  readonly phaseAtSTP: PhaseAtSTP;
  readonly meltingPointC: number;
  readonly boilingPointC: number;
  readonly specificHeatSolid: number; // J/g/K
  readonly specificHeatLiquid: number;
  readonly specificHeatGas: number;
  readonly heatOfFusion: number; // J/g
  readonly heatOfVaporization: number; // J/g
  readonly thermalConductivitySolid: number; // W/m/K, used as a relative rate constant
  readonly thermalConductivityLiquid: number;
  readonly thermalConductivityGas: number;
  /** Paintable from the UI palette -- the 15 pure elements plus water and
   * the two demo ionic solids (matches the old buildPalette output). Every
   * other species only ever appears as a reaction product. */
  readonly paintable: boolean;
}

// Water's thermal profile, reused wholesale by the aqueous ion species below
// -- a grid cell of "dissolved Na+" is ~1cm3 of dilute aqueous solution, not
// pure liquid ionic sodium, so its own bp/mp/heat-capacity guess would be
// physically meaningless (see the old species.ts's aqueousThermalProfile
// doc comment for the full rationale, still correct here).
const WATER_THERMAL = {
  meltingPointC: 0,
  boilingPointC: 100,
  specificHeatSolid: 2.05,
  specificHeatLiquid: 4.184,
  specificHeatGas: 2.0,
  heatOfFusion: 333.55,
  heatOfVaporization: 2257,
  thermalConductivitySolid: 2.18,
  thermalConductivityLiquid: 0.6,
  thermalConductivityGas: 0.016,
} as const;

export const SPECIES: readonly SpeciesData[] = [
  // -- 15 pure elements, in their standard state --
  { name: 'H2', molarMass: 2.016, color: '#eaf6ff', density: 0.00009, phaseAtSTP: 'gas', meltingPointC: -259.1, boilingPointC: -252.9, specificHeatSolid: 2.0, specificHeatLiquid: 9.7, specificHeatGas: 14.3, heatOfFusion: 58, heatOfVaporization: 446, thermalConductivitySolid: 0.1, thermalConductivityLiquid: 0.1, thermalConductivityGas: 0.18, paintable: true },
  { name: 'N2', molarMass: 28.014, color: '#dfefff', density: 0.00125, phaseAtSTP: 'gas', meltingPointC: -210.0, boilingPointC: -195.8, specificHeatSolid: 1.0, specificHeatLiquid: 2.0, specificHeatGas: 1.04, heatOfFusion: 25.7, heatOfVaporization: 199, thermalConductivitySolid: 0.15, thermalConductivityLiquid: 0.15, thermalConductivityGas: 0.026, paintable: true },
  { name: 'O2', molarMass: 31.998, color: '#a8d8ff', density: 0.00143, phaseAtSTP: 'gas', meltingPointC: -218.3, boilingPointC: -183.0, specificHeatSolid: 1.0, specificHeatLiquid: 1.7, specificHeatGas: 0.918, heatOfFusion: 13.9, heatOfVaporization: 213, thermalConductivitySolid: 0.15, thermalConductivityLiquid: 0.15, thermalConductivityGas: 0.026, paintable: true },
  { name: 'Cl2', molarMass: 70.90, color: '#c8e070', density: 0.00321, phaseAtSTP: 'gas', meltingPointC: -101.5, boilingPointC: -34.0, specificHeatSolid: 0.5, specificHeatLiquid: 0.95, specificHeatGas: 0.478, heatOfFusion: 1.3, heatOfVaporization: 288, thermalConductivitySolid: 0.1, thermalConductivityLiquid: 0.1, thermalConductivityGas: 0.0089, paintable: true },
  { name: 'C', molarMass: 12.011, color: '#2b2b2b', density: 2.26, phaseAtSTP: 'solid', meltingPointC: 3550, boilingPointC: 4827, specificHeatSolid: 0.709, specificHeatLiquid: 0.709, specificHeatGas: 0.709, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 5.7, thermalConductivityLiquid: 5.7, thermalConductivityGas: 5.7, paintable: true },
  { name: 'Na', molarMass: 22.990, color: '#c9c2d8', density: 0.97, phaseAtSTP: 'solid', meltingPointC: 97.8, boilingPointC: 883, specificHeatSolid: 1.23, specificHeatLiquid: 1.23, specificHeatGas: 1.23, heatOfFusion: 113, heatOfVaporization: 3870, thermalConductivitySolid: 140, thermalConductivityLiquid: 87, thermalConductivityGas: 87, paintable: true },
  { name: 'Mg', molarMass: 24.305, color: '#e0e0e0', density: 1.74, phaseAtSTP: 'solid', meltingPointC: 650, boilingPointC: 1091, specificHeatSolid: 1.02, specificHeatLiquid: 1.02, specificHeatGas: 1.02, heatOfFusion: 349, heatOfVaporization: 5267, thermalConductivitySolid: 156, thermalConductivityLiquid: 78, thermalConductivityGas: 78, paintable: true },
  { name: 'Al', molarMass: 26.982, color: '#c8c8cc', density: 2.70, phaseAtSTP: 'solid', meltingPointC: 660.3, boilingPointC: 2519, specificHeatSolid: 0.897, specificHeatLiquid: 0.897, specificHeatGas: 0.897, heatOfFusion: 396, heatOfVaporization: 10500, thermalConductivitySolid: 237, thermalConductivityLiquid: 91, thermalConductivityGas: 91, paintable: true },
  { name: 'S', molarMass: 32.06, color: '#e8d84a', density: 2.07, phaseAtSTP: 'solid', meltingPointC: 115.2, boilingPointC: 444.6, specificHeatSolid: 0.71, specificHeatLiquid: 0.71, specificHeatGas: 0.71, heatOfFusion: 53, heatOfVaporization: 0, thermalConductivitySolid: 0.205, thermalConductivityLiquid: 0.205, thermalConductivityGas: 0.205, paintable: true },
  { name: 'K', molarMass: 39.098, color: '#c9b8d8', density: 0.86, phaseAtSTP: 'solid', meltingPointC: 63.5, boilingPointC: 759, specificHeatSolid: 0.757, specificHeatLiquid: 0.757, specificHeatGas: 0.757, heatOfFusion: 60, heatOfVaporization: 1967, thermalConductivitySolid: 102, thermalConductivityLiquid: 52, thermalConductivityGas: 52, paintable: true },
  { name: 'Ca', molarMass: 40.078, color: '#b9b9a8', density: 1.55, phaseAtSTP: 'solid', meltingPointC: 842, boilingPointC: 1484, specificHeatSolid: 0.647, specificHeatLiquid: 0.647, specificHeatGas: 0.647, heatOfFusion: 213, heatOfVaporization: 3765, thermalConductivitySolid: 200, thermalConductivityLiquid: 100, thermalConductivityGas: 100, paintable: true },
  { name: 'Fe', molarMass: 55.845, color: '#8a8a8a', density: 7.87, phaseAtSTP: 'solid', meltingPointC: 1538, boilingPointC: 2862, specificHeatSolid: 0.449, specificHeatLiquid: 0.449, specificHeatGas: 0.449, heatOfFusion: 247, heatOfVaporization: 6094, thermalConductivitySolid: 80, thermalConductivityLiquid: 33, thermalConductivityGas: 33, paintable: true },
  { name: 'Cu', molarMass: 63.546, color: '#b5651d', density: 8.96, phaseAtSTP: 'solid', meltingPointC: 1085, boilingPointC: 2562, specificHeatSolid: 0.385, specificHeatLiquid: 0.385, specificHeatGas: 0.385, heatOfFusion: 205, heatOfVaporization: 4720, thermalConductivitySolid: 401, thermalConductivityLiquid: 160, thermalConductivityGas: 160, paintable: true },
  { name: 'Zn', molarMass: 65.38, color: '#a0a8ac', density: 7.13, phaseAtSTP: 'solid', meltingPointC: 419.5, boilingPointC: 907, specificHeatSolid: 0.388, specificHeatLiquid: 0.388, specificHeatGas: 0.388, heatOfFusion: 112, heatOfVaporization: 1760, thermalConductivitySolid: 116, thermalConductivityLiquid: 60, thermalConductivityGas: 60, paintable: true },
  { name: 'Ag', molarMass: 107.868, color: '#d8d8dc', density: 10.49, phaseAtSTP: 'solid', meltingPointC: 961.8, boilingPointC: 2162, specificHeatSolid: 0.235, specificHeatLiquid: 0.235, specificHeatGas: 0.235, heatOfFusion: 105, heatOfVaporization: 2363, thermalConductivitySolid: 429, thermalConductivityLiquid: 180, thermalConductivityGas: 180, paintable: true },

  // -- compounds (17), only water/NaCl/AgCl are directly paintable --
  { name: 'H2O', molarMass: 18.015, color: '#3a6ea5', density: 1.0, phaseAtSTP: 'liquid', ...WATER_THERMAL, paintable: true },
  { name: 'NaCl', molarMass: 58.44, color: '#e8e8e8', density: 2.16, phaseAtSTP: 'solid', meltingPointC: 801, boilingPointC: 1465, specificHeatSolid: 0.85, specificHeatLiquid: 0.85, specificHeatGas: 0.85, heatOfFusion: 520, heatOfVaporization: 0, thermalConductivitySolid: 6.5, thermalConductivityLiquid: 6.5, thermalConductivityGas: 6.5, paintable: true },
  { name: 'AgCl', molarMass: 143.32, color: '#e8e4d0', density: 5.56, phaseAtSTP: 'solid', meltingPointC: 455, boilingPointC: 1550, specificHeatSolid: 0.36, specificHeatLiquid: 0.36, specificHeatGas: 0.36, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'CO2', molarMass: 44.01, color: '#cfcfcf', density: 0.00198, phaseAtSTP: 'gas', meltingPointC: -78.5, boilingPointC: -78.5, specificHeatSolid: 0.85, specificHeatLiquid: 0.85, specificHeatGas: 0.85, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.015, thermalConductivityLiquid: 0.015, thermalConductivityGas: 0.015, paintable: false },
  { name: 'HCl', molarMass: 36.46, color: '#d0e8d0', density: 0.00149, phaseAtSTP: 'gas', meltingPointC: -114.2, boilingPointC: -85.1, specificHeatSolid: 0.8, specificHeatLiquid: 0.8, specificHeatGas: 0.8, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.013, thermalConductivityLiquid: 0.013, thermalConductivityGas: 0.013, paintable: false },
  { name: 'NH3', molarMass: 17.031, color: '#d8f0ff', density: 0.00073, phaseAtSTP: 'gas', meltingPointC: -77.7, boilingPointC: -33.3, specificHeatSolid: 2.1, specificHeatLiquid: 2.1, specificHeatGas: 2.1, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.022, thermalConductivityLiquid: 0.022, thermalConductivityGas: 0.022, paintable: false },
  { name: 'H2O2', molarMass: 34.015, color: '#c8e0f0', density: 1.45, phaseAtSTP: 'liquid', meltingPointC: -0.4, boilingPointC: 150.2, specificHeatSolid: 2.6, specificHeatLiquid: 2.6, specificHeatGas: 1.3, heatOfFusion: 368, heatOfVaporization: 1519, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.02, paintable: false },
  { name: 'O3', molarMass: 47.997, color: '#5fb0ff', density: 0.00214, phaseAtSTP: 'gas', meltingPointC: -192.2, boilingPointC: -111.9, specificHeatSolid: 0.82, specificHeatLiquid: 0.82, specificHeatGas: 0.82, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.016, thermalConductivityLiquid: 0.016, thermalConductivityGas: 0.016, paintable: false },
  { name: 'Fe2O3', molarMass: 159.69, color: '#9b4a2a', density: 5.24, phaseAtSTP: 'solid', meltingPointC: 1565, boilingPointC: 3000, specificHeatSolid: 0.65, specificHeatLiquid: 0.65, specificHeatGas: 0.65, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 2.5, thermalConductivityLiquid: 2.5, thermalConductivityGas: 2.5, paintable: false },
  { name: 'Al2O3', molarMass: 101.96, color: '#e0e0e0', density: 3.95, phaseAtSTP: 'solid', meltingPointC: 2072, boilingPointC: 2977, specificHeatSolid: 0.88, specificHeatLiquid: 0.88, specificHeatGas: 0.88, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 30, thermalConductivityLiquid: 30, thermalConductivityGas: 30, paintable: false },
  { name: 'FeS', molarMass: 87.91, color: '#4a4038', density: 4.84, phaseAtSTP: 'solid', meltingPointC: 1194, boilingPointC: 2500, specificHeatSolid: 0.6, specificHeatLiquid: 0.6, specificHeatGas: 0.6, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 5, thermalConductivityLiquid: 5, thermalConductivityGas: 5, paintable: false },
  { name: 'CuO', molarMass: 79.545, color: '#2b2320', density: 6.31, phaseAtSTP: 'solid', meltingPointC: 1326, boilingPointC: 2000, specificHeatSolid: 0.53, specificHeatLiquid: 0.53, specificHeatGas: 0.53, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 20, thermalConductivityLiquid: 20, thermalConductivityGas: 20, paintable: false },
  { name: 'ZnO', molarMass: 81.38, color: '#f0eee0', density: 5.61, phaseAtSTP: 'solid', meltingPointC: 1975, boilingPointC: 2360, specificHeatSolid: 0.49, specificHeatLiquid: 0.49, specificHeatGas: 0.49, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 27, thermalConductivityLiquid: 27, thermalConductivityGas: 27, paintable: false },
  { name: 'NaOH', molarMass: 39.997, color: '#e8e8e8', density: 2.13, phaseAtSTP: 'solid', meltingPointC: 318, boilingPointC: 1388, specificHeatSolid: 1.49, specificHeatLiquid: 1.49, specificHeatGas: 1.49, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.3, thermalConductivityLiquid: 1.3, thermalConductivityGas: 1.3, paintable: false },
  { name: 'CaCl2', molarMass: 110.98, color: '#e8e8e8', density: 2.15, phaseAtSTP: 'solid', meltingPointC: 772, boilingPointC: 1935, specificHeatSolid: 0.69, specificHeatLiquid: 0.69, specificHeatGas: 0.69, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.1, thermalConductivityLiquid: 1.1, thermalConductivityGas: 1.1, paintable: false },
  { name: 'MgCl2', molarMass: 95.21, color: '#e8e8e8', density: 2.32, phaseAtSTP: 'solid', meltingPointC: 714, boilingPointC: 1412, specificHeatSolid: 0.72, specificHeatLiquid: 0.72, specificHeatGas: 0.72, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: false },
  { name: 'KCl', molarMass: 74.55, color: '#e8e8e8', density: 1.98, phaseAtSTP: 'solid', meltingPointC: 770, boilingPointC: 1420, specificHeatSolid: 0.69, specificHeatLiquid: 0.69, specificHeatGas: 0.69, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 6.4, thermalConductivityLiquid: 6.4, thermalConductivityGas: 6.4, paintable: false },


  // -- aqueous dissolution products: one pixel per dissolved salt (not a
  // separate cation/anion pair -- this is a per-pixel automaton, not a
  // mole-balanced solution, so "dissolved NaCl" is modeled as a single
  // liquid species). Borrows water's thermal profile wholesale since it's
  // overwhelmingly water by mass, but with a real brine density (denser
  // than pure water) so dissolved salt sinks and stratifies by species
  // under movement.ts's density-based liquid sorting. --
  { name: 'NaCl(aq)', molarMass: 58.44, color: '#4a7ab5', density: 1.19, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
  { name: 'KCl(aq)', molarMass: 74.55, color: '#4a6fb5', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
  { name: 'CaCl2(aq)', molarMass: 110.98, color: '#3f68a8', density: 1.32, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
  { name: 'MgCl2(aq)', molarMass: 95.21, color: '#3f60a0', density: 1.30, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },

  // -- halogen-metal / precipitation / acid-base / hydrolysis / dissolution
  // expansion. Every species below is paintable:true per this pass's
  // explicit UI decision (unlike the curated-subset convention above), real
  // constants hand-picked the same way as the original 36. Ionic solids
  // follow the existing table's own precedent (NaOH/CaCl2/MgCl2/KCl) of a
  // single specificHeat/thermalConductivity value repeated across all three
  // phases and heatOfFusion/heatOfVaporization: 0 -- they decompose rather
  // than cleanly melt/boil, so a literal latent heat would be fiction.

  // -- 4 new elements: completes the halogen series (Br2, I2) and adds two
  // precipitation-chemistry cations (Pb, Ba) --
  { name: 'Br2', molarMass: 159.808, color: '#7a1f0f', density: 3.10, phaseAtSTP: 'liquid', meltingPointC: -7.2, boilingPointC: 58.8, specificHeatSolid: 0.35, specificHeatLiquid: 0.474, specificHeatGas: 0.226, heatOfFusion: 67.8, heatOfVaporization: 193, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.122, thermalConductivityGas: 0.0048, paintable: true },
  { name: 'I2', molarMass: 253.809, color: '#3d2e52', density: 4.93, phaseAtSTP: 'solid', meltingPointC: 113.7, boilingPointC: 184.3, specificHeatSolid: 0.214, specificHeatLiquid: 0.214, specificHeatGas: 0.145, heatOfFusion: 62.4, heatOfVaporization: 164, thermalConductivitySolid: 0.45, thermalConductivityLiquid: 0.3, thermalConductivityGas: 0.0045, paintable: true },
  { name: 'Pb', molarMass: 207.2, color: '#5a5f66', density: 11.34, phaseAtSTP: 'solid', meltingPointC: 327.5, boilingPointC: 1749, specificHeatSolid: 0.129, specificHeatLiquid: 0.129, specificHeatGas: 0.129, heatOfFusion: 23.0, heatOfVaporization: 858, thermalConductivitySolid: 35.3, thermalConductivityLiquid: 14, thermalConductivityGas: 14, paintable: true },
  { name: 'Ba', molarMass: 137.327, color: '#d4cfa0', density: 3.51, phaseAtSTP: 'solid', meltingPointC: 727, boilingPointC: 1897, specificHeatSolid: 0.204, specificHeatLiquid: 0.204, specificHeatGas: 0.204, heatOfFusion: 55.8, heatOfVaporization: 1279, thermalConductivitySolid: 18.4, thermalConductivityLiquid: 9, thermalConductivityGas: 9, paintable: true },

  // -- acids (pure form; HCl's pure gas form already exists above) --
  { name: 'H2SO4', molarMass: 98.079, color: '#f0efe0', density: 1.84, phaseAtSTP: 'liquid', meltingPointC: 10.3, boilingPointC: 337, specificHeatSolid: 1.4, specificHeatLiquid: 1.34, specificHeatGas: 1.0, heatOfFusion: 100, heatOfVaporization: 510, thermalConductivitySolid: 0.4, thermalConductivityLiquid: 0.36, thermalConductivityGas: 0.02, paintable: true },
  { name: 'HNO3', molarMass: 63.01, color: '#f5f0d0', density: 1.51, phaseAtSTP: 'liquid', meltingPointC: -42, boilingPointC: 83, specificHeatSolid: 1.7, specificHeatLiquid: 1.744, specificHeatGas: 0.85, heatOfFusion: 90, heatOfVaporization: 481, thermalConductivitySolid: 0.3, thermalConductivityLiquid: 0.26, thermalConductivityGas: 0.02, paintable: true },
  { name: 'HBr', molarMass: 80.91, color: '#d8e8d0', density: 0.00331, phaseAtSTP: 'gas', meltingPointC: -86.9, boilingPointC: -66.4, specificHeatSolid: 0.4, specificHeatLiquid: 0.45, specificHeatGas: 0.36, heatOfFusion: 30, heatOfVaporization: 217, thermalConductivitySolid: 0.1, thermalConductivityLiquid: 0.1, thermalConductivityGas: 0.01, paintable: true },
  { name: 'HI', molarMass: 127.91, color: '#e8e0d8', density: 0.00523, phaseAtSTP: 'gas', meltingPointC: -50.8, boilingPointC: -35.4, specificHeatSolid: 0.3, specificHeatLiquid: 0.35, specificHeatGas: 0.227, heatOfFusion: 22, heatOfVaporization: 165, thermalConductivitySolid: 0.08, thermalConductivityLiquid: 0.08, thermalConductivityGas: 0.008, paintable: true },

  // -- bases (pure solid form; NaOH's already exists above) --
  { name: 'KOH', molarMass: 56.11, color: '#e8e8e8', density: 2.04, phaseAtSTP: 'solid', meltingPointC: 360, boilingPointC: 1327, specificHeatSolid: 1.18, specificHeatLiquid: 1.18, specificHeatGas: 1.18, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.3, thermalConductivityLiquid: 1.3, thermalConductivityGas: 1.3, paintable: true },
  { name: 'Ca(OH)2', molarMass: 74.09, color: '#f0f0ec', density: 2.21, phaseAtSTP: 'solid', meltingPointC: 580, boilingPointC: 650, specificHeatSolid: 1.53, specificHeatLiquid: 1.53, specificHeatGas: 1.53, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.1, thermalConductivityLiquid: 1.1, thermalConductivityGas: 1.1, paintable: true },
  { name: 'Ba(OH)2', molarMass: 171.34, color: '#eeeee8', density: 3.74, phaseAtSTP: 'solid', meltingPointC: 407, boilingPointC: 780, specificHeatSolid: 0.85, specificHeatLiquid: 0.85, specificHeatGas: 0.85, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },

  // -- metal oxides (base anhydrides; Fe2O3/Al2O3/CuO/ZnO already exist) --
  { name: 'MgO', molarMass: 40.30, color: '#f5f5f0', density: 3.58, phaseAtSTP: 'solid', meltingPointC: 2852, boilingPointC: 3600, specificHeatSolid: 0.92, specificHeatLiquid: 0.92, specificHeatGas: 0.92, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 45, thermalConductivityLiquid: 45, thermalConductivityGas: 45, paintable: true },
  { name: 'CaO', molarMass: 56.08, color: '#f0ede0', density: 3.34, phaseAtSTP: 'solid', meltingPointC: 2613, boilingPointC: 2850, specificHeatSolid: 0.75, specificHeatLiquid: 0.75, specificHeatGas: 0.75, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 15, thermalConductivityLiquid: 15, thermalConductivityGas: 15, paintable: true },
  { name: 'BaO', molarMass: 153.33, color: '#e8e4d0', density: 5.72, phaseAtSTP: 'solid', meltingPointC: 1973, boilingPointC: 2118, specificHeatSolid: 0.42, specificHeatLiquid: 0.42, specificHeatGas: 0.42, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 8, thermalConductivityLiquid: 8, thermalConductivityGas: 8, paintable: true },
  { name: 'Na2O', molarMass: 61.98, color: '#f0f0e8', density: 2.27, phaseAtSTP: 'solid', meltingPointC: 1132, boilingPointC: 1950, specificHeatSolid: 1.22, specificHeatLiquid: 1.22, specificHeatGas: 1.22, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 3, thermalConductivityLiquid: 3, thermalConductivityGas: 3, paintable: true },
  { name: 'K2O', molarMass: 94.20, color: '#eeeee0', density: 2.35, phaseAtSTP: 'solid', meltingPointC: 740, boilingPointC: 830, specificHeatSolid: 0.85, specificHeatLiquid: 0.85, specificHeatGas: 0.85, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 2.5, thermalConductivityLiquid: 2.5, thermalConductivityGas: 2.5, paintable: true },
  { name: 'PbO', molarMass: 223.20, color: '#e8c840', density: 9.53, phaseAtSTP: 'solid', meltingPointC: 888, boilingPointC: 1470, specificHeatSolid: 0.21, specificHeatLiquid: 0.21, specificHeatGas: 0.21, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.7, thermalConductivityLiquid: 1.7, thermalConductivityGas: 1.7, paintable: true },
  { name: 'Ag2O', molarMass: 231.74, color: '#4a3a2a', density: 7.14, phaseAtSTP: 'solid', meltingPointC: 300, boilingPointC: 400, specificHeatSolid: 0.35, specificHeatLiquid: 0.35, specificHeatGas: 0.35, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 2, thermalConductivityLiquid: 2, thermalConductivityGas: 2, paintable: true },

  // -- nonmetal oxides / acid anhydrides (CO2 already exists) --
  { name: 'SO2', molarMass: 64.07, color: '#d8d0c0', density: 0.00262, phaseAtSTP: 'gas', meltingPointC: -72.7, boilingPointC: -10.0, specificHeatSolid: 0.63, specificHeatLiquid: 0.63, specificHeatGas: 0.63, heatOfFusion: 115, heatOfVaporization: 389, thermalConductivitySolid: 0.0089, thermalConductivityLiquid: 0.0089, thermalConductivityGas: 0.0089, paintable: true },
  { name: 'SO3', molarMass: 80.06, color: '#e8e4d8', density: 1.92, phaseAtSTP: 'liquid', meltingPointC: 16.9, boilingPointC: 44.8, specificHeatSolid: 0.6, specificHeatLiquid: 0.7, specificHeatGas: 0.66, heatOfFusion: 108, heatOfVaporization: 250, thermalConductivitySolid: 0.3, thermalConductivityLiquid: 0.33, thermalConductivityGas: 0.01, paintable: true },
  { name: 'NO', molarMass: 30.01, color: '#d0d8e0', density: 0.001227, phaseAtSTP: 'gas', meltingPointC: -163.6, boilingPointC: -151.7, specificHeatSolid: 0.995, specificHeatLiquid: 0.995, specificHeatGas: 0.995, heatOfFusion: 77, heatOfVaporization: 460, thermalConductivitySolid: 0.025, thermalConductivityLiquid: 0.025, thermalConductivityGas: 0.025, paintable: true },
  { name: 'NO2', molarMass: 46.01, color: '#a8442a', density: 0.00188, phaseAtSTP: 'gas', meltingPointC: -11.2, boilingPointC: 21.1, specificHeatSolid: 0.81, specificHeatLiquid: 0.81, specificHeatGas: 0.81, heatOfFusion: 115, heatOfVaporization: 400, thermalConductivitySolid: 0.026, thermalConductivityLiquid: 0.026, thermalConductivityGas: 0.026, paintable: true },

  // -- halide salts (chlorides new here except Na/Mg/Ca/K/Ag already above;
  // bromides/iodides all new). PbCl2/PbBr2/PbI2 and AgBr/AgI are genuinely
  // sparingly-soluble in reality -- same calibration point as AgCl, see
  // reactions.ts: no dissolution rule for any of them. --
  { name: 'BaCl2', molarMass: 208.23, color: '#e8e8e8', density: 3.86, phaseAtSTP: 'solid', meltingPointC: 962, boilingPointC: 1560, specificHeatSolid: 0.39, specificHeatLiquid: 0.39, specificHeatGas: 0.39, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.2, thermalConductivityLiquid: 1.2, thermalConductivityGas: 1.2, paintable: true },
  { name: 'BaBr2', molarMass: 297.14, color: '#eee8e0', density: 4.78, phaseAtSTP: 'solid', meltingPointC: 857, boilingPointC: 1835, specificHeatSolid: 0.31, specificHeatLiquid: 0.31, specificHeatGas: 0.31, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'BaI2', molarMass: 391.14, color: '#f0ece0', density: 5.15, phaseAtSTP: 'solid', meltingPointC: 711, boilingPointC: 1740, specificHeatSolid: 0.25, specificHeatLiquid: 0.25, specificHeatGas: 0.25, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.9, thermalConductivityLiquid: 0.9, thermalConductivityGas: 0.9, paintable: true },
  { name: 'AlCl3', molarMass: 133.34, color: '#f0e8dc', density: 2.44, phaseAtSTP: 'solid', meltingPointC: 192.4, boilingPointC: 380, specificHeatSolid: 0.79, specificHeatLiquid: 0.79, specificHeatGas: 0.79, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.9, thermalConductivityLiquid: 0.9, thermalConductivityGas: 0.9, paintable: true },
  { name: 'AlBr3', molarMass: 266.69, color: '#f5ecd8', density: 3.01, phaseAtSTP: 'solid', meltingPointC: 97.5, boilingPointC: 255, specificHeatSolid: 0.43, specificHeatLiquid: 0.43, specificHeatGas: 0.43, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },
  { name: 'AlI3', molarMass: 407.69, color: '#e8c888', density: 3.98, phaseAtSTP: 'solid', meltingPointC: 191, boilingPointC: 382, specificHeatSolid: 0.31, specificHeatLiquid: 0.31, specificHeatGas: 0.31, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'FeCl2', molarMass: 126.75, color: '#a8d888', density: 3.16, phaseAtSTP: 'solid', meltingPointC: 677, boilingPointC: 1023, specificHeatSolid: 0.72, specificHeatLiquid: 0.72, specificHeatGas: 0.72, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.5, thermalConductivityLiquid: 1.5, thermalConductivityGas: 1.5, paintable: true },
  { name: 'FeCl3', molarMass: 162.20, color: '#5a3a28', density: 2.90, phaseAtSTP: 'solid', meltingPointC: 306, boilingPointC: 316, specificHeatSolid: 0.65, specificHeatLiquid: 0.65, specificHeatGas: 0.65, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'FeBr3', molarMass: 295.56, color: '#5a2a18', density: 4.50, phaseAtSTP: 'solid', meltingPointC: 200, boilingPointC: 300, specificHeatSolid: 0.35, specificHeatLiquid: 0.35, specificHeatGas: 0.35, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.8, thermalConductivityLiquid: 0.8, thermalConductivityGas: 0.8, paintable: true },
  { name: 'FeI2', molarMass: 309.65, color: '#5a4838', density: 5.32, phaseAtSTP: 'solid', meltingPointC: 587, boilingPointC: 935, specificHeatSolid: 0.29, specificHeatLiquid: 0.29, specificHeatGas: 0.29, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.7, thermalConductivityLiquid: 0.7, thermalConductivityGas: 0.7, paintable: true },
  { name: 'CuCl2', molarMass: 134.45, color: '#7a4838', density: 3.39, phaseAtSTP: 'solid', meltingPointC: 620, boilingPointC: 993, specificHeatSolid: 0.71, specificHeatLiquid: 0.71, specificHeatGas: 0.71, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.3, thermalConductivityLiquid: 1.3, thermalConductivityGas: 1.3, paintable: true },
  { name: 'CuBr2', molarMass: 223.35, color: '#2a1a10', density: 4.71, phaseAtSTP: 'solid', meltingPointC: 498, boilingPointC: 900, specificHeatSolid: 0.42, specificHeatLiquid: 0.42, specificHeatGas: 0.42, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'ZnCl2', molarMass: 136.30, color: '#f0f0ec', density: 2.91, phaseAtSTP: 'solid', meltingPointC: 290, boilingPointC: 732, specificHeatSolid: 0.75, specificHeatLiquid: 0.75, specificHeatGas: 0.75, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.9, thermalConductivityLiquid: 0.9, thermalConductivityGas: 0.9, paintable: true },
  { name: 'ZnBr2', molarMass: 225.20, color: '#f0f0ec', density: 4.20, phaseAtSTP: 'solid', meltingPointC: 394, boilingPointC: 650, specificHeatSolid: 0.42, specificHeatLiquid: 0.42, specificHeatGas: 0.42, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.8, thermalConductivityLiquid: 0.8, thermalConductivityGas: 0.8, paintable: true },
  { name: 'ZnI2', molarMass: 319.20, color: '#f0ece0', density: 4.74, phaseAtSTP: 'solid', meltingPointC: 446, boilingPointC: 624, specificHeatSolid: 0.31, specificHeatLiquid: 0.31, specificHeatGas: 0.31, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },
  { name: 'PbCl2', molarMass: 278.10, color: '#f0f0ec', density: 5.85, phaseAtSTP: 'solid', meltingPointC: 501, boilingPointC: 950, specificHeatSolid: 0.31, specificHeatLiquid: 0.31, specificHeatGas: 0.31, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.4, thermalConductivityLiquid: 1.4, thermalConductivityGas: 1.4, paintable: true },
  { name: 'PbBr2', molarMass: 367.01, color: '#f5f0e0', density: 6.66, phaseAtSTP: 'solid', meltingPointC: 373, boilingPointC: 892, specificHeatSolid: 0.23, specificHeatLiquid: 0.23, specificHeatGas: 0.23, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.1, thermalConductivityLiquid: 1.1, thermalConductivityGas: 1.1, paintable: true },
  { name: 'PbI2', molarMass: 461.01, color: '#e8c531', density: 6.16, phaseAtSTP: 'solid', meltingPointC: 402, boilingPointC: 872, specificHeatSolid: 0.16, specificHeatLiquid: 0.16, specificHeatGas: 0.16, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.9, thermalConductivityLiquid: 0.9, thermalConductivityGas: 0.9, paintable: true },
  { name: 'AgBr', molarMass: 187.77, color: '#ece0bc', density: 6.47, phaseAtSTP: 'solid', meltingPointC: 432, boilingPointC: 1502, specificHeatSolid: 0.21, specificHeatLiquid: 0.21, specificHeatGas: 0.21, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.2, thermalConductivityLiquid: 1.2, thermalConductivityGas: 1.2, paintable: true },
  { name: 'AgI', molarMass: 234.77, color: '#e8d878', density: 5.68, phaseAtSTP: 'solid', meltingPointC: 558, boilingPointC: 1506, specificHeatSolid: 0.15, specificHeatLiquid: 0.15, specificHeatGas: 0.15, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'NaBr', molarMass: 102.89, color: '#e8e8e8', density: 3.21, phaseAtSTP: 'solid', meltingPointC: 747, boilingPointC: 1396, specificHeatSolid: 0.43, specificHeatLiquid: 0.43, specificHeatGas: 0.43, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 5.5, thermalConductivityLiquid: 5.5, thermalConductivityGas: 5.5, paintable: true },
  { name: 'NaI', molarMass: 149.89, color: '#e8e8e8', density: 3.67, phaseAtSTP: 'solid', meltingPointC: 660, boilingPointC: 1304, specificHeatSolid: 0.34, specificHeatLiquid: 0.34, specificHeatGas: 0.34, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 4.5, thermalConductivityLiquid: 4.5, thermalConductivityGas: 4.5, paintable: true },
  { name: 'KBr', molarMass: 119.00, color: '#e8e8e8', density: 2.75, phaseAtSTP: 'solid', meltingPointC: 734, boilingPointC: 1435, specificHeatSolid: 0.44, specificHeatLiquid: 0.44, specificHeatGas: 0.44, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 4.8, thermalConductivityLiquid: 4.8, thermalConductivityGas: 4.8, paintable: true },
  { name: 'KI', molarMass: 166.00, color: '#e8e8e8', density: 3.13, phaseAtSTP: 'solid', meltingPointC: 681, boilingPointC: 1330, specificHeatSolid: 0.33, specificHeatLiquid: 0.33, specificHeatGas: 0.33, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 4.0, thermalConductivityLiquid: 4.0, thermalConductivityGas: 4.0, paintable: true },
  { name: 'MgBr2', molarMass: 184.11, color: '#e8e8e8', density: 3.72, phaseAtSTP: 'solid', meltingPointC: 711, boilingPointC: 1250, specificHeatSolid: 0.37, specificHeatLiquid: 0.37, specificHeatGas: 0.37, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'MgI2', molarMass: 278.11, color: '#e8e2d8', density: 4.43, phaseAtSTP: 'solid', meltingPointC: 637, boilingPointC: 1090, specificHeatSolid: 0.25, specificHeatLiquid: 0.25, specificHeatGas: 0.25, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.9, thermalConductivityLiquid: 0.9, thermalConductivityGas: 0.9, paintable: true },
  { name: 'CaBr2', molarMass: 199.89, color: '#e8e8e8', density: 3.35, phaseAtSTP: 'solid', meltingPointC: 730, boilingPointC: 1815, specificHeatSolid: 0.37, specificHeatLiquid: 0.37, specificHeatGas: 0.37, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'CaI2', molarMass: 293.89, color: '#e8e2d0', density: 3.96, phaseAtSTP: 'solid', meltingPointC: 779, boilingPointC: 1100, specificHeatSolid: 0.26, specificHeatLiquid: 0.26, specificHeatGas: 0.26, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.9, thermalConductivityLiquid: 0.9, thermalConductivityGas: 0.9, paintable: true },

  // -- nitrates: universally soluble, so they're the standard "soluble
  // cation source" reagent for precipitation reactions below --
  { name: 'AgNO3', molarMass: 169.87, color: '#f0f0f0', density: 4.35, phaseAtSTP: 'solid', meltingPointC: 212, boilingPointC: 444, specificHeatSolid: 0.29, specificHeatLiquid: 0.29, specificHeatGas: 0.29, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.4, thermalConductivityLiquid: 0.4, thermalConductivityGas: 0.4, paintable: true },
  { name: 'Pb(NO3)2', molarMass: 331.21, color: '#f0f0ec', density: 4.53, phaseAtSTP: 'solid', meltingPointC: 470, boilingPointC: 500, specificHeatSolid: 0.29, specificHeatLiquid: 0.29, specificHeatGas: 0.29, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'NaNO3', molarMass: 84.99, color: '#f0f0ec', density: 2.26, phaseAtSTP: 'solid', meltingPointC: 308, boilingPointC: 380, specificHeatSolid: 1.11, specificHeatLiquid: 1.11, specificHeatGas: 1.11, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'KNO3', molarMass: 101.10, color: '#f0f0ec', density: 2.11, phaseAtSTP: 'solid', meltingPointC: 334, boilingPointC: 400, specificHeatSolid: 0.95, specificHeatLiquid: 0.95, specificHeatGas: 0.95, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'Ba(NO3)2', molarMass: 261.34, color: '#f0f0ec', density: 3.24, phaseAtSTP: 'solid', meltingPointC: 592, boilingPointC: 650, specificHeatSolid: 0.38, specificHeatLiquid: 0.38, specificHeatGas: 0.38, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },
  { name: 'Cu(NO3)2', molarMass: 187.56, color: '#3a7ab5', density: 3.05, phaseAtSTP: 'solid', meltingPointC: 114, boilingPointC: 170, specificHeatSolid: 0.68, specificHeatLiquid: 0.68, specificHeatGas: 0.68, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },
  { name: 'Fe(NO3)3', molarMass: 241.86, color: '#c07840', density: 1.68, phaseAtSTP: 'solid', meltingPointC: 47.2, boilingPointC: 125, specificHeatSolid: 0.6, specificHeatLiquid: 0.6, specificHeatGas: 0.6, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'Ca(NO3)2', molarMass: 164.09, color: '#f0f0ec', density: 2.50, phaseAtSTP: 'solid', meltingPointC: 561, boilingPointC: 600, specificHeatSolid: 1.13, specificHeatLiquid: 1.13, specificHeatGas: 1.13, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },

  // -- sulfates: BaSO4/PbSO4/CaSO4 are the classically insoluble ones (see
  // reactions.ts -- no dissolution rule for any of the three) --
  { name: 'Na2SO4', molarMass: 142.04, color: '#f0f0ec', density: 2.66, phaseAtSTP: 'solid', meltingPointC: 884, boilingPointC: 1429, specificHeatSolid: 0.9, specificHeatLiquid: 0.9, specificHeatGas: 0.9, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'K2SO4', molarMass: 174.26, color: '#f0f0ec', density: 2.66, phaseAtSTP: 'solid', meltingPointC: 1069, boilingPointC: 1689, specificHeatSolid: 0.85, specificHeatLiquid: 0.85, specificHeatGas: 0.85, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'CuSO4', molarMass: 159.61, color: '#dfe4e8', density: 3.60, phaseAtSTP: 'solid', meltingPointC: 560, boilingPointC: 650, specificHeatSolid: 0.65, specificHeatLiquid: 0.65, specificHeatGas: 0.65, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },
  { name: 'MgSO4', molarMass: 120.37, color: '#f0f0ec', density: 2.66, phaseAtSTP: 'solid', meltingPointC: 1124, boilingPointC: 1200, specificHeatSolid: 0.8, specificHeatLiquid: 0.8, specificHeatGas: 0.8, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },
  { name: 'ZnSO4', molarMass: 161.47, color: '#f0f0ec', density: 3.54, phaseAtSTP: 'solid', meltingPointC: 680, boilingPointC: 740, specificHeatSolid: 0.6, specificHeatLiquid: 0.6, specificHeatGas: 0.6, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'FeSO4', molarMass: 151.91, color: '#e8ecd8', density: 2.84, phaseAtSTP: 'solid', meltingPointC: 680, boilingPointC: 700, specificHeatSolid: 0.65, specificHeatLiquid: 0.65, specificHeatGas: 0.65, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'BaSO4', molarMass: 233.39, color: '#f5f5f0', density: 4.50, phaseAtSTP: 'solid', meltingPointC: 1580, boilingPointC: 1600, specificHeatSolid: 0.45, specificHeatLiquid: 0.45, specificHeatGas: 0.45, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.2, thermalConductivityLiquid: 1.2, thermalConductivityGas: 1.2, paintable: true },
  { name: 'PbSO4', molarMass: 303.26, color: '#f0f0ec', density: 6.29, phaseAtSTP: 'solid', meltingPointC: 1170, boilingPointC: 1200, specificHeatSolid: 0.28, specificHeatLiquid: 0.28, specificHeatGas: 0.28, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },
  { name: 'CaSO4', molarMass: 136.14, color: '#f0ece0', density: 2.96, phaseAtSTP: 'solid', meltingPointC: 1460, boilingPointC: 1600, specificHeatSolid: 0.73, specificHeatLiquid: 0.73, specificHeatGas: 0.73, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.3, thermalConductivityLiquid: 1.3, thermalConductivityGas: 1.3, paintable: true },

  // -- carbonates: only the alkali-metal ones (Na2CO3/K2CO3) are soluble;
  // CaCO3/BaCO3/CuCO3 are the insoluble ones (no dissolution rule) --
  { name: 'Na2CO3', molarMass: 105.99, color: '#f0f0ec', density: 2.54, phaseAtSTP: 'solid', meltingPointC: 851, boilingPointC: 1600, specificHeatSolid: 1.04, specificHeatLiquid: 1.04, specificHeatGas: 1.04, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'K2CO3', molarMass: 138.21, color: '#f0f0ec', density: 2.43, phaseAtSTP: 'solid', meltingPointC: 891, boilingPointC: 1650, specificHeatSolid: 0.9, specificHeatLiquid: 0.9, specificHeatGas: 0.9, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'CaCO3', molarMass: 100.09, color: '#f5f5f0', density: 2.71, phaseAtSTP: 'solid', meltingPointC: 1339, boilingPointC: 1600, specificHeatSolid: 0.82, specificHeatLiquid: 0.82, specificHeatGas: 0.82, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 2.2, thermalConductivityLiquid: 2.2, thermalConductivityGas: 2.2, paintable: true },
  { name: 'BaCO3', molarMass: 197.34, color: '#f0f0ec', density: 4.29, phaseAtSTP: 'solid', meltingPointC: 811, boilingPointC: 1450, specificHeatSolid: 0.41, specificHeatLiquid: 0.41, specificHeatGas: 0.41, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.2, thermalConductivityLiquid: 1.2, thermalConductivityGas: 1.2, paintable: true },
  { name: 'CuCO3', molarMass: 123.55, color: '#3f8f6a', density: 4.0, phaseAtSTP: 'solid', meltingPointC: 200, boilingPointC: 290, specificHeatSolid: 0.6, specificHeatLiquid: 0.6, specificHeatGas: 0.6, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 1.0, thermalConductivityLiquid: 1.0, thermalConductivityGas: 1.0, paintable: true },

  // -- hydroxide precipitates: all insoluble (no dissolution rule), formed
  // by cation(aq) + OH-(aq) below --
  { name: 'Mg(OH)2', molarMass: 58.32, color: '#f5f5f0', density: 2.34, phaseAtSTP: 'solid', meltingPointC: 350, boilingPointC: 400, specificHeatSolid: 1.35, specificHeatLiquid: 1.35, specificHeatGas: 1.35, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'Cu(OH)2', molarMass: 97.56, color: '#3f9ec4', density: 3.37, phaseAtSTP: 'solid', meltingPointC: 80, boilingPointC: 150, specificHeatSolid: 0.87, specificHeatLiquid: 0.87, specificHeatGas: 0.87, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.6, thermalConductivityLiquid: 0.6, thermalConductivityGas: 0.6, paintable: true },
  { name: 'Fe(OH)2', molarMass: 89.86, color: '#7d9463', density: 3.4, phaseAtSTP: 'solid', meltingPointC: 100, boilingPointC: 200, specificHeatSolid: 0.5, specificHeatLiquid: 0.5, specificHeatGas: 0.5, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'Fe(OH)3', molarMass: 106.87, color: '#8a4a22', density: 3.5, phaseAtSTP: 'solid', meltingPointC: 300, boilingPointC: 400, specificHeatSolid: 0.5, specificHeatLiquid: 0.5, specificHeatGas: 0.5, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'Al(OH)3', molarMass: 78.00, color: '#f5f5f0', density: 2.42, phaseAtSTP: 'solid', meltingPointC: 300, boilingPointC: 400, specificHeatSolid: 1.3, specificHeatLiquid: 1.3, specificHeatGas: 1.3, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },
  { name: 'Zn(OH)2', molarMass: 99.42, color: '#f5f5f0', density: 3.05, phaseAtSTP: 'solid', meltingPointC: 125, boilingPointC: 200, specificHeatSolid: 0.9, specificHeatLiquid: 0.9, specificHeatGas: 0.9, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },

  // -- ammonium chloride: the classic NH3(g) + HCl(g) -> white-smoke solid --
  { name: 'NH4Cl', molarMass: 53.49, color: '#f0f0ec', density: 1.53, phaseAtSTP: 'solid', meltingPointC: 338, boilingPointC: 520, specificHeatSolid: 1.5, specificHeatLiquid: 1.5, specificHeatGas: 1.5, heatOfFusion: 0, heatOfVaporization: 0, thermalConductivitySolid: 0.5, thermalConductivityLiquid: 0.5, thermalConductivityGas: 0.5, paintable: true },


  // -- aqueous acids/bases: hydration products of the pure acids/bases/gases
  // above (see reactions.ts's hydrolysis section). Colors carry real
  // characteristic ion tints where they exist (Fe3+ yellow-brown, Fe2+ pale
  // green, Cu2+ blue) so the classic qualitative-analysis colors show up on
  // the grid. All new aqueous species are paintable:true per this pass. --
  { name: 'HCl(aq)', molarMass: 36.46, color: '#dce8e0', density: 1.05, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'H2SO4(aq)', molarMass: 98.079, color: '#e8ece0', density: 1.3, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'HNO3(aq)', molarMass: 63.01, color: '#f0ecd0', density: 1.3, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'HBr(aq)', molarMass: 80.91, color: '#e0ece0', density: 1.3, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'HI(aq)', molarMass: 127.91, color: '#ece0c8', density: 1.5, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'H2CO3(aq)', molarMass: 62.03, color: '#3a7898', density: 1.0, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'H2SO3(aq)', molarMass: 82.07, color: '#c8d8b0', density: 1.03, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'NaOH(aq)', molarMass: 39.997, color: '#4a7ab0', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'KOH(aq)', molarMass: 56.11, color: '#4a7ab5', density: 1.13, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'Ca(OH)2(aq)', molarMass: 74.09, color: '#a8c8d8', density: 1.02, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'Ba(OH)2(aq)', molarMass: 171.34, color: '#4a7ab5', density: 1.10, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'NH3(aq)', molarMass: 17.031, color: '#c8e8f0', density: 0.92, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },

  // -- aqueous halides (soluble ones only -- AgBr/AgI/PbCl2/PbBr2/PbI2 are
  // insoluble and have no (aq) form, same as AgCl) --
  { name: 'BaCl2(aq)', molarMass: 208.23, color: '#4a6fb0', density: 1.25, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'BaBr2(aq)', molarMass: 297.14, color: '#3f68a8', density: 1.35, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'BaI2(aq)', molarMass: 391.14, color: '#3a60a0', density: 1.45, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'AlCl3(aq)', molarMass: 133.34, color: '#4a7ab5', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'AlBr3(aq)', molarMass: 266.69, color: '#3f70ac', density: 1.28, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'AlI3(aq)', molarMass: 407.69, color: '#3a68a0', density: 1.40, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'FeCl2(aq)', molarMass: 126.75, color: '#8fae6a', density: 1.20, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'FeCl3(aq)', molarMass: 162.20, color: '#a8622a', density: 1.25, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'FeBr3(aq)', molarMass: 295.56, color: '#a05a28', density: 1.35, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'FeI2(aq)', molarMass: 309.65, color: '#6a8a5a', density: 1.30, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'CuCl2(aq)', molarMass: 134.45, color: '#2a7ab0', density: 1.20, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'CuBr2(aq)', molarMass: 223.35, color: '#2a6a9a', density: 1.30, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'ZnCl2(aq)', molarMass: 136.30, color: '#4a7ab5', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'ZnBr2(aq)', molarMass: 225.20, color: '#3f70ac', density: 1.25, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'ZnI2(aq)', molarMass: 319.20, color: '#3a68a0', density: 1.35, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'NaBr(aq)', molarMass: 102.89, color: '#4a7ab5', density: 1.12, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'NaI(aq)', molarMass: 149.89, color: '#3f70ac', density: 1.18, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'KBr(aq)', molarMass: 119.00, color: '#4a75b0', density: 1.10, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'KI(aq)', molarMass: 166.00, color: '#3f6ea8', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'MgBr2(aq)', molarMass: 184.11, color: '#3f68a0', density: 1.20, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'MgI2(aq)', molarMass: 278.11, color: '#3a6098', density: 1.28, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'CaBr2(aq)', molarMass: 199.89, color: '#3f68a0', density: 1.22, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'CaI2(aq)', molarMass: 293.89, color: '#3a6098', density: 1.30, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },

  // -- aqueous nitrates (all soluble) --
  { name: 'AgNO3(aq)', molarMass: 169.87, color: '#4a7ab5', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'Pb(NO3)2(aq)', molarMass: 331.21, color: '#3f70ac', density: 1.25, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'NaNO3(aq)', molarMass: 84.99, color: '#4a7ab5', density: 1.10, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'KNO3(aq)', molarMass: 101.10, color: '#4a75b0', density: 1.08, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'Ba(NO3)2(aq)', molarMass: 261.34, color: '#3f68a8', density: 1.20, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'Cu(NO3)2(aq)', molarMass: 187.56, color: '#1f6fb8', density: 1.20, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'Fe(NO3)3(aq)', molarMass: 241.86, color: '#a8622a', density: 1.22, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'Ca(NO3)2(aq)', molarMass: 164.09, color: '#4a7ab5', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },

  // -- aqueous sulfates (only the soluble ones -- BaSO4/PbSO4/CaSO4 stay
  // solid-only, no dissolution rule) --
  { name: 'Na2SO4(aq)', molarMass: 142.04, color: '#4a7ab5', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'K2SO4(aq)', molarMass: 174.26, color: '#4a75b0', density: 1.13, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'CuSO4(aq)', molarMass: 159.61, color: '#1f6fb8', density: 1.25, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'MgSO4(aq)', molarMass: 120.37, color: '#4a7ab5', density: 1.15, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'ZnSO4(aq)', molarMass: 161.47, color: '#4a7ab5', density: 1.20, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'FeSO4(aq)', molarMass: 151.91, color: '#8fae6a', density: 1.20, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },

  // -- aqueous carbonates (only alkali-metal ones are soluble) --
  { name: 'Na2CO3(aq)', molarMass: 105.99, color: '#4a7ab5', density: 1.10, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
  { name: 'K2CO3(aq)', molarMass: 138.21, color: '#4a75b0', density: 1.12, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },

  { name: 'NH4Cl(aq)', molarMass: 53.49, color: '#4a7ab5', density: 1.07, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: true },
];

export const SpeciesId = {
  H2: 0, N2: 1, O2: 2, Cl2: 3, C: 4, Na: 5, Mg: 6, Al: 7, S: 8, K: 9,
  Ca: 10, Fe: 11, Cu: 12, Zn: 13, Ag: 14,
  H2O: 15, NaCl: 16, AgCl: 17, CO2: 18, HCl: 19, NH3: 20, H2O2: 21, O3: 22,
  Fe2O3: 23, Al2O3: 24, FeS: 25, CuO: 26, ZnO: 27, NaOH: 28, CaCl2: 29, MgCl2: 30, KCl: 31,
  NaClAq: 32, KClAq: 33, CaCl2Aq: 34, MgCl2Aq: 35,

  // -- halogen-metal / precipitation / acid-base / hydrolysis / dissolution
  // expansion (see the matching comment block in SPECIES above) --
  Br2: 36, I2: 37, Pb: 38, Ba: 39,
  H2SO4: 40, HNO3: 41, HBr: 42, HI: 43,
  KOH: 44, CaOH2: 45, BaOH2: 46,
  MgO: 47, CaO: 48, BaO: 49, Na2O: 50, K2O: 51, PbO: 52, Ag2O: 53,
  SO2: 54, SO3: 55, NO: 56, NO2: 57,
  BaCl2: 58, BaBr2: 59, BaI2: 60, AlCl3: 61, AlBr3: 62, AlI3: 63,
  FeCl2: 64, FeCl3: 65, FeBr3: 66, FeI2: 67, CuCl2: 68, CuBr2: 69,
  ZnCl2: 70, ZnBr2: 71, ZnI2: 72, PbCl2: 73, PbBr2: 74, PbI2: 75,
  AgBr: 76, AgI: 77, NaBr: 78, NaI: 79, KBr: 80, KI: 81,
  MgBr2: 82, MgI2: 83, CaBr2: 84, CaI2: 85,
  AgNO3: 86, PbNO32: 87, NaNO3: 88, KNO3: 89, BaNO32: 90, CuNO32: 91, FeNO33: 92, CaNO32: 93,
  Na2SO4: 94, K2SO4: 95, CuSO4: 96, MgSO4: 97, ZnSO4: 98, FeSO4: 99,
  BaSO4: 100, PbSO4: 101, CaSO4: 102,
  Na2CO3: 103, K2CO3: 104, CaCO3: 105, BaCO3: 106, CuCO3: 107,
  MgOH2: 108, CuOH2: 109, FeOH2: 110, FeOH3: 111, AlOH3: 112, ZnOH2: 113,
  NH4Cl: 114,
  HClAq: 115, H2SO4Aq: 116, HNO3Aq: 117, HBrAq: 118, HIAq: 119, H2CO3Aq: 120, H2SO3Aq: 121,
  NaOHAq: 122, KOHAq: 123, CaOH2Aq: 124, BaOH2Aq: 125, NH3Aq: 126,
  BaCl2Aq: 127, BaBr2Aq: 128, BaI2Aq: 129, AlCl3Aq: 130, AlBr3Aq: 131, AlI3Aq: 132,
  FeCl2Aq: 133, FeCl3Aq: 134, FeBr3Aq: 135, FeI2Aq: 136, CuCl2Aq: 137, CuBr2Aq: 138,
  ZnCl2Aq: 139, ZnBr2Aq: 140, ZnI2Aq: 141, NaBrAq: 142, NaIAq: 143, KBrAq: 144, KIAq: 145,
  MgBr2Aq: 146, MgI2Aq: 147, CaBr2Aq: 148, CaI2Aq: 149,
  AgNO3Aq: 150, PbNO32Aq: 151, NaNO3Aq: 152, KNO3Aq: 153, BaNO32Aq: 154, CuNO32Aq: 155,
  FeNO33Aq: 156, CaNO32Aq: 157,
  Na2SO4Aq: 158, K2SO4Aq: 159, CuSO4Aq: 160, MgSO4Aq: 161, ZnSO4Aq: 162, FeSO4Aq: 163,
  Na2CO3Aq: 164, K2CO3Aq: 165,
  NH4ClAq: 166,
} as const;
