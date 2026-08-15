// Campaign mode: the briefing, the objective HUD, and the per-scenario tool
// restrictions. A scenario's own apparatus and its locked rail slots are both
// things sandbox testing can't reach.
import { expect, test } from '@playwright/test';
import { dragCells, failOnPageErrors, openScenario, paintDirect, railSlot, runTicks, selectSpecies, selectTool, size } from './bench';

test.beforeEach(({ page }) => failOnPageErrors(page));

test('a scenario opens with a briefing and an objective HUD', async ({ page }) => {
  await openScenario(page, 'Table Salt');

  await expect(page.locator('.campaign-hud')).toBeVisible();
  await expect(page.locator('.campaign-hud-title')).toContainText('Table Salt');
  // One goal, shown as a bar with a readout -- not an empty HUD shell.
  await expect(page.locator('.hud-objective')).toHaveCount(1);
  await expect(page.locator('.hud-objective-readout').first()).not.toBeEmpty();
});

test('a scenario locks the tools it did not hand out', async ({ page }) => {
  await openScenario(page, 'Table Salt');

  // Table Salt's rules allow erase and sink only.
  await expect(railSlot(page, 'Sink')).toBeEnabled();
  await expect(railSlot(page, 'Erase')).toBeEnabled();

  const locked = railSlot(page, 'Addition Funnel');
  await expect(locked).toBeDisabled();
  await expect(locked).toHaveClass(/\blocked\b/);
  await locked.hover();
  await expect(locked.locator('.rail-slot-desc')).toContainText('Not available');
});

test('the species picker only offers the scenario reagents', async ({ page }) => {
  await openScenario(page, 'Table Salt');

  // Na and Cl2 are the scenario's paintSpecies; anything else is locked out
  // rather than silently no-op'ing at the worker.
  await selectSpecies(page, 'Na');
  await expect(page.locator('.rail-slot-species .rail-slot-title')).toHaveText('Na');

  await page.locator('.rail-slot-species').click();
  await page.locator('.chest-search').fill('H2SO4');
  await expect(page.locator('.palette-btn').filter({ hasText: /^🔒 H2SO4$/ })).toBeDisabled();
});

test('reacting the reagents into a Sink moves the objective bar', async ({ page }) => {
  test.slow();
  await openScenario(page, 'Table Salt');
  const { width, height } = await size(page);
  const midX = Math.floor(width / 2);
  const midY = Math.floor(height / 3);

  // The whole scenario loop in one test: draw the Sink the briefing asks for,
  // react Na with Cl2 above it, and let the falling NaCl be counted.
  await selectTool(page, 'Sink');
  await dragCells(page, { x: midX - 20, y: height - 6 }, { x: midX + 20, y: height - 6 });

  const readout = page.locator('.hud-objective-readout').first();
  const before = await readout.innerText();

  // Chlorine below the sodium, not beside it: the gas rises through the
  // falling metal, so they stay in contact long enough to react. Painted
  // side by side they just separate -- solid down, gas up -- and nothing
  // happens.
  for (let i = 0; i < 3; i += 1) {
    await paintDirect(page, midX - 10 + i * 10, midY + 6, 'Cl2', { radius: 4 });
    await paintDirect(page, midX - 10 + i * 10, midY, 'Na', { radius: 4 });
  }
  await runTicks(page, 600);

  await expect.poll(async () => (await readout.innerText()) !== before, { timeout: 15_000 }).toBe(true);
});
