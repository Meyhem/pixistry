// The two runaway guards CLAUDE.md documents (heat.ts's MAX_DELTA_T_PER_TICK
// and MAX_TEMP_K) were both discovered by many-tick play sessions, not by any
// single-tick unit test -- a runaway compounds tick over tick and only shows
// up after hundreds to thousands of ticks of real (or adversarial) activity.
// This is the long random-fuzz run CLAUDE.md asks for before touching
// conduction/reaction energy code: paint random species/walls/radiators at
// random cells for thousands of ticks and assert every occupied cell's
// internal energy stays finite and its implied temperature never exceeds
// MAX_TEMP_K.
//
// worker.ts can't be imported directly here -- it runs a real setInterval
// and installs self.onmessage as a module-level side effect, so this
// replicates its documented tick order (see worker.ts's module comment:
// "movement -> heat -> react") from the individually-exported step
// functions instead. Funnels/tubes/grabber/mixer-drag are deliberately left
// out: they're apparatus-instance state, not part of the energy bookkeeping
// this guards, and worker.ts's own tick order runs them unconditionally
// regardless of whether any instance exists.
import { describe, expect, it } from 'vitest';
import { SimGrid } from './grid';
import {
  celsiusToKelvin,
  energyForTemperature,
  massOf,
  MAX_TEMP_K,
  stepAmbient,
  stepConduction,
  stepRadiativeLoss,
  stepRadiators,
  temperatureOf,
} from './heat';
import { stepMovement } from './movement';
import { stepReactions } from './react';
import { mulberry32 } from './rng';
import { buildPalette, SpeciesTable } from './species';
import { wallList } from './walls';

const WIDTH = 24;
const HEIGHT = 18;
const TICK_DT_SECONDS = 1 / 60;
const TICKS = 3000;
// A runaway compounds monotonically once it starts (u only ever grows once
// clamping fails), so sampling every CHECK_INTERVAL ticks instead of every
// single tick still catches it -- just with a coarser tick number reported --
// while keeping this test's runtime a small fraction of the rest of the
// suite's.
const CHECK_INTERVAL = 10;

describe('fuzz: long random-activity run stays numerically stable', () => {
  it('keeps every cell finite and under MAX_TEMP_K across thousands of ticks of random paint/erase/radiator activity', () => {
    const rng = mulberry32(0xf00d);
    const grid = new SimGrid(WIDTH, HEIGHT);
    const species = new SpeciesTable();
    const palette = buildPalette();
    const walls = wallList();
    // Paintable specIds (palette) plus wall specIds -- both go through the
    // same energyForTemperature/SpeciesTable branching (see species.ts), so
    // one paint helper below covers both.
    const paintableSpecIds = [...palette.map((p) => p.specId), ...walls.map((w) => w.specId)];

    const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rng() * arr.length)] as T;
    const randomCell = (): { x: number; y: number } => ({
      x: Math.floor(rng() * WIDTH),
      y: Math.floor(rng() * HEIGHT),
    });
    // Wide, deliberately extreme range -- well past every species' melt/boil
    // point in both directions, so phase-change and latent-heat code paths
    // get exercised too, not just steady-state ambient cells.
    const randomTempK = (): number => celsiusToKelvin(-200 + rng() * 3200);

    function paintAt(x: number, y: number, specId: number, tempK: number): void {
      const mass = massOf(species, specId);
      const thermal = species.thermalOf(specId);
      const { u, phase } = energyForTemperature(thermal, mass, tempK);
      grid.set(x, y, specId, phase, u);
    }

    function assertGridSane(tick: number): void {
      for (let idx = 0; idx < grid.specId.length; idx++) {
        if (grid.isEmptyAt(idx)) continue;
        const u = grid.u[idx] as number;
        expect(Number.isFinite(u), `tick ${tick} idx ${idx}: u=${u} is not finite`).toBe(true);
        expect(u, `tick ${tick} idx ${idx}: u=${u} went negative`).toBeGreaterThanOrEqual(0);
        const specId = grid.specId[idx] as number;
        const mass = massOf(species, specId);
        const thermal = species.thermalOf(specId);
        const { tempK } = temperatureOf(thermal, mass, u);
        expect(Number.isFinite(tempK), `tick ${tick} idx ${idx}: tempK=${tempK} is not finite`).toBe(true);
        expect(tempK, `tick ${tick} idx ${idx}: tempK=${tempK} exceeded MAX_TEMP_K`).toBeLessThanOrEqual(MAX_TEMP_K);
      }
    }

    for (let tick = 0; tick < TICKS; tick++) {
      // A handful of random paints per tick -- including repeated paints
      // over already-occupied cells, which is what lets a reactive pair
      // (e.g. Na + Cl2) keep getting freshly re-ignited at the same spot
      // tick after tick, the exact scenario MAX_TEMP_K's doc comment calls
      // out as having no per-tick rate limit otherwise.
      for (let i = 0; i < 3; i++) {
        const { x, y } = randomCell();
        paintAt(x, y, pick(paintableSpecIds), randomTempK());
      }
      // Occasional erase, so cells also cycle back to EMPTY and get
      // repainted rather than only ever accumulating.
      if (rng() < 0.3) {
        const { x, y } = randomCell();
        grid.clear(x, y);
      }
      // Occasional radiator placement -- grid.radiatorRadius/radiatorTargetK
      // are a plain overlay (see grid.ts), painted the same way worker.ts's
      // 'paintRadiator' handler does: direct field writes, no dedicated
      // helper exported for it.
      if (rng() < 0.1) {
        const { x, y } = randomCell();
        const idx = grid.index(x, y);
        grid.radiatorRadius[idx] = 1 + Math.floor(rng() * 6);
        grid.radiatorTargetK[idx] = randomTempK();
      }

      stepMovement(grid, species, rng, tick);
      stepRadiators(grid, species, TICK_DT_SECONDS);
      stepConduction(grid, species);
      stepAmbient(grid, species, TICK_DT_SECONDS);
      stepRadiativeLoss(grid, species, TICK_DT_SECONDS);
      stepReactions(grid, species, rng);

      if (tick % CHECK_INTERVAL === 0 || tick === TICKS - 1) assertGridSane(tick);
    }
  });
});
