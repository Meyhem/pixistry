// The numerical guards, exercised through the whole app rather than through
// heat.ts alone: src/sim's fuzz tests drive the grid directly, so nothing else
// checks that a real session -- worker, tick loop, renderer and all -- keeps
// every cell finite and under MAX_TEMP_K.
//
// Both runaways CLAUDE.md documents only showed up over hundreds of ticks of
// continuous reaction, which is exactly what these do.
import { expect, test } from '@playwright/test';
import { dumpGrid, failOnPageErrors, getCell, openSandbox, paintDirect, runTicks, selectTool, size, dragCells } from './bench';

/** heat.ts's MAX_TEMP_K, in Celsius -- the ceiling clampEnergyToMaxTemp
 * enforces. */
const MAX_TEMP_C = 10_000 - 273.15;

/** Asserts the invariant the fuzz suites exist to protect: no cell is NaN,
 * Infinite, or above the ceiling. */
async function expectFiniteAndCapped(page: import('@playwright/test').Page): Promise<void> {
  const grid = await dumpGrid(page);
  expect(grid).not.toBeNull();
  let worst = -Infinity;
  let bad: { index: number; tempC: number } | null = null;
  (grid as NonNullable<typeof grid>).tempC.forEach((tempC, index) => {
    if (tempC > worst) worst = tempC;
    if (bad === null && (!Number.isFinite(tempC) || tempC > MAX_TEMP_C)) bad = { index, tempC };
  });
  expect(bad, `cell temperature escaped: ${JSON.stringify(bad)}`).toBeNull();
  expect(worst).toBeLessThanOrEqual(MAX_TEMP_C);
}

test.beforeEach(({ page }) => failOnPageErrors(page));

test('a reaction that keeps re-igniting stays under the temperature ceiling', async ({ page }) => {
  test.slow();
  await openSandbox(page);
  const { width, height } = await size(page);
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 2);

  // Na and Cl2 react on contact with no ignition threshold, and the products
  // keep falling out of the way so fresh reactant drifts back in -- the exact
  // shape of the runaway MAX_TEMP_K was added for.
  for (let i = 0; i < 6; i += 1) {
    await paintDirect(page, midX - 6, midY - 10 + i * 4, 'Na', { radius: 3 });
    await paintDirect(page, midX + 6, midY - 10 + i * 4, 'Cl2', { radius: 3 });
  }

  await runTicks(page, 400);
  await expectFiniteAndCapped(page);
});

test('a radiator driving a gas cell does not run away', async ({ page }) => {
  test.slow();
  await openSandbox(page);
  const { width, height } = await size(page);
  const y = Math.floor(height / 2);

  // A tiny-heat-capacity gas cell surrounded by neighbours is the case the
  // per-tick MAX_DELTA_T_PER_TICK clamp exists for.
  await paintDirect(page, Math.floor(width / 2), y, 'H2', { radius: 4 });
  await selectTool(page, 'Radiator');
  await dragCells(page, { x: Math.floor(width / 2) - 12, y: y + 6 }, { x: Math.floor(width / 2) + 12, y: y + 6 });

  await runTicks(page, 400);
  await expectFiniteAndCapped(page);
});

test('a long run with mixed matter leaves the app responsive', async ({ page }) => {
  test.slow();
  await openSandbox(page);
  const { width, height } = await size(page);

  for (const [i, label] of ['H2O', 'Fe', 'S', 'Na', 'Cl2', 'H2SO4'].entries()) {
    await paintDirect(page, Math.floor(width * (0.2 + i * 0.1)), Math.floor(height * 0.25), label, { radius: 3 });
  }

  await runTicks(page, 600);
  await expectFiniteAndCapped(page);

  // Still a live UI at the end of it, not a frozen frame: the inspector has
  // to answer, and the tool rail has to still take a click.
  await selectTool(page, 'Erase');
  expect(await getCell(page, 0, 0)).not.toBeNull();
});
