// The brush tools, driven by real mouse input on the canvas: picking a
// species out of the Tool Chest, dragging it onto the bench, and taking it
// back off with the eraser. This is the path every other feature is used
// through, and the one where a broken pointer-to-cell mapping shows up first.
import { expect, test } from '@playwright/test';
import { clickCell, countLabel, dragCells, failOnPageErrors, getCell, openSandbox, runTicks, selectSpecies, selectTool, size } from './bench';

test.beforeEach(({ page }) => failOnPageErrors(page));

test('picking a species from the chest arms the brush', async ({ page }) => {
  await openSandbox(page);

  // The Paint slot is the readout of what's on the brush as well as the way
  // to change it, so it renames itself to whichever species is loaded.
  const slot = page.locator('.rail-slot-species .rail-slot-title');
  await expect(slot).toBeVisible();

  await selectSpecies(page, 'H2O');
  await expect(slot).toHaveText('H2O');

  // And changing species again actually changes it, rather than the chest
  // handing back the first pick forever.
  await selectSpecies(page, 'Fe');
  await expect(slot).toHaveText('Fe');
});

test('dragging paints the species under the pointer', async ({ page }) => {
  await openSandbox(page);
  await selectSpecies(page, 'H2O');

  const { width, height } = await size(page);
  const y = Math.floor(height / 3);
  await dragCells(page, { x: Math.floor(width * 0.3), y }, { x: Math.floor(width * 0.6), y });

  // The cells the pointer actually crossed hold water...
  for (const x of [Math.floor(width * 0.3), Math.floor(width * 0.45), Math.floor(width * 0.6)]) {
    const cell = await getCell(page, x, y);
    expect(cell?.label, `cell (${x}, ${y}) should be H2O`).toBe('H2O');
  }
  // ...and one well clear of the stroke stays empty, which is what catches a
  // canvas-to-grid mapping that has drifted or scaled wrong.
  expect((await getCell(page, Math.floor(width * 0.9), y))?.label).toBeNull();
});

test('painted matter lands with a real temperature', async ({ page }) => {
  await openSandbox(page);
  await selectSpecies(page, 'H2O');

  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 3);
  await clickCell(page, x, y);

  const cell = await getCell(page, x, y);
  expect(cell?.label).toBe('H2O');
  // A 0 K or NaN cell here means the paint path lost its energy bookkeeping
  // -- the failure mode heat.ts's guards exist for.
  expect(Number.isFinite(cell?.tempK ?? NaN)).toBe(true);
  expect(cell?.tempK ?? 0).toBeGreaterThan(100);
  expect(cell?.phase).toBe('liquid');
});

test('the eraser takes painted matter back off', async ({ page }) => {
  await openSandbox(page);
  await selectSpecies(page, 'H2O');

  const { width, height } = await size(page);
  const y = Math.floor(height / 3);
  const from = { x: Math.floor(width * 0.3), y };
  const to = { x: Math.floor(width * 0.6), y };
  await dragCells(page, from, to);
  expect(await countLabel(page, 'H2O')).toBeGreaterThan(0);

  await selectTool(page, 'Erase');
  await dragCells(page, from, to);
  expect(await countLabel(page, 'H2O')).toBe(0);
});

test('paint falls once the sim runs, without gaining or losing cells', async ({ page }) => {
  await openSandbox(page);
  await selectSpecies(page, 'Fe');

  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const dropY = Math.floor(height * 0.2);
  await clickCell(page, x, dropY);
  const before = await countLabel(page, 'Fe');
  expect(before).toBeGreaterThan(0);

  await runTicks(page, 150);

  // Gravity is the whole point of a falling-sand sim: the grains must have
  // left where they were painted, without any of them evaporating on the way
  // down.
  expect(await countLabel(page, 'Fe')).toBe(before);
  expect((await getCell(page, x, dropY))?.label).toBeNull();
});
