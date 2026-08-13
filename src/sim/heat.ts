// Energy/conduction/phase-change step (M3). U is stored per cell in joules;
// temperature is derived from it piecewise, with flat plateaus of width
// mass*heatOfFusion / mass*heatOfVaporization around the melt/boil points --
// this is what gives latent heat, superheating-free boiling plateaus, and
// phase change for free, with no per-species special-case code (see the
// design doc's Q9).
//
// A cell has no defined physical size, so "mass" is a nominal
// density * CELL_VOLUME_CM3 parcel and thermal conductivity is used as a
// relative rate constant between cells, not a literal W/(m*K) transport
// calculation over a real distance.
import { EMPTY, PhaseCode, SimGrid } from './grid';
import { RADIATOR_WATTS } from './radiators';
import type { SpeciesTable, ThermalProfile } from './species';
import { GLASS_WALL_SPEC_ID } from './walls';

export const CELL_VOLUME_CM3 = 1;
export const AMBIENT_TEMPERATURE_K = celsiusToKelvin(21);

// Every occupied cell drifts toward AMBIENT_TEMPERATURE_K regardless of how
// it got hot/cold (painted, radiator, reaction, conduction) -- otherwise a
// cell that's drifted away from any heat source holds its temperature
// forever. Capped at 1K/tick-second so it reads as a slow room-temperature
// equalization, not an instant snap, and so it doesn't fight a nearby
// radiator/reaction for control of a cell's temperature within a single
// tick.
const AMBIENT_CONVERGENCE_K_PER_SEC = 1;

/** All display-facing temperature is Celsius (see app.ts); internal storage
 * and every energy/conduction/phase-change calculation stays Kelvin, since
 * they're absolute-temperature physics (and species melting/boiling points
 * are authored in Kelvin) -- these two helpers are the only conversion
 * points, used at the UI boundary. */
export function celsiusToKelvin(celsius: number): number {
  return celsius + 273.15;
}

export function kelvinToCelsius(kelvin: number): number {
  return kelvin - 273.15;
}

const CONDUCTION_RATE = 0.02;
// See stepConduction's final loop -- caps how far a single tick's summed
// conduction flux can move a cell's own temperature, to stay finite even
// when several neighbors push/pull a tiny-heat-capacity cell at once.
const MAX_DELTA_T_PER_TICK = 2000;

// Hard ceiling well above every real transition in the species table (the
// hottest boiling point is carbon's ~5100K) -- a tiny-heat-capacity gas
// cell that keeps getting re-ignited by react.ts on successive ticks (fresh
// reactant drifting back in after each reaction) has no per-tick rate limit
// the way conduction does above, so without an absolute cap its energy can
// still climb into physically absurd territory over many ticks even though
// no single step is individually unbounded.
export const MAX_TEMP_K = 10000;

/** Clamps u so its implied temperature never exceeds MAX_TEMP_K. Shared by
 * stepConduction and react.ts's placeProducts -- the two write paths that
 * can add unbounded-over-time energy to a cell. */
export function clampEnergyToMaxTemp(thermal: ThermalProfile, massG: number, u: number): number {
  if (massG <= 0) return u;
  const maxU = energyForTemperature(thermal, massG, MAX_TEMP_K).u;
  return Math.min(u, maxU);
}

interface EnergyLandmarks {
  uMeltStart: number;
  uMeltEnd: number;
  uBoilStart: number;
  uBoilEnd: number;
}

function landmarks(thermal: ThermalProfile, massG: number): EnergyLandmarks {
  const uMeltStart = massG * thermal.specificHeatSolid * thermal.meltK;
  const uMeltEnd = uMeltStart + massG * thermal.heatOfFusion;
  const uBoilStart = uMeltEnd + massG * thermal.specificHeatLiquid * (thermal.boilK - thermal.meltK);
  const uBoilEnd = uBoilStart + massG * thermal.heatOfVaporization;
  return { uMeltStart, uMeltEnd, uBoilStart, uBoilEnd };
}

export function massOf(species: SpeciesTable, specId: number): number {
  return species.densityOf(specId) * CELL_VOLUME_CM3;
}

