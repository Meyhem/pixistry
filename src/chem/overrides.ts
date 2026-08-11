import { ELEMENT_SYMBOLS, ELEMENTS } from './elements';
import type { MoleculeProperties } from './types';
import { Phase } from './types';

type OverrideFields = Partial<Omit<MoleculeProperties, 'formula' | 'source'>>;

// Every element's own standard-reference-state formation enthalpy is zero by
// definition. For elements whose standard state is diatomic (H2, N2, O2,
// Cl2) that applies to the diatomic formula; for the rest (metals, C, S,
// modeled as an unbonded lattice atom) it applies to the bare-atom formula.
// A *monatomic* H/N/O/Cl species (radicals like H., O.) is deliberately left
// un-overridden -- its nonzero bond-additivity result correctly represents
// the real formation enthalpy of that gas-phase atom/radical.
function standardStateZeroOverrides(): Record<string, OverrideFields> {
  const result: Record<string, OverrideFields> = {};
  for (const symbol of ELEMENT_SYMBOLS) {
    const el = ELEMENTS[symbol];
    const key = el.pureElementForm === 'diatomic' ? `${symbol}2` : symbol;
    result[key] = { deltaHf: 0 };
  }
  return result;
}

// Curated measured values for compounds where precision matters (formula
// keys are Hill notation -- see formula.ts's doc comment for why "ClNa" and
// not "NaCl"). Fields are merged over the estimated properties field-by-field
// in applyOverrides, so a partial entry is fine.
const CURATED: Record<string, OverrideFields> = {
  H2O: {
    deltaHf: -285.8,
    standardEntropy: 69.9,
    dipoleMoment: 1.85,
    boilingPointC: 100,
    meltingPointC: 0,
    density: 1.0,
    phaseAtSTP: Phase.Liquid,
    color: '#3a6ea5',
    specificHeatSolid: 2.05,
    specificHeatLiquid: 4.184,
    specificHeatGas: 2.0,
    heatOfFusion: 333.55,
    heatOfVaporization: 2257,
    thermalConductivitySolid: 2.18,
    thermalConductivityLiquid: 0.6,
    thermalConductivityGas: 0.016,
  },
  ClNa: {
    deltaHf: -411.2,
    standardEntropy: 72.1,
    meltingPointC: 801,
    boilingPointC: 1465,
    density: 2.16,
    phaseAtSTP: Phase.Solid,
    color: '#e8e8e8',
  },
  CO2: {
    deltaHf: -393.5,
    standardEntropy: 213.8,
    boilingPointC: -78.5, // sublimation point, not a true liquid bp -- documented simplification
    phaseAtSTP: Phase.Gas,
    color: '#cfcfcf',
  },
  ClH: {
    deltaHf: -92.3,
    standardEntropy: 186.9,
    dipoleMoment: 1.05,
    boilingPointC: -85.1,
    meltingPointC: -114.2,
    phaseAtSTP: Phase.Gas,
  },
  H3N: {
    deltaHf: -45.9,
    standardEntropy: 192.8,
    dipoleMoment: 1.42,
    boilingPointC: -33.3,
    meltingPointC: -77.7,
    phaseAtSTP: Phase.Gas,
  },
  H2O2: {
    deltaHf: -187.8,
    standardEntropy: 109.6,
    boilingPointC: 150.2,
    meltingPointC: -0.4,
    phaseAtSTP: Phase.Liquid,
  },
  O3: {
    deltaHf: 142.7,
    standardEntropy: 238.9,
    boilingPointC: -111.9,
    phaseAtSTP: Phase.Gas,
    color: '#5fb0ff',
  },
  AgCl: {
    deltaHf: -127.0,
    meltingPointC: 455,
    density: 5.56,
    phaseAtSTP: Phase.Solid,
    color: '#e8e4d0',
  },
  Fe2O3: {
    deltaHf: -824.2,
    phaseAtSTP: Phase.Solid,
    color: '#9b4a2a',
  },
  Al2O3: {
    deltaHf: -1675.7,
    phaseAtSTP: Phase.Solid,
    color: '#e0e0e0',
  },
  FeS: {
    deltaHf: -100.0,
    phaseAtSTP: Phase.Solid,
    color: '#4a4038',
  },
  CuO: {
    deltaHf: -157.3,
    phaseAtSTP: Phase.Solid,
    color: '#2b2320',
  },
  OZn: {
    deltaHf: -350.5,
    phaseAtSTP: Phase.Solid,
    color: '#f0eee0',
  },
  HNaO: {
    deltaHf: -425.8,
    phaseAtSTP: Phase.Solid,
    color: '#e8e8e8',
  },
  CaCl2: {
    deltaHf: -795.8,
    phaseAtSTP: Phase.Solid,
    color: '#e8e8e8',
  },
  Cl2Mg: {
    deltaHf: -641.3,
    phaseAtSTP: Phase.Solid,
    color: '#e8e8e8',
  },
  ClK: {
    deltaHf: -436.5,
    phaseAtSTP: Phase.Solid,
    color: '#e8e8e8',
  },
};

