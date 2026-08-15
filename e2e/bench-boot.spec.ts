// Boot path: title screen -> a bench with a live worker and a real WebGL
// context. Everything else in this directory assumes this works, so when the
// suite goes red all at once, this is the spec that says why.
import { expect, test } from '@playwright/test';
import { canvas, failOnPageErrors, getTick, openSandbox, pause, runTicks, waitForBench } from './bench';

test.beforeEach(({ page }) => failOnPageErrors(page));

test('the title screen offers every mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.menu-title')).toHaveText('PIXISTRY');
  for (const card of ['Sandbox', 'Campaign', 'Cabinet', 'Recipe Book', 'Comfort settings']) {
    await expect(page.locator('.menu-card', { hasText: card })).toBeVisible();
  }
});

test('sandbox mounts a sized canvas and a running worker', async ({ page }) => {
  await page.goto('/');
  await page.locator('.menu-card', { hasText: 'Sandbox' }).click();
  await waitForBench(page);

  // A canvas that mounted but never got a WebGL context has a zero-size
  // backing store even though its CSS box looks fine.
  const box = await canvas(page).boundingBox();
  expect(box?.width ?? 0).toBeGreaterThan(100);
  expect(box?.height ?? 0).toBeGreaterThan(100);
  const backing = await canvas(page).evaluate((el) => ({ w: (el as HTMLCanvasElement).width, h: (el as HTMLCanvasElement).height }));
  expect(backing.w).toBeGreaterThan(0);
  expect(backing.h).toBeGreaterThan(0);
});

test('the tick loop runs, pauses and steps', async ({ page }) => {
  await openSandbox(page);

  // waitForBench leaves it paused: the tick must not move on its own.
  const paused = await getTick(page);
  await page.waitForTimeout(400);
  expect(await getTick(page)).toBe(paused);

  // The HUD's step button advances exactly the tick loop, not the wall clock.
  await page.locator('.hud-btn[title^="Step"]').click();
  await expect.poll(() => getTick(page)).toBeGreaterThan(paused);

  // And the pause button resumes it.
  const beforeResume = await getTick(page);
  await page.locator('.pause-btn').click();
  await expect.poll(() => getTick(page), { timeout: 5_000 }).toBeGreaterThan(beforeResume + 5);
  await pause(page);
});

test('a hundred ticks on an empty bench raise nothing', async ({ page }) => {
  await openSandbox(page);
  await runTicks(page, 100);
  expect(await getTick(page)).toBeGreaterThanOrEqual(100);
});