/** Derives {temperature, phase} from stored internal energy. */
export function temperatureOf(thermal: ThermalProfile, massG: number, u: number): { tempK: number; phase: PhaseCode } {
  if (massG <= 0) return { tempK: thermal.meltK, phase: PhaseCode.Solid };
  const L = landmarks(thermal, massG);

  if (u < L.uMeltStart) return { tempK: u / (massG * thermal.specificHeatSolid), phase: PhaseCode.Solid };
  if (u < L.uMeltEnd) return { tempK: thermal.meltK, phase: PhaseCode.Liquid };
  if (u < L.uBoilStart) {
    return { tempK: thermal.meltK + (u - L.uMeltEnd) / (massG * thermal.specificHeatLiquid), phase: PhaseCode.Liquid };
  }
  if (u < L.uBoilEnd) return { tempK: thermal.boilK, phase: PhaseCode.Gas };
  return { tempK: thermal.boilK + (u - L.uBoilEnd) / (massG * thermal.specificHeatGas), phase: PhaseCode.Gas };
}

/** Inverse of temperatureOf -- used to seed a freshly painted cell at ambient
 * temperature with the internal energy (and therefore phase) that implies. */
export function energyForTemperature(thermal: ThermalProfile, massG: number, targetK: number): { u: number; phase: PhaseCode } {
  const L = landmarks(thermal, massG);
  if (targetK < thermal.meltK) return { u: massG * thermal.specificHeatSolid * targetK, phase: PhaseCode.Solid };
  if (targetK < thermal.boilK) {
    return { u: L.uMeltEnd + massG * thermal.specificHeatLiquid * (targetK - thermal.meltK), phase: PhaseCode.Liquid };
  }
  return { u: L.uBoilEnd + massG * thermal.specificHeatGas * (targetK - thermal.boilK), phase: PhaseCode.Gas };
}

/** Internal energy a glass wall cell should be stamped with at placement
 * time -- apparatus (funnel/tube) glass used to hardcode u=0, which is
 * literal 0 Kelvin, not "room temperature". A wall ring stamped that way
 * acts as a near-absolute-zero heat sink on whatever it conducts against
 * every tick it's adjacent to (observed freezing 21C water solid while
 * sitting in a conveyor tube's lumen), only slowly warming toward ambient
 * via stepAmbient's capped drift. Walls should start at ambient instead. */
export function glassWallEnergyAtAmbient(species: SpeciesTable): number {
  return energyForTemperature(species.thermalOf(GLASS_WALL_SPEC_ID), massOf(species, GLASS_WALL_SPEC_ID), AMBIENT_TEMPERATURE_K).u;
}

function heatCapacityFor(thermal: ThermalProfile, phase: PhaseCode): number {
  switch (phase) {
    case PhaseCode.Solid:
      return thermal.specificHeatSolid;
    case PhaseCode.Gas:
      return thermal.specificHeatGas;
    default:
      return thermal.specificHeatLiquid;
  }
}

function conductivityFor(thermal: ThermalProfile, phase: PhaseCode): number {
  switch (phase) {
    case PhaseCode.Solid:
      return thermal.thermalConductivitySolid;
    case PhaseCode.Gas:
      return thermal.thermalConductivityGas;
    default:
      return thermal.thermalConductivityLiquid;
  }
}

function exchangeEnergy(grid: SimGrid, species: SpeciesTable, deltaU: Float32Array, i: number, j: number): void {
  if (grid.specId[i] === EMPTY || grid.specId[j] === EMPTY) return;

  const specI = grid.specId[i] as number;
  const specJ = grid.specId[j] as number;
  const massI = massOf(species, specI);
  const massJ = massOf(species, specJ);
  const thermalI = species.thermalOf(specI);
  const thermalJ = species.thermalOf(specJ);
  const { tempK: tempI, phase: phaseI } = temperatureOf(thermalI, massI, grid.u[i] as number);
  const { tempK: tempJ, phase: phaseJ } = temperatureOf(thermalJ, massJ, grid.u[j] as number);

  const diff = tempI - tempJ;
  if (diff === 0) return;

  const kI = conductivityFor(thermalI, phaseI);
  const kJ = conductivityFor(thermalJ, phaseJ);
  const kBlend = (2 * kI * kJ) / (kI + kJ);

  const capacityI = massI * heatCapacityFor(thermalI, phaseI);
  const capacityJ = massJ * heatCapacityFor(thermalJ, phaseJ);
  const maxFlux = Math.abs(diff) * Math.min(capacityI, capacityJ) * 0.5;

  let flux = kBlend * diff * CONDUCTION_RATE;
  flux = Math.max(-maxFlux, Math.min(maxFlux, flux));

  deltaU[i] = (deltaU[i] as number) - flux;
  deltaU[j] = (deltaU[j] as number) + flux;
}

