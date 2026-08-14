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
import { forEachCellInRadius } from './geometry';
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
  // energyForTemperature(MAX_TEMP_K) then back through temperatureOf isn't
  // an exact round-trip, and the clamped value still has to survive being
  // stored into grid.u (Float32Array, ~1.19e-7 relative precision -- see
  // stepRadiators' comment) before some later tick reads it back and
  // reconverts it again. Either step alone can land fractionally above
  // MAX_TEMP_K; a margin has to beat both, so it needs to clear float32's
  // relative precision, not just float64's. 1e-6 is ~10x that and still an
  // undetectable 0.01K at this scale.
  const maxU = energyForTemperature(thermal, massG, MAX_TEMP_K).u * (1 - 1e-6);
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

interface PhaseThermal {
  heatCapacity: number;
  conductivity: number;
}

/** The phase-dependent half of a species' ThermalProfile -- heat.ts picks
 * between a species' solid/liquid/gas heat capacity and conductivity based
 * on a cell's current phase everywhere it touches energy, so this is the one
 * place that switch lives. */
function phaseThermal(thermal: ThermalProfile, phase: PhaseCode): PhaseThermal {
  switch (phase) {
    case PhaseCode.Solid:
      return { heatCapacity: thermal.specificHeatSolid, conductivity: thermal.thermalConductivitySolid };
    case PhaseCode.Gas:
      return { heatCapacity: thermal.specificHeatGas, conductivity: thermal.thermalConductivityGas };
    default:
      return { heatCapacity: thermal.specificHeatLiquid, conductivity: thermal.thermalConductivityLiquid };
  }
}

interface CellReading {
  specId: number;
  mass: number;
  thermal: ThermalProfile;
  u: number;
  tempK: number;
  phase: PhaseCode;
}

/** Reads a non-empty cell's full thermal state in one shot -- the
 * specId -> mass -> thermal -> temperatureOf chain repeated at the top of
 * every energy-writing step in this file. Every write path in this file
 * keeps grid.phase in sync with grid.u (see writeEnergy below), so the
 * phase this derives from the cell's current u is always the same value
 * grid.phase[idx] already holds -- deriving it here rather than reading
 * grid.phase directly is what exchangeEnergy already did before this was
 * factored out. Caller must have already checked the cell isn't EMPTY. */
function readCell(grid: SimGrid, species: SpeciesTable, idx: number): CellReading {
  const specId = grid.specId[idx] as number;
  const mass = massOf(species, specId);
  const thermal = species.thermalOf(specId);
  const u = grid.u[idx] as number;
  const { tempK, phase } = temperatureOf(thermal, mass, u);
  return { specId, mass, thermal, u, tempK, phase };
}

/** Writes a cell's energy and keeps grid.phase in sync with it -- the
 * floor-then-recompute-phase tail repeated at the end of stepConduction,
 * stepAmbient, and stepRadiativeLoss below. Floors at 0 (energy can't go
 * negative); the MAX_TEMP_K ceiling is deliberately NOT applied here --
 * stepAmbient's convergence-toward-ambient target can never approach it, so
 * only the two callers that need it (stepConduction, stepRadiativeLoss)
 * clamp with clampEnergyToMaxTemp themselves before calling this. */
function writeEnergy(grid: SimGrid, thermal: ThermalProfile, mass: number, idx: number, newU: number): void {
  const u = Math.max(0, newU);
  grid.u[idx] = u;
  grid.phase[idx] = temperatureOf(thermal, mass, u).phase;
}

/** Raw pairwise conduction flux between i and j (positive = i loses, j
 * gains), capped at that pair's own capacity gap -- but NOT yet checked
 * against either cell's actual currently-stored energy, since a cell can
 * be party to up to 4 of these in one tick and each is computed from an
 * independent snapshot. stepConduction's second pass does that check
 * across all of a cell's exchanges at once (see its comment). */
