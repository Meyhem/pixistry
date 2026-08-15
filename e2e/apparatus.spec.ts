// Apparatus placement, selection, moving and deletion -- the area
// CLAUDE.md calls out as the source of essentially every regression this
// project has had, because all of it is derived state recomposited from the
// worker's entity list on every edit.
//
// The assertion throughout is the glass count: the compositor is the only
// thing that stamps glass, so "how many Glass cells exist" answers "is the
// vessel on the bench", and comparing it before/after a move answers "did the
// move leave a ghost behind" -- the classic failure of the incremental
// unstamping this design replaced.
import { expect, test } from '@playwright/test';
import {
  boundsOf,
  clickCell,
  clickPanelButton,
  clickCellShaky,
  countCells,
  countLabel,
  dragCells,
  entities,
  failOnPageErrors,
  GLASS_SPEC_ID,
  getCell,
  hoverCell,
  inspectorText,
  openSandbox,
  paintDirect,
  rightClickCell,
  runTicks,
  selectTool,
  size,
  specIdOf,
} from './bench';

test.beforeEach(({ page }) => failOnPageErrors(page));

test('clicking places an Erlenmeyer, and Delete takes it away', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);

  expect(await countCells(page, GLASS_SPEC_ID)).toBe(0);

  await selectTool(page, 'Erlenmeyer');
  await clickCell(page, x, y);
  const placed = await countCells(page, GLASS_SPEC_ID);
  expect(placed).toBeGreaterThan(10);

  // The eraser must not touch apparatus -- it takes matter and painted
  // terrain only (see CLAUDE.md: apparatus is indestructible).
  await selectTool(page, 'Erase');
  await dragCells(page, { x: x - 10, y }, { x: x + 10, y });
  expect(await countCells(page, GLASS_SPEC_ID)).toBe(placed);

  // deleteApparatus is the sole way something leaves the bench.
  await selectTool(page, 'Select');
  await clickCell(page, x, y);
  await page.keyboard.press('Delete');
  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBe(0);
});

test('a placed flask can be picked up and moved without leaving a ghost', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);

  await selectTool(page, 'Beaker');
  await clickCell(page, x, y);
  const placed = await countCells(page, GLASS_SPEC_ID);
  expect(placed).toBeGreaterThan(10);
  const before = await boundsOf(page, GLASS_SPEC_ID);
  expect(before).not.toBeNull();

  await selectTool(page, 'Select');
  await clickCell(page, x, y);
  await dragCells(page, { x, y }, { x: x - 15, y });

  // Same amount of glass, somewhere else: a ghost left at the old site would
  // raise the count, and a botched recomposite would drop it.
  expect(await countCells(page, GLASS_SPEC_ID)).toBe(placed);
  const after = await boundsOf(page, GLASS_SPEC_ID);
  expect(after?.minX ?? 0).toBeLessThan(before?.minX ?? 0);
});

test('the glass polygon tool draws a vessel corner by corner', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const left = Math.floor(width / 2) - 12;
  const right = Math.floor(width / 2) + 12;
  const top = Math.floor(height / 2) - 12;
  const bottom = Math.floor(height / 2);

  await selectTool(page, 'Glass (polygon)');
  await clickCell(page, left, top);
  await clickCell(page, left, bottom);
  await clickCell(page, right, bottom);
  // Right-click finishes the polyline -- and must not also commit the corner
  // under the cursor a second time.
  await rightClickCell(page, right, top);

  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBeGreaterThan(20);
  const bounds = await boundsOf(page, GLASS_SPEC_ID);
  expect(bounds?.minX).toBe(left);
  expect(bounds?.maxX).toBe(right);
});

test('a Radiator drag places a line that heats what sits in it', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const y = Math.floor(height / 2);
  const x0 = Math.floor(width / 2) - 10;
  const x1 = Math.floor(width / 2) + 10;

  await selectTool(page, 'Radiator');
  await dragCells(page, { x: x0, y }, { x: x1, y });

  // A radiator is grid state, not matter: the cells it covers report a
  // radius and a target, and nothing collides with it.
  await expect.poll(async () => (await getCell(page, Math.floor(width / 2), y))?.radiatorRadius ?? 0).toBeGreaterThan(0);
  const cell = await getCell(page, Math.floor(width / 2), y);
  expect(cell?.radiatorTargetK ?? 0).toBeGreaterThan(0);

  // And Select + Delete removes it, same as any other apparatus.
  await selectTool(page, 'Select');
  await clickCell(page, Math.floor(width / 2), y);
  await page.keyboard.press('Delete');
  await expect.poll(async () => (await getCell(page, Math.floor(width / 2), y))?.radiatorRadius ?? 0).toBe(0);
});