/**
 * Point heat source primitive (M4): a bidirectional thermostat that moves a
 * fixed magnitude of power (`watts`, always >= 0) into or out of every
 * non-empty cell within `radius` of (cx, cy), converted to joules via the
 * tick's real duration -- watts, not a raw temperature snap, so energy
 * accounting stays correct and boiling a painted liquid still takes real
 * simulated time. Direction is decided per cell by comparing its own
 * temperature to `targetK`: a colder cell gets heated, a hotter cell gets
 * cooled, and a cell already at the target is left alone that tick -- so
 * the radiator settles at its setpoint instead of heating/cooling forever,
 * and a single radiator can act as a heater for some neighbors and a
 * cooler for others depending on which side of the target they're on.
 * Shared by stepRadiators below, one call per radiator cell.
 */
export function applyPointHeatSource(
  grid: SimGrid,
  species: SpeciesTable,
  cx: number,
  cy: number,
  radius: number,
  watts: number,
  targetK: number,
  dtSeconds: number,
): void {
  const joulesPerCell = Math.abs(watts) * dtSeconds;
  if (joulesPerCell === 0) return;
  const r2 = radius * radius;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx * dx + dy * dy > r2) continue;
      const x = cx + dx;
      const y = cy + dy;
      if (!grid.inBounds(x, y)) continue;
      const idx = grid.index(x, y);
      const specId = grid.specId[idx];
      if (specId === EMPTY) continue;

      const mass = massOf(species, specId as number);
      const thermal = species.thermalOf(specId as number);
      const currentU = grid.u[idx] as number;
      const { tempK } = temperatureOf(thermal, mass, currentU);
      // A tolerance rather than exact equality: grid.u is Float32Array (see
      // grid.ts), whose ~1.19e-7 relative precision means a cell seeded
      // exactly at targetK can round-trip through energyForTemperature/
      // temperatureOf up to ~1e-3 K off at the sim's largest temperatures
      // (10000K) -- without slack that sliver would get (mis)diagnosed as
      // "needs a full tick of heating/cooling" instead of "already at
      // target". 0.01K is comfortably above that float32 noise floor while
      // staying far below any real target gap the sim cares about.
      if (Math.abs(tempK - targetK) < 0.01) continue;

      // joulesPerCell is a fixed, mass-independent amount, so a
      // small-heat-capacity cell (a gas, especially) can swing past the
      // target in a single tick -- observed in practice as gas painted into
      // a cold radiator overshooting down to (clamped) 0J, then next tick
      // overshooting back up past the target into "hot" territory, forever
      // oscillating instead of settling. Clamping the write to targetU (the
      // energy that implies exactly targetK) makes the radiator a true
      // thermostat: a cell approaches the target and stops there instead of
      // ever crossing it.
      const targetU = energyForTemperature(thermal, mass, targetK).u;
      const newU = tempK < targetK ? Math.min(currentU + joulesPerCell, targetU) : Math.max(currentU - joulesPerCell, targetU);
      grid.u[idx] = Math.max(0, newU);
    }
  }
}

/**
 * Heater/cooler radiator support: every cell with a nonzero
 * grid.radiatorRadius (see radiators.ts and grid.ts -- a background field,
 * not a grid.specId occupant, so it has no collision) radiates
 * RADIATOR_WATTS into cells within its own radiatorRadius, every tick,
 * driving them toward its own radiatorTargetK -- both values are a
 * per-cell snapshot captured at paint time, so a radiator keeps working
 * exactly as configured for as long as it's marked on the grid, regardless
 * of what the side panel's sliders do afterward.
 */
export function stepRadiators(grid: SimGrid, species: SpeciesTable, dtSeconds: number): void {
  for (let idx = 0; idx < grid.radiatorRadius.length; idx++) {
    const radius = grid.radiatorRadius[idx] as number;
    if (radius <= 0) continue;
    const targetK = grid.radiatorTargetK[idx] as number;
    const x = idx % grid.width;
    const y = Math.floor(idx / grid.width);
    applyPointHeatSource(grid, species, x, y, radius, RADIATOR_WATTS, targetK, dtSeconds);
  }
}

/** One conduction + phase-change tick. Mutates grid.u and grid.phase in
 * place. Deltas are accumulated over the whole grid from a single snapshot
 * of temperatures, then applied, so the result doesn't depend on scan
 * order (unlike movement's swap-in-place approach). */
