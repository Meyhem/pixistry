// Apparatus undo/redo (protocol.ts's undoEntities/redoEntities). It rewinds
// the bench without rewinding the chemistry, so these tests check both halves:
// the vessel comes back, and the matter sitting in it is left alone.
import { expect, test } from '@playwright/test';
import { clickCell, countCells, countLabel, failOnPageErrors, GLASS_SPEC_ID, openSandbox, paintDirect, selectTool, size } from './bench';

test.beforeEach(({ page }) => failOnPageErrors(page));

test('Ctrl+Z takes back a placed flask, Ctrl+Y puts it back', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);

  await selectTool(page, 'Erlenmeyer');
  await clickCell(page, x, y);
  const placed = await countCells(page, GLASS_SPEC_ID);
  expect(placed).toBeGreaterThan(10);

  await page.keyboard.press('Control+z');
  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBe(0);

  await page.keyboard.press('Control+y');
  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBe(placed);

  // Ctrl+Shift+Z is the other redo spelling, so undo-then-shift-redo has to
  // land in the same place.
  await page.keyboard.press('Control+z');
  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBe(0);
  await page.keyboard.press('Control+Shift+z');
  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBe(placed);
});

test('undo rewinds the bench without rewinding the chemistry', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);

  // Matter first, apparatus second: undoing the apparatus must not take the
  // matter with it.
  await paintDirect(page, x - 20, y, 'H2O', { radius: 2 });
  const water = await countLabel(page, 'H2O');
  expect(water).toBeGreaterThan(0);

  await selectTool(page, 'Beaker');
  await clickCell(page, x, y);
  expect(await countCells(page, GLASS_SPEC_ID)).toBeGreaterThan(10);

  await page.keyboard.press('Control+z');
  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBe(0);
  expect(await countLabel(page, 'H2O')).toBe(water);
});

test('undo does nothing on an untouched bench', async ({ page }) => {
  await openSandbox(page);
  // An empty history is a no-op, not a crash -- failOnPageErrors is the real
  // assertion here.
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+z');
  await page.keyboard.press('Control+y');
  expect(await countCells(page, GLASS_SPEC_ID)).toBe(0);
});
