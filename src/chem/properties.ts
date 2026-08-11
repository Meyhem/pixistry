import { bondDipoleMagnitude, bondDissociationEnergy, estimateLonePairs, vseprBondVectors, type Vec3 } from './bonds';
import { getElement } from './elements';
import { moleculeToFormula, netCharge } from './formula';
import { applyOverrides } from './overrides';
import type { Atom, ElementSymbol, MoleculeGraph, MoleculeProperties } from './types';
import { Phase } from './types';

// Cumulative ionization energy (metals, positive charge) or
// electron-affinity-derived cost (nonmetals, negative charge) to bring a
// neutral gas-phase atom to the given formal charge, kJ/mol. Real tabulated
// values -- plain bond-additivity has no other way to distinguish a bare
// ion's formation enthalpy from its neutral atom's (it never looks at
// charge), so without this a reaction could "ionize for free".
const IONIZATION_COST: Partial<Record<ElementSymbol, Record<string, number>>> = {
  Na: { '1': 496 },
  Mg: { '2': 2189 },
  Al: { '3': 5139 },
  K: { '1': 419 },
  Ca: { '2': 1735 },
  Fe: { '2': 2324, '3': 5281 },
  Cu: { '1': 745, '2': 2703 },
  Zn: { '1': 906, '2': 2639 },
  Ag: { '1': 731 },
  H: { '1': 1312, '-1': -72.8 },
  N: { '-3': 2200 },
  O: { '-1': -141, '-2': 603 },
  S: { '-2': 256 },
  Cl: { '-1': -349 },
};

function ionizationCost(element: ElementSymbol, charge: number): number {
  if (charge === 0) return 0;
  return IONIZATION_COST[element]?.[String(charge)] ?? 0;
}

// Rough van der Waals radii (pm), used only for the density estimate.
// Standard-ish Bondi/CRC values; precision beyond ~5% doesn't matter here
// since density is a coarse fallback for non-overridden species.
const VDW_RADIUS_PM: Record<string, number> = {
  H: 120, C: 170, N: 155, O: 152, Na: 227, Mg: 173, Al: 184, S: 180, Cl: 175,
  K: 275, Ca: 231, Fe: 194, Cu: 140, Zn: 139, Ag: 172,
};

function buildAdjacency(graph: MoleculeGraph): Map<number, { to: number; order: number }[]> {
  const adj = new Map<number, { to: number; order: number }[]>();
  for (const atom of graph.atoms) adj.set(atom.id, []);
  for (const bond of graph.bonds) {
    adj.get(bond.a)?.push({ to: bond.b, order: bond.order });
    adj.get(bond.b)?.push({ to: bond.a, order: bond.order });
  }
  return adj;
}

function estimateDeltaHf(graph: MoleculeGraph): number {
  const byId = new Map(graph.atoms.map((a) => [a.id, a]));
  let atomization = 0;
  for (const atom of graph.atoms) {
    atomization += getElement(atom.element).atomizationEnthalpy + ionizationCost(atom.element, atom.charge);
  }
  let bondEnergy = 0;
  for (const bond of graph.bonds) {
    const a = byId.get(bond.a);
    const b = byId.get(bond.b);
    if (!a || !b) continue;
    bondEnergy += bondDissociationEnergy(a.element, b.element, bond.order);
  }
  return atomization - bondEnergy;
}

// Calibrated against O2 (205.2), N2 (191.6), CO2 (213.8), NH3 (192.8) J/mol/K.
// A crude 3-parameter correlation, not first-principles statistical mechanics
// -- see the plan doc. Floored to avoid nonsense near MW=1.
function estimateEntropy(molarMass: number, atomCount: number): number {
  const raw = -20 + 50 * Math.log(molarMass) + 25 * (atomCount - 1);
  return Math.max(raw, 60);
}

function hasHydrogenBondDonor(graph: MoleculeGraph): boolean {
  const byId = new Map(graph.atoms.map((a) => [a.id, a]));
  return graph.bonds.some((b) => {
    const a = byId.get(b.a);
    const c = byId.get(b.b);
    if (!a || !c || b.order !== 1) return false;
    const pair = [a.element, c.element];
    return pair.includes('H') && (pair.includes('O') || pair.includes('N'));
  });
}

function estimateBoilingMelting(
  molarMass: number,
  dipole: number,
  hBondDonor: boolean,
  ionic: boolean,
): { bpK: number; mpK: number } {
  if (ionic) {
    const bpK = 1200 + 5 * molarMass;
    return { bpK, mpK: bpK - 500 };
  }
  const bpK = 100 + 0.6 * molarMass + 40 * dipole + (hBondDonor ? 80 : 0);
  const mpK = bpK - Math.max(40, 0.5 * molarMass + (hBondDonor ? 60 : 20));
  return { bpK, mpK };
}

function derivePhase(boilingPointC: number, meltingPointC: number): Phase {
  const roomTempC = 25;
  if (roomTempC < meltingPointC) return Phase.Solid;
  if (roomTempC < boilingPointC) return Phase.Liquid;
  return Phase.Gas;
}