export function stepConduction(grid: SimGrid, species: SpeciesTable): void {
  const { width, height } = grid;
  const deltaU = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid.index(x, y);
      if (grid.specId[idx] === EMPTY) continue;

      if (x + 1 < width) exchangeEnergy(grid, species, deltaU, idx, grid.index(x + 1, y));
      if (y + 1 < height) exchangeEnergy(grid, species, deltaU, idx, grid.index(x, y + 1));
    }
  }

  for (let idx = 0; idx < grid.u.length; idx++) {
    if (grid.specId[idx] === EMPTY) continue;
    const specId = grid.specId[idx] as number;
    const mass = massOf(species, specId);
    const thermal = species.thermalOf(specId);
    const phase = grid.phase[idx] as PhaseCode;
    const capacity = mass * heatCapacityFor(thermal, phase);

    // Each pairwise flux above is clamped to half *that pair's* capacity
    // gap, but a cell touching several neighbors at once (tiny-capacity gas
    // cells sitting between several larger neighbors, especially) can still
    // receive more total flux this tick than its own capacity holds -- left
    // unclamped that overshoot compounds tick over tick into an exponential
    // runaway (temperature spiking to Infinity).
    // Bounding a single tick's own temperature swing to a generous but
    // finite MAX_DELTA_T_PER_TICK breaks that feedback loop without
    // otherwise affecting normal (non-runaway) conduction.
    const maxDelta = capacity * MAX_DELTA_T_PER_TICK;
    const clampedDeltaU = Math.max(-maxDelta, Math.min(maxDelta, deltaU[idx] as number));
    const newU = clampEnergyToMaxTemp(thermal, mass, Math.max(0, (grid.u[idx] as number) + clampedDeltaU));
    grid.u[idx] = newU;

    grid.phase[idx] = temperatureOf(thermal, mass, newU).phase;
  }
}

/**
 * Ambient equalization (M?): every FULLY BURIED occupied cell (see
 * exposedFaceCount below -- one with no empty neighbor, so it has no direct
 * line to vacuum) drifts toward AMBIENT_TEMPERATURE_K at a flat rate capped
 * by AMBIENT_CONVERGENCE_K_PER_SEC, independent of conduction/radiators/
 * reactions -- so a cell that's cooled or heated away from room temperature
 * (painted hot, boiled, product of an exothermic reaction, ...) still
 * settles back to ambient over real simulated time even when it's deep
 * inside a mass with no direct radiative path out, instead of holding
 * whatever energy it last had forever. A cell with at least one empty
 * neighbor is handled by stepRadiativeLoss instead (see below) -- the two
 * are mutually exclusive per cell by construction, so there's no double
 * counting. Runs after stepConduction so it acts on that tick's settled
 * temperature.
 *
 * This moves an energy DELTA derived from the capped temperature step,
 * rather than snapping straight to energyForTemperature(targetK): u -> T is
 * many-to-one on the melt/boil plateaus (every u in [uBoilStart, uBoilEnd]
 * maps to the same boilK), so T -> u is not its inverse there. Snapping u to
 * energyForTemperature(targetK) mid-plateau silently discarded (or, on the
 * melt plateau while heating, silently manufactured) up to a full latent
 * heat's worth of energy in one tick, which meant a boiling cell could
 * never accumulate enough energy to actually finish vaporizing: every tick,
 * stepAmbient reset it back to the bottom of the plateau. Deriving deltaU
 * from the *current phase's own heat capacity* instead correctly drains (or
 * adds) latent heat gradually while the temperature itself stays pinned at
 * the plateau value, matching how every other write path in this file
 * (conduction, radiators, reactions) already moves energy in deltas.
 */
export function stepAmbient(grid: SimGrid, species: SpeciesTable, dtSeconds: number): void {
  const maxDeltaT = AMBIENT_CONVERGENCE_K_PER_SEC * dtSeconds;
  if (maxDeltaT <= 0) return;

  for (let idx = 0; idx < grid.u.length; idx++) {
    if (grid.specId[idx] === EMPTY) continue;
    if (exposedFaceCount(grid, idx) > 0) continue;
    const specId = grid.specId[idx] as number;
    const mass = massOf(species, specId);
    const thermal = species.thermalOf(specId);
    const phase = grid.phase[idx] as PhaseCode;
    const currentU = grid.u[idx] as number;
    const { tempK } = temperatureOf(thermal, mass, currentU);

    if (tempK === AMBIENT_TEMPERATURE_K) continue;

    const targetK =
      tempK > AMBIENT_TEMPERATURE_K
        ? Math.max(AMBIENT_TEMPERATURE_K, tempK - maxDeltaT)
        : Math.min(AMBIENT_TEMPERATURE_K, tempK + maxDeltaT);

    const capacity = mass * heatCapacityFor(thermal, phase);
    const newU = Math.max(0, currentU + capacity * (targetK - tempK));
    grid.u[idx] = newU;
    grid.phase[idx] = temperatureOf(thermal, mass, newU).phase;
  }
}