function computeFlux(grid: SimGrid, species: SpeciesTable, i: number, j: number): number {
  if (grid.specId[i] === EMPTY || grid.specId[j] === EMPTY) return 0;

  const cellI = readCell(grid, species, i);
  const cellJ = readCell(grid, species, j);

  const diff = cellI.tempK - cellJ.tempK;
  if (diff === 0) return 0;

  const { conductivity: kI, heatCapacity: hcI } = phaseThermal(cellI.thermal, cellI.phase);
  const { conductivity: kJ, heatCapacity: hcJ } = phaseThermal(cellJ.thermal, cellJ.phase);
  const kBlend = (2 * kI * kJ) / (kI + kJ);

  const capacityI = cellI.mass * hcI;
  const capacityJ = cellJ.mass * hcJ;
  const maxFlux = Math.abs(diff) * Math.min(capacityI, capacityJ) * 0.5;

  let flux = kBlend * diff * CONDUCTION_RATE;
  return Math.max(-maxFlux, Math.min(maxFlux, flux));
}

interface PendingExchange {
  i: number;
  j: number;
  flux: number;
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
  forEachCellInRadius(grid, cx, cy, radius, (x, y) => {
    const idx = grid.index(x, y);
    if (grid.specId[idx] === EMPTY) return;

    // Deliberately reads mass/thermal/tempK via readCell but writes only
    // grid.u below, never grid.phase -- unlike every other write path in
    // this file (see writeEnergy), a radiator's nudge doesn't immediately
    // flip a cell across a melt/boil boundary; that's left for
    // stepConduction/stepAmbient to reconcile on their own pass this same
    // tick (both run after stepRadiators -- see worker.ts's runOneTick).
    const { mass, thermal, u: currentU, tempK } = readCell(grid, species, idx);
    // A tolerance rather than exact equality: grid.u is Float32Array (see
    // grid.ts), whose ~1.19e-7 relative precision means a cell seeded
    // exactly at targetK can round-trip through energyForTemperature/
    // temperatureOf up to ~1e-3 K off at the sim's largest temperatures
    // (10000K) -- without slack that sliver would get (mis)diagnosed as
    // "needs a full tick of heating/cooling" instead of "already at
    // target". 0.01K is comfortably above that float32 noise floor while
    // staying far below any real target gap the sim cares about.
    if (Math.abs(tempK - targetK) < 0.01) return;

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
  });
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
  const exchanges: PendingExchange[] = [];
  const outgoing = new Float32Array(width * height);
  const degree = new Uint8Array(width * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = grid.index(x, y);
      if (grid.specId[idx] === EMPTY) continue;

      if (x + 1 < width) {
        const j = grid.index(x + 1, y);
        const flux = computeFlux(grid, species, idx, j);
        if (flux !== 0) {
          exchanges.push({ i: idx, j, flux });
          outgoing[flux > 0 ? idx : j] = (outgoing[flux > 0 ? idx : j] as number) + Math.abs(flux);
          degree[idx] = (degree[idx] as number) + 1;
          degree[j] = (degree[j] as number) + 1;
        }
      }
      if (y + 1 < height) {
        const j = grid.index(x, y + 1);
        const flux = computeFlux(grid, species, idx, j);
        if (flux !== 0) {
          exchanges.push({ i: idx, j, flux });
          outgoing[flux > 0 ? idx : j] = (outgoing[flux > 0 ? idx : j] as number) + Math.abs(flux);
          degree[idx] = (degree[idx] as number) + 1;
          degree[j] = (degree[j] as number) + 1;
        }
      }
    }
  }

  // Each pairwise flux above is capped at half *that pair's* own capacity
  // gap -- a bound that's only valid in isolation. A cell touching multiple
  // neighbors at once (up to 4, on this grid) has each of those pairs
  // computed independently from the same starting snapshot, so their sum
  // can ask a cell to trade away several times its own capacity gap's
  // worth of energy in a single tick. That's an unconditionally-unstable
  // explicit-diffusion step: it doesn't just overshoot equilibrium, it
  // *overshoots past the neighbors' own temperatures*, and the next tick's
  // symmetric overshoot in the opposite direction compounds into growing
  // oscillation -- observed as same-material touching cells (a settled
  // solid Cu pile, no reaction or radiator involved) swinging hundreds of
  // degrees apart tick to tick despite starting perfectly uniform. Scaling
  // every exchange a cell is party to by 1/max(degree(i), degree(j)) keeps
  // each cell's total this-tick exchange within the same "at most half its
  // own capacity gap" stability bound the single-pair cap already assumed,
  // now honored in aggregate too.
  const scale = new Float32Array(width * height).fill(1);
  for (let idx = 0; idx < scale.length; idx++) {
    if (grid.specId[idx] === EMPTY) continue;
    const d = degree[idx] as number;
    if (d > 1) scale[idx] = 1 / d;
  }

  // A cell can still be the loser in several of the (now degree-scaled)
  // exchanges above, so their sum can in principle ask a cell to give away
  // more energy than it currently holds even though every individual flux
  // is now bounded. Left unchecked, writeEnergy's floor-at-0 would
  // silently discard the shortfall on the losing side while the
  // neighbor(s) on the other end of those exchanges already banked the
  // un-scaled amount -- manufacturing energy out of nothing. A second
  // scale pass caps each cell's total outgoing flux at what it actually
  // has stored, keeping the whole batch energy-conserving.
  const outgoingScale = new Float32Array(width * height).fill(1);
  for (let idx = 0; idx < outgoingScale.length; idx++) {
    if (grid.specId[idx] === EMPTY) continue;
    const out = (outgoing[idx] as number) * (scale[idx] as number);
    if (out <= 0) continue;
    const currentU = grid.u[idx] as number;
    if (out > currentU) outgoingScale[idx] = currentU / out;
  }

  for (const { i, j, flux } of exchanges) {
    const degreeScale = Math.min(scale[i] as number, scale[j] as number);
    const loser = flux > 0 ? i : j;
    const effectiveFlux = flux * degreeScale * (outgoingScale[loser] as number);
    deltaU[i] = (deltaU[i] as number) - effectiveFlux;
    deltaU[j] = (deltaU[j] as number) + effectiveFlux;
  }

  for (let idx = 0; idx < grid.u.length; idx++) {
    if (grid.specId[idx] === EMPTY) continue;
    const cell = readCell(grid, species, idx);
    const { heatCapacity } = phaseThermal(cell.thermal, cell.phase);
    const capacity = cell.mass * heatCapacity;

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
    const newU = clampEnergyToMaxTemp(cell.thermal, cell.mass, cell.u + clampedDeltaU);
    writeEnergy(grid, cell.thermal, cell.mass, idx, newU);
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
    const cell = readCell(grid, species, idx);

    if (cell.tempK === AMBIENT_TEMPERATURE_K) continue;

    const targetK =
      cell.tempK > AMBIENT_TEMPERATURE_K
        ? Math.max(AMBIENT_TEMPERATURE_K, cell.tempK - maxDeltaT)
        : Math.min(AMBIENT_TEMPERATURE_K, cell.tempK + maxDeltaT);

    const { heatCapacity } = phaseThermal(cell.thermal, cell.phase);
    const capacity = cell.mass * heatCapacity;
    const newU = cell.u + capacity * (targetK - cell.tempK);
    writeEnergy(grid, cell.thermal, cell.mass, idx, newU);
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

    const cell = readCell(grid, species, idx);
    if (cell.tempK === AMBIENT_TEMPERATURE_K) continue;

    const tNorm = cell.tempK / RADIATIVE_TEMP_SCALE;
    const aNorm = AMBIENT_TEMPERATURE_K / RADIATIVE_TEMP_SCALE;
    // Positive when hotter than ambient (net radiative loss), negative when
    // colder (net gain from the ambient background).
    const flux = RADIATIVE_RATE * faces * (tNorm ** 4 - aNorm ** 4);
    const joules = flux * dtSeconds;

    const targetU = energyForTemperature(cell.thermal, cell.mass, AMBIENT_TEMPERATURE_K).u;
    let newU = cell.u - joules;
    newU = flux > 0 ? Math.max(newU, targetU) : Math.min(newU, targetU);
    writeEnergy(grid, cell.thermal, cell.mass, idx, clampEnergyToMaxTemp(cell.thermal, cell.mass, newU));
  }
}
