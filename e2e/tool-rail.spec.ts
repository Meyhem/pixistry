// The tool rail and its readouts. Cheap tests, but they cover the thing that
// silently breaks a whole session: a slot that no longer selects, or an active
// highlight that lies about what the next click will do.
import { expect, test } from '@playwright/test';
import { failOnPageErrors, openSandbox, railSlot, selectSpecies, selectTool, type RailSlot } from './bench';

test.beforeEach(({ page }) => failOnPageErrors(page));

const SLOTS: Exclude<RailSlot, 'Paint'>[] = ['Select', 'Erase', 'Mix', 'Grab', 'Erlenmeyer', 'Beaker', 'Glass (polygon)', 'Radiator', 'Stirrer', 'Addition Funnel', 'Conveyor Tube', 'Filter', 'Sink', 'Vent'];

test('every slot is on the rail and selectable', async ({ page }) => {
  await openSandbox(page);
  for (const slot of SLOTS) {
    await expect(railSlot(page, slot), `rail slot "${slot}"`).toBeVisible();
  }
  for (const slot of SLOTS) {
    await selectTool(page, slot);
    // Exactly one slot is active at a time -- two highlighted slots means the
    // rail and the tool state have drifted apart.
    await expect(page.locator('.rail-slot.active')).toHaveCount(1);
  }
});

test('the HUD chip names the active tool', async ({ page }) => {
  await openSandbox(page);

  await selectTool(page, 'Erase');
  await expect(page.locator('.hud-active-label')).toHaveText('Erase');

  await selectTool(page, 'Conveyor Tube');
  await expect(page.locator('.hud-active-label')).toHaveText(/Tube/i);

  await selectSpecies(page, 'H2O');
  await expect(page.locator('.hud-active-label')).toHaveText('H2O');
});

test('hovering a slot explains what it does', async ({ page }) => {
  await openSandbox(page);
  const slot = railSlot(page, 'Filter');
  await slot.hover();
  await expect(slot.locator('.rail-slot-desc')).not.toBeEmpty();
});

test('the settings dock follows the selected tool', async ({ page }) => {
  await openSandbox(page);

  await selectTool(page, 'Addition Funnel');
  await expect(page.locator('.side-panel')).toBeVisible();
  const funnelSettings = await page.locator('.side-panel').innerText();

  await selectTool(page, 'Radiator');
  await expect
    .poll(async () => (await page.locator('.side-panel').innerText()) !== funnelSettings)
    .toBe(true);
});