/** Count of this cell's 4-connected neighbors (including grid edges) that
 * are empty -- its direct "line of sight" to vacuum, in cells. Shared by
 * stepAmbient (skips exposed cells) and stepRadiativeLoss (skips buried
 * ones, and scales its flux by this count). A grid edge counts as exposed
 * the same as an empty neighbor cell -- the sim has no walls at its
 * boundary, so the edge of the play area radiates to vacuum too. */
function exposedFaceCount(grid: SimGrid, idx: number): number {
  const { width, height } = grid;
  const x = idx % width;
  const y = Math.floor(idx / width);
  let count = 0;
  count += x === 0 || grid.isEmptyAt(idx - 1) ? 1 : 0;
  count += x === width - 1 || grid.isEmptyAt(idx + 1) ? 1 : 0;
  count += y === 0 || grid.isEmptyAt(idx - width) ? 1 : 0;
  count += y === height - 1 || grid.isEmptyAt(idx + width) ? 1 : 0;
  return count;
}

// Effective (non-physical) radiative rate constant for stepRadiativeLoss.
// A real Stefan-Boltzmann sigma (5.67e-8 W/(m^2*K^4)) applied to a
// cell-sized "surface" would be imperceptibly slow at this sim's scale (a
// nominal 1cm^3 parcel isn't a real radiating body), so this is picked --
// the same way CONDUCTION_RATE above is a relative rate constant, not a
// literal W/(m*K) transport calculation -- so a cell fully exposed to
// vacuum near its boiling point visibly sheds heat over a few seconds
// rather than instantly or imperceptibly.
const RADIATIVE_RATE = 50;
// Normalizes T^4 into a sane numeric range (T=10000K unnormalized would be
// 1e16) the same way MAX_TEMP_K bounds T itself -- see this file's module
// comment on the two runaway guards.
const RADIATIVE_TEMP_SCALE = 1000;

/**
 * Radiative cooling (M?): every occupied cell with at least one empty
 * neighbor (see exposedFaceCount) loses (or, if colder than ambient, gains)
 * energy toward AMBIENT_TEMPERATURE_K at a rate that scales with both its
 * exposed face count and (T/1000)^4 - (Tambient/1000)^4, i.e. a crude
 * Stefan-Boltzmann law -- so a glowing-hot cell exposed to vacuum cools
 * fast while a near-ambient one barely cools at all, unlike the flat
 * per-cell rate stepAmbient used to apply uniformly to every cell
 * regardless of exposure. A cell fully enclosed by other matter (zero
 * exposed faces) has no direct radiative path to vacuum and is left to
 * stepAmbient's flat convergence instead.
 *
 * The write is clamped so a single tick can never push a cell's energy past
 * what AMBIENT_TEMPERATURE_K implies -- the same overshoot-prevention
 * pattern applyPointHeatSource already uses for a low-heat-capacity cell
 * under a strong radiator (see its comment): without the clamp, a
 * near-MAX_TEMP_K cell's T^4 term is astronomically large and would swing
 * the cell's energy negative or far past ambient in one step instead of
 * settling there.
 */
export function stepRadiativeLoss(grid: SimGrid, species: SpeciesTable, dtSeconds: number): void {
  if (dtSeconds <= 0) return;

  for (let idx = 0; idx < grid.u.length; idx++) {
    if (grid.specId[idx] === EMPTY) continue;
    const faces = exposedFaceCount(grid, idx);
    if (faces === 0) continue;

    const specId = grid.specId[idx] as number;
    const mass = massOf(species, specId);
    const thermal = species.thermalOf(specId);
    const currentU = grid.u[idx] as number;
    const { tempK } = temperatureOf(thermal, mass, currentU);

    if (tempK === AMBIENT_TEMPERATURE_K) continue;

    const tNorm = tempK / RADIATIVE_TEMP_SCALE;
    const aNorm = AMBIENT_TEMPERATURE_K / RADIATIVE_TEMP_SCALE;
    // Positive when hotter than ambient (net radiative loss), negative when
    // colder (net gain from the ambient background).
    const flux = RADIATIVE_RATE * faces * (tNorm ** 4 - aNorm ** 4);
    const joules = flux * dtSeconds;

    const targetU = energyForTemperature(thermal, mass, AMBIENT_TEMPERATURE_K).u;
    let newU = currentU - joules;
    newU = flux > 0 ? Math.max(newU, targetU) : Math.min(newU, targetU);
    newU = clampEnergyToMaxTemp(thermal, mass, Math.max(0, newU));

    grid.u[idx] = newU;
    grid.phase[idx] = temperatureOf(thermal, mass, newU).phase;
  }
}