// Bond-additivity estimation has no notion of metallic or lattice cohesion --
// a lone unbonded atom (how pure elements intern) estimates a near-zero bp,
// which would put every metal in the vapor phase at room temperature. Real
// measured mp/bp/density/color for each element's standard state, same
// override mechanism as any other precision-sensitive species.
// Specific heat (J/g/K), thermal conductivity (W/m/K, used as a relative
// rate constant -- see src/sim/heat.ts) and latent heats (J/g) are real
// measured values per element; the solid/liquid/gas split matters once
// conduction and phase change are simulated (M3), same override mechanism
// as mp/bp/density above.
const PURE_ELEMENTS: Record<string, OverrideFields> = {
  H2: {
    meltingPointC: -259.1, boilingPointC: -252.9, density: 0.00009, phaseAtSTP: Phase.Gas, color: '#eaf6ff',
    specificHeatGas: 14.3, thermalConductivityGas: 0.18,
  },
  N2: {
    meltingPointC: -210.0, boilingPointC: -195.8, density: 0.00125, phaseAtSTP: Phase.Gas, color: '#dfefff',
    specificHeatGas: 1.04, thermalConductivityGas: 0.026,
  },
  O2: {
    meltingPointC: -218.3, boilingPointC: -183.0, density: 0.00143, phaseAtSTP: Phase.Gas, color: '#a8d8ff',
    specificHeatGas: 0.918, thermalConductivityGas: 0.026,
  },
  Cl2: {
    meltingPointC: -101.5, boilingPointC: -34.0, density: 0.00321, phaseAtSTP: Phase.Gas, color: '#c8e070',
    specificHeatGas: 0.478, thermalConductivityGas: 0.0089,
  },
  C: {
    meltingPointC: 3550, boilingPointC: 4827, density: 2.26, phaseAtSTP: Phase.Solid, color: '#2b2b2b',
    specificHeatSolid: 0.709, thermalConductivitySolid: 5.7,
  },
  Na: {
    meltingPointC: 97.8, boilingPointC: 883, density: 0.97, phaseAtSTP: Phase.Solid, color: '#c9c2d8',
    specificHeatSolid: 1.23, thermalConductivitySolid: 140, thermalConductivityLiquid: 87,
    heatOfFusion: 113, heatOfVaporization: 3870,
  },
  Mg: {
    meltingPointC: 650, boilingPointC: 1091, density: 1.74, phaseAtSTP: Phase.Solid, color: '#e0e0e0',
    specificHeatSolid: 1.02, thermalConductivitySolid: 156, thermalConductivityLiquid: 78,
    heatOfFusion: 349, heatOfVaporization: 5267,
  },
  Al: {
    meltingPointC: 660.3, boilingPointC: 2519, density: 2.70, phaseAtSTP: Phase.Solid, color: '#c8c8cc',
    specificHeatSolid: 0.897, thermalConductivitySolid: 237, thermalConductivityLiquid: 91,
    heatOfFusion: 396, heatOfVaporization: 10500,
  },
  S: {
    meltingPointC: 115.2, boilingPointC: 444.6, density: 2.07, phaseAtSTP: Phase.Solid, color: '#e8d84a',
    specificHeatSolid: 0.71, thermalConductivitySolid: 0.205, heatOfFusion: 53,
  },
  K: {
    meltingPointC: 63.5, boilingPointC: 759, density: 0.86, phaseAtSTP: Phase.Solid, color: '#c9b8d8',
    specificHeatSolid: 0.757, thermalConductivitySolid: 102, thermalConductivityLiquid: 52,
    heatOfFusion: 60, heatOfVaporization: 1967,
  },
  Ca: {
    meltingPointC: 842, boilingPointC: 1484, density: 1.55, phaseAtSTP: Phase.Solid, color: '#b9b9a8',
    specificHeatSolid: 0.647, thermalConductivitySolid: 200, thermalConductivityLiquid: 100,
    heatOfFusion: 213, heatOfVaporization: 3765,
  },
  Fe: {
    meltingPointC: 1538, boilingPointC: 2862, density: 7.87, phaseAtSTP: Phase.Solid, color: '#8a8a8a',
    specificHeatSolid: 0.449, thermalConductivitySolid: 80, thermalConductivityLiquid: 33,
    heatOfFusion: 247, heatOfVaporization: 6094,
  },
  Cu: {
    meltingPointC: 1085, boilingPointC: 2562, density: 8.96, phaseAtSTP: Phase.Solid, color: '#b5651d',
    specificHeatSolid: 0.385, thermalConductivitySolid: 401, thermalConductivityLiquid: 160,
    heatOfFusion: 205, heatOfVaporization: 4720,
  },
  Zn: {
    meltingPointC: 419.5, boilingPointC: 907, density: 7.13, phaseAtSTP: Phase.Solid, color: '#a0a8ac',
    specificHeatSolid: 0.388, thermalConductivitySolid: 116, thermalConductivityLiquid: 60,
    heatOfFusion: 112, heatOfVaporization: 1760,
  },
  Ag: {
    meltingPointC: 961.8, boilingPointC: 2162, density: 10.49, phaseAtSTP: Phase.Solid, color: '#d8d8dc',
    specificHeatSolid: 0.235, thermalConductivitySolid: 429, thermalConductivityLiquid: 180,
    heatOfFusion: 105, heatOfVaporization: 2363,
  },
};

function mergeOverrides(...layers: Record<string, OverrideFields>[]): Record<string, OverrideFields> {
  const result: Record<string, OverrideFields> = {};
  for (const layer of layers) {
    for (const [key, fields] of Object.entries(layer)) {
      result[key] = { ...result[key], ...fields };
    }
  }
  return result;
}

export const OVERRIDES: Record<string, OverrideFields> = mergeOverrides(
  standardStateZeroOverrides(),
  CURATED,
  PURE_ELEMENTS,
);

export function applyOverrides(formula: string, estimated: MoleculeProperties): MoleculeProperties {
  const override = OVERRIDES[formula];
  if (!override) return { ...estimated, source: 'estimated' };
  return { ...estimated, ...override, source: 'override' };
}