// Approximate: picks the highest-degree atom as a "central atom", builds its
// VSEPR bond directions in a shared frame, and vector-sums only the bonds
// attached to it. This gives a physically meaningful result for star-shaped
// molecules (H2O, NH3, sulfate-like); for chain molecules (e.g. H2O2) it
// only captures the central atom's local bonds, an intentional, documented
// simplification rather than full 3D molecular geometry construction.
function estimateDipole(graph: MoleculeGraph): number {
  if (graph.atoms.length < 2) return 0;
  const adj = buildAdjacency(graph);
  const byId = new Map(graph.atoms.map((a) => [a.id, a]));

  let central: Atom = graph.atoms[0] as Atom;
  let maxDegree = -1;
  for (const atom of graph.atoms) {
    const degree = (adj.get(atom.id) ?? []).length;
    if (degree > maxDegree) {
      maxDegree = degree;
      central = atom;
    }
  }

  const neighbors = adj.get(central.id) ?? [];
  if (neighbors.length === 0) return 0;

  const lonePairs = estimateLonePairs(central.element);
  const directions = vseprBondVectors(neighbors.length, lonePairs);
  const centralEN = getElement(central.element).electronegativity;

  const sum: Vec3 = { x: 0, y: 0, z: 0 };
  neighbors.forEach((n, i) => {
    const dir = directions[i];
    const neighborAtom = byId.get(n.to);
    if (!dir || !neighborAtom) return;
    const magnitude = bondDipoleMagnitude(central.element, neighborAtom.element);
    const neighborEN = getElement(neighborAtom.element).electronegativity;
    const sign = neighborEN >= centralEN ? 1 : -1;
    sum.x += dir.x * magnitude * sign;
    sum.y += dir.y * magnitude * sign;
    sum.z += dir.z * magnitude * sign;
  });

  return Math.sqrt(sum.x ** 2 + sum.y ** 2 + sum.z ** 2);
}

function estimateDensity(graph: MoleculeGraph, molarMass: number): number {
  const packingFactor = 0.65;
  let totalVolumePm3 = 0;
  for (const atom of graph.atoms) {
    const r = VDW_RADIUS_PM[atom.element] ?? getElement(atom.element).covalentRadius * 1.8;
    totalVolumePm3 += (4 / 3) * Math.PI * r ** 3;
  }
  const volumePerMoleculeCm3 = (totalVolumePm3 / packingFactor) * 1e-30;
  const N_A = 6.02214076e23;
  const molarVolumeCm3 = volumePerMoleculeCm3 * N_A;
  return molarVolumeCm3 > 0 ? molarMass / molarVolumeCm3 : 0;
}

function detectRadical(graph: MoleculeGraph): boolean {
  const bondOrderSum = new Map<number, number>();
  for (const bond of graph.bonds) {
    bondOrderSum.set(bond.a, (bondOrderSum.get(bond.a) ?? 0) + bond.order);
    bondOrderSum.set(bond.b, (bondOrderSum.get(bond.b) ?? 0) + bond.order);
  }
  for (const atom of graph.atoms) {
    if (atom.charge !== 0) continue;
    const sum = bondOrderSum.get(atom.id) ?? 0;
    const valences = getElement(atom.element).standardValences;
    if (!valences.includes(sum)) return true;
  }
  return false;
}

function hslToHex(h: number, s: number, l: number): string {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = light - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) {
    r = c; g = x; b = 0;
  } else if (h < 120) {
    r = x; g = c; b = 0;
  } else if (h < 180) {
    r = 0; g = c; b = x;
  } else if (h < 240) {
    r = 0; g = x; b = c;
  } else if (h < 300) {
    r = x; g = 0; b = c;
  } else {
    r = c; g = 0; b = x;
  }
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function estimateColor(graph: MoleculeGraph, dipole: number): string {
  let weightedZ = 0;
  let total = 0;
  for (const atom of graph.atoms) {
    weightedZ += getElement(atom.element).Z;
    total += 1;
  }
  const hue = total > 0 ? ((weightedZ / total) * 7) % 360 : 0;
  const saturation = Math.min(100, 30 + dipole * 25);
  return hslToHex(hue, saturation, 55);
}

/** Pure function of a canonicalized MoleculeGraph -- estimates all physical
 * properties, then lets any curated OVERRIDES entry win field-by-field. */
export function computeProperties(graph: MoleculeGraph): MoleculeProperties {
  const formula = moleculeToFormula(graph);
  const molarMass = graph.atoms.reduce((sum, a) => sum + getElement(a.element).molarMass, 0);
  const deltaHf = estimateDeltaHf(graph);
  const standardEntropy = estimateEntropy(molarMass, graph.atoms.length);
  const dipoleMoment = estimateDipole(graph);
  const hBondDonor = hasHydrogenBondDonor(graph);
  const ionic = graph.bonds.some((b) => b.order === 0);
  const { bpK, mpK } = estimateBoilingMelting(molarMass, dipoleMoment, hBondDonor, ionic);
  const boilingPointC = bpK - 273.15;
  const meltingPointC = mpK - 273.15;
  const density = estimateDensity(graph, molarMass);
  const chargeTotal = netCharge(graph.atoms);
  const phaseAtSTP =
    graph.atoms.length === 1 && chargeTotal !== 0
      ? Phase.Aqueous
      : derivePhase(boilingPointC, meltingPointC);
  const isRadical = detectRadical(graph);
  const color = estimateColor(graph, dipoleMoment);

  const estimated: MoleculeProperties = {
    formula,
    molarMass,
    deltaHf,
    standardEntropy,
    dipoleMoment,
    boilingPointC,
    meltingPointC,
    density,
    phaseAtSTP,
    isRadical,
    netCharge: chargeTotal,
    color,
    source: 'estimated',
  };

  return applyOverrides(formula, estimated);
}
