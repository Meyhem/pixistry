// Achievements -- the 5 named in .grill/campaign-mode.md's §6 point 7, each
// given a concrete, honestly-detectable trigger derived from data that
// already exists (species-data.ts's insoluble/precipitate species, a frame's
// own specId/phase/tempK arrays) rather than anything requiring new sim
// instrumentation. See app.ts's checkAchievements call site for how each
// trigger is actually evaluated against live frame/objective data.
export interface Achievement {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const ACHIEVEMENTS: readonly Achievement[] = [
  { id: 'first-precipitate', title: 'First Precipitate', description: 'Make an insoluble solid form out of two aqueous solutions.' },
  { id: 'white-smoke', title: 'White Smoke', description: 'Combine NH3 and HCl gas into solid NH4Cl.' },
  { id: 'zero-waste', title: 'Zero Waste', description: 'Hit 100% purity on a collection goal.' },
  { id: 'thermal-runaway-survivor', title: 'Thermal Runaway Survivor', description: 'Get a cell above 2000 K and live to tell about it.' },
  { id: 'made-it-rain', title: 'Made It Rain', description: 'Have 150+ pixels of liquid water on the bench at once.' },
];

/** Every species-data.ts species with no dissolution rule in reactions.ts --
 * i.e. every precipitate the sim can form (see reactions.ts's own section E
 * "Precipitation" and its section F doc comment listing exactly these as
 * the deliberately-omitted ones, plus AgCl, the original calibration
 * point). Kept as a name list here rather than derived from REACTIONS at
 * runtime -- deriving "has no dissolution rule" would require scanning the
 * whole table for every species on every frame, and this list changes only
 * when reactions.ts's own precipitation section does. */
export const PRECIPITATE_LABELS: ReadonlySet<string> = new Set([
  'AgCl', 'AgBr', 'AgI', 'PbCl2', 'PbBr2', 'PbI2',
  'BaSO4', 'PbSO4', 'CaSO4', 'CaCO3', 'BaCO3', 'CuCO3',
  'Mg(OH)2', 'Cu(OH)2', 'Fe(OH)2', 'Fe(OH)3', 'Al(OH)3', 'Zn(OH)2',
]);

export const THERMAL_RUNAWAY_THRESHOLD_K = 2000;
export const MADE_IT_RAIN_LIQUID_H2O_COUNT = 150;