test('a Sink drag places a port, and Select deletes it', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const y = Math.floor(height * 0.75);
  const x0 = Math.floor(width / 2) - 8;
  const x1 = Math.floor(width / 2) + 8;

  await selectTool(page, 'Sink');
  await dragCells(page, { x: x0, y }, { x: x1, y });

  // Sinks and Vents became entities in phase 6e, so sinkMask is
  // compositor-derived now -- the inspector line is what reads it back.
  const mid = Math.floor(width / 2);
  await hoverCell(page, mid, y);
  await expect(inspectorText(page)).toContainText('Sink');

  await selectTool(page, 'Select');
  await clickCell(page, mid, y);
  await page.keyboard.press('Delete');
  await hoverCell(page, mid, y);
  await expect(inspectorText(page)).not.toContainText('Sink');
});

test('a single click places one flask, however much the hand wobbles', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);

  await selectTool(page, 'Beaker');
  await clickCellShaky(page, x, y);

  // Every pointermove used to re-run the placement, stacking identical
  // flasks on the same spot -- invisible in the glass count (same footprint),
  // so the pile only showed up when Delete took one off and another was
  // still there.
  expect(await entities(page)).toHaveLength(1);

  await selectTool(page, 'Select');
  await clickCell(page, x, y);
  await page.keyboard.press('Delete');
  await expect.poll(() => countCells(page, GLASS_SPEC_ID)).toBe(0);
});

test('a moved vessel takes its contents with it', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);

  await selectTool(page, 'Beaker');
  await clickCell(page, x, y);
  // Straight into the vessel's interior: the anchor cell is inside the bowl.
  await paintDirect(page, x, y - 1, 'H2O', { radius: 1 });
  const poured = await countLabel(page, 'H2O');
  expect(poured).toBeGreaterThan(0);

  await selectTool(page, 'Select');
  await clickCell(page, x, y);
  await dragCells(page, { x, y }, { x, y: y - 8 });

  // Dragging upward used to leave the water behind and then composite the
  // glass on top of it, deleting it a row at a time.
  expect(await countLabel(page, 'H2O')).toBe(poured);
  const water = await boundsOf(page, await specIdOf(page, 'H2O'));
  expect(water?.maxY ?? 0).toBeLessThan(y - 1);
});

test('a stirred flask shows its stirrer overlay', async ({ page }) => {
  await openSandbox(page);
  const { width, height } = await size(page);
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);

  await selectTool(page, 'Beaker');
  await page.locator('.funnel-toggle-btn', { hasText: 'Stirred' }).click();
  await clickCell(page, x, y);

  // A stirred flask never paints grid.stirrerMask (the compositor must not
  // touch painted terrain), so the frame has to union its interior in -- or
  // the vessel stirs away with nothing on screen to say so.
  expect((await getCell(page, x, y - 1))?.stirred).toBe(true);
  // Outside the vessel is not stirred.
  expect((await getCell(page, 2, 2))?.stirred).toBe(false);
});

test('the sep funnel holds water while closed and drains it once the stopcock opens', async ({ page }) => {
  await openSandbox(page);
  const { width } = await size(page);
  const x = Math.floor(width / 2);
  // High enough that drained water visibly falls clear of the stem.
  const y = 60;

  await selectTool(page, 'Sep. funnel');
  await clickCell(page, x, y);
  expect(await countCells(page, GLASS_SPEC_ID)).toBeGreaterThan(10);

  // Charge the cone with water (inside the interior, clear of the glass).
  await paintDirect(page, x, 49, 'H2O', { radius: 2 });
  const water = await specIdOf(page, 'H2O');
  const charge = await countCells(page, water);
  expect(charge).toBeGreaterThan(5);

  // Closed: the stem's aperture is stamped glass, so nothing escapes.
  await runTicks(page, 180);
  expect(await countCells(page, water)).toBe(charge);
  const held = await boundsOf(page, water);
  expect(held?.maxY ?? 99).toBeLessThan(y);

  // Open the stopcock from the vessel's own panel.
  await selectTool(page, 'Select');
  await clickCell(page, x, y - 5);
  await clickPanelButton(page, 'Open');
  await runTicks(page, 300);

  // The water passed through the 3px stem and fell below the funnel -- and
  // none of it was destroyed on the way.
  expect(await countCells(page, water)).toBe(charge);
  const drained = await boundsOf(page, water);
  expect(drained?.maxY ?? 0).toBeGreaterThan(y + 5);
});
