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

  // -- aqueous dissolution products, borrow water's thermal profile wholesale --
  { name: 'Na+(aq)', molarMass: 22.990, color: '#7ec9ff', density: 1.0, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
  { name: 'Cl-(aq)', molarMass: 35.45, color: '#c8e070', density: 1.0, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
  { name: 'K+(aq)', molarMass: 39.098, color: '#c9a8ff', density: 1.0, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
  { name: 'Ca2+(aq)', molarMass: 40.078, color: '#a8d8b0', density: 1.0, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
  { name: 'Mg2+(aq)', molarMass: 24.305, color: '#b0e0c0', density: 1.0, phaseAtSTP: 'aqueous', ...WATER_THERMAL, paintable: false },
];

export const SpeciesId = {
  H2: 0, N2: 1, O2: 2, Cl2: 3, C: 4, Na: 5, Mg: 6, Al: 7, S: 8, K: 9,
  Ca: 10, Fe: 11, Cu: 12, Zn: 13, Ag: 14,
  H2O: 15, NaCl: 16, AgCl: 17, CO2: 18, HCl: 19, NH3: 20, H2O2: 21, O3: 22,
  Fe2O3: 23, Al2O3: 24, FeS: 25, CuO: 26, ZnO: 27, NaOH: 28, CaCl2: 29, MgCl2: 30, KCl: 31,
  NaPlusAq: 32, ClMinusAq: 33, KPlusAq: 34, Ca2PlusAq: 35, Mg2PlusAq: 36,
} as const;
