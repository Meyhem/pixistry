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
  countCells,
  dragCells,
  failOnPageErrors,
  GLASS_SPEC_ID,
  getCell,
  hoverCell,
  inspectorText,
  openSandbox,
  rightClickCell,
  selectTool,
  size,
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
