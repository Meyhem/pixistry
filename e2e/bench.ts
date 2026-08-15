// Shared e2e harness: getting to a bench, converting grid cells to screen
// pixels, driving the canvas with real pointer input, and reading the grid
// back out.
//
// The rule these tests follow: *act* through the real UI (rail clicks, canvas
// drags, keyboard shortcuts) and *assert* through window.__pixistry, the
// dev-only debug hook in src/ui/debug-hook.ts. Setup matter that isn't the
// thing under test may also go through the hook -- painting a puddle by hand
// with the mouse in every test would just be slow and flaky.
import { expect, type Locator, type Page } from '@playwright/test';

/** Mirror of the shape src/ui/debug-hook.ts's getCell returns. */
export interface DebugCell {
  x: number;
  y: number;
  specId: number;
  label: string | null;
  tempK: number;
  tempC: number;
  phase: 'empty' | 'solid' | 'liquid' | 'gas' | 'unknown';
  radiatorRadius: number;
  radiatorTargetK: number;
}

export interface DebugGrid {
  width: number;
  height: number;
  tick: number;
  specId: number[];
  phase: string[];
  tempC: number[];
}

export interface GridSize {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The glass the compositor stamps for every vessel (walls.ts's
 * WALL_SPEC_BASE + 0). Counting these cells is how a test tells "a flask is
 * on the bench" without needing the worker's entity list. Wall spec ids sit
 * above the species table and are deliberately absent from the paint palette,
 * so this is a constant rather than a findSpecId lookup. */
export const GLASS_SPEC_ID = 0xff00;

/** Rail slot labels, as tool-rail.ts writes them into .rail-slot-title. */
export type RailSlot =
  | 'Select'
  | 'Paint'
  | 'Erase'
  | 'Mix'
  | 'Grab'
  | 'Erlenmeyer'
  | 'Beaker'
  | 'Glass (polygon)'
  | 'Radiator'
  | 'Stirrer'
  | 'Addition Funnel'
  | 'Conveyor Tube'
  | 'Filter'
  | 'Sink'
  | 'Vent';

export function canvas(page: Page): Locator {
  return page.locator('canvas.sim-canvas');
}

/** From the title screen to the sandbox bench, paused and ready to assert on.
 * Every test starts here (or at openScenario) rather than at page.goto, since
 * a bench with no frame delivered yet has a null grid. */
export async function openSandbox(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('.menu-card', { hasText: 'Sandbox' }).click();
  await waitForBench(page);
}

/** The campaign equivalent: title screen -> scenario list -> the named
 * scenario's briefing -> its bench. */
export async function openScenario(page: Page, title: string): Promise<void> {
  await page.goto('/');
  await page.locator('.menu-card', { hasText: 'Campaign' }).click();
  await page.locator('.scenario-card', { hasText: title }).click();
  const briefing = page.locator('.briefing-modal');
  await expect(briefing).toBeVisible();
  await briefing.locator('.campaign-primary-btn').click();
  await expect(briefing).toBeHidden();
  await waitForBench(page);
}

/** Waits for the worker's first frame (the debug hook reports a zero-sized
 * grid until then) and pauses the tick loop, so a test that isn't about
 * simulation gets a still bench to work against. Use runTicks/resume when the
 * test does want time to pass. */
export async function waitForBench(page: Page): Promise<void> {
  await expect(canvas(page)).toBeVisible();
  await page.waitForFunction(() => {
    const api = (window as unknown as { __pixistry?: { size(): { width: number }; getCell(x: number, y: number): unknown } }).__pixistry;
    return !!api && api.size().width > 0 && api.getCell(0, 0) !== null;
  });
  await pause(page);
}

export function size(page: Page): Promise<GridSize> {
  return page.evaluate(() => (window as unknown as { __pixistry: { size(): GridSize } }).__pixistry.size());
}

export function getCell(page: Page, x: number, y: number): Promise<DebugCell | null> {
  return page.evaluate(([cx, cy]) => (window as unknown as { __pixistry: { getCell(x: number, y: number): DebugCell | null } }).__pixistry.getCell(cx as number, cy as number), [x, y]);
}

export function dumpGrid(page: Page): Promise<DebugGrid | null> {
  return page.evaluate(() => (window as unknown as { __pixistry: { dumpGrid(): DebugGrid | null } }).__pixistry.dumpGrid());
}

export function pause(page: Page): Promise<void> {
  return page.evaluate(() => (window as unknown as { __pixistry: { pause(): void } }).__pixistry.pause());
}

export function getTick(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __pixistry: { getTick(): number } }).__pixistry.getTick());
}

/** Paints straight at the worker, bypassing the toolbar -- setup only, for
 * matter a test needs to exist but isn't testing the placement of. */
export async function paintDirect(page: Page, x: number, y: number, label: string, opts: { radius?: number; tempC?: number } = {}): Promise<void> {
  const painted = await page.evaluate(
    ([cx, cy, name, radius, tempC]) => {
      const api = (window as unknown as {
        __pixistry: {
          findSpecId(label: string): number | undefined;
          paint(x: number, y: number, specId: number, opts: { radius?: number; tempC?: number }): void;
        };
      }).__pixistry;
      const specId = api.findSpecId(name as string);
      if (specId === undefined) return false;
      api.paint(cx as number, cy as number, specId, { radius: radius as number, tempC: tempC as number });
      return true;
    },
    [x, y, label, opts.radius ?? 0, opts.tempC ?? 20] as const,
  );
  expect(painted, `no species named "${label}" in the palette`).toBe(true);
  await settle(page);
}

/** The palette's id for a paintable species, by label. */
export async function specIdOf(page: Page, label: string): Promise<number> {
  const specId = await page.evaluate((name) => (window as unknown as { __pixistry: { findSpecId(label: string): number | undefined } }).__pixistry.findSpecId(name), label);
  expect(specId, `no species named "${label}" in the palette`).not.toBeUndefined();
  return specId as number;
}

/** Counts cells carrying a species -- the workhorse assertion for "did this
 * place / erase / undo anything". Takes a spec id so it works for the wall
 * materials (glass) as well as palette species. */
export async function countCells(page: Page, specId: number): Promise<number> {
  return page.evaluate((id) => {
    const grid = (window as unknown as { __pixistry: { dumpGrid(): { specId: number[] } | null } }).__pixistry.dumpGrid();
    if (!grid) return 0;
    let n = 0;
    for (const cell of grid.specId) if (cell === id) n += 1;
    return n;
  }, specId);
}

/** countCells for a paintable species, by label. */
export async function countLabel(page: Page, label: string): Promise<number> {
  return countCells(page, await specIdOf(page, label));
}

/** Bounding box of every cell carrying a species, or null if there are none --
 * how a test checks that apparatus *moved* rather than just still existing. */
export async function boundsOf(page: Page, specId: number): Promise<{ minX: number; minY: number; maxX: number; maxY: number } | null> {
  return page.evaluate((id) => {
    const grid = (window as unknown as { __pixistry: { dumpGrid(): { width: number; specId: number[] } | null } }).__pixistry.dumpGrid();
    if (!grid) return null;
    const specId = id;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < grid.specId.length; i += 1) {
      if (grid.specId[i] !== specId) continue;
      const x = i % grid.width;
      const y = Math.floor(i / grid.width);
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    return minX === Infinity ? null : { minX, minY, maxX, maxY };
  }, specId);
}

/** Screen position of the center of grid cell (x, y). Mirrors app.ts's
 * gridCoordsFromEvent, inverted. */
export async function cellPoint(page: Page, x: number, y: number): Promise<Point> {
  const point = await page.evaluate(
    ([cx, cy]) => {
      const el = document.querySelector('canvas.sim-canvas');
      const api = (window as unknown as { __pixistry: { size(): { width: number; height: number } } }).__pixistry;
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const { width, height } = api.size();
      return {
        x: rect.left + ((cx as number) + 0.5) * (rect.width / width),
        y: rect.top + ((cy as number) + 0.5) * (rect.height / height),
      };
    },
    [x, y] as const,
  );
  expect(point, 'sim canvas is not on screen').not.toBeNull();
  return point as Point;
}

/** One click on a grid cell with the active tool. */
export async function clickCell(page: Page, x: number, y: number): Promise<void> {
  const at = await cellPoint(page, x, y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.down();
  await page.mouse.up();
  await settle(page);
}

/** Moves the pointer over a grid cell without pressing -- how a test reads
 * the hover inspector, which is the only view onto grid state the UI itself
 * offers. */
export async function hoverCell(page: Page, x: number, y: number): Promise<void> {
  const at = await cellPoint(page, x, y);
  await page.mouse.move(at.x, at.y);
  await settle(page);
}

/** The hover inspector's readout line. */
export function inspectorText(page: Page): Locator {
  return page.locator('.inspector-text');
}

/** Right-click on a grid cell -- how the polygon tools (Tube, glass polygon)
 * say "finish here". */
export async function rightClickCell(page: Page, x: number, y: number): Promise<void> {
  const at = await cellPoint(page, x, y);
  await page.mouse.move(at.x, at.y);
  await page.mouse.click(at.x, at.y, { button: 'right' });
  await settle(page);
}

/** A held drag from one cell to another. `steps` matters: the brush tools
 * paint per pointermove, and the line tools read the *last* hovered cell on
 * release, so a drag with no intermediate moves is not the same gesture. */
export async function dragCells(page: Page, from: Point, to: Point, steps = 12): Promise<void> {
  const start = await cellPoint(page, from.x, from.y);
  const end = await cellPoint(page, to.x, to.y);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps;
    await page.mouse.move(start.x + (end.x - start.x) * t, start.y + (end.y - start.y) * t);
  }
  await page.mouse.up();
  await settle(page);
}

export function railSlot(page: Page, label: RailSlot): Locator {
  return page.locator(`.rail-slot:has(.rail-slot-title:text-is("${label}"))`);
}

/** Picks a tool from the rail. Not for Paint -- that slot opens the species
 * picker instead of selecting outright, so it has its own helper. */
export async function selectTool(page: Page, label: Exclude<RailSlot, 'Paint'>): Promise<void> {
  await railSlot(page, label).click();
  await expect(railSlot(page, label)).toHaveClass(/\bactive\b/);
}

/** Loads a species onto the brush the way a player does: Paint slot -> Tool
 * Chest -> search -> click the species. */
export async function selectSpecies(page: Page, label: string): Promise<void> {
  await page.locator('.rail-slot-species').click();
  const search = page.locator('.chest-search');
  await expect(search).toBeVisible();
  await search.fill(label);
  // Exact text: searching "H2O" also turns up H2O2, and the first match in
  // DOM order is not necessarily the one asked for.
  await page.locator('.palette-btn').filter({ hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }).first().click();
  await expect(search).toBeHidden();
  await expect(page.locator('.hud-active-label')).toHaveText(label);
}

/** Runs the sim for a number of ticks and waits for them to land, leaving the
 * bench paused again. Deterministic in a way that sleeping isn't. */
export async function runTicks(page: Page, ticks: number): Promise<void> {
  const before = await getTick(page);
  await page.evaluate(() => (window as unknown as { __pixistry: { resume(): void } }).__pixistry.resume());
  await page.waitForFunction(
    (target) => (window as unknown as { __pixistry: { getTick(): number } }).__pixistry.getTick() >= (target as number),
    before + ticks,
    { timeout: 30_000 },
  );
  await pause(page);
  await settle(page);
}

/** Waits for a message sent to the worker to come back as a rendered frame.
 * Everything the UI does is a postMessage, so an assertion made in the same
 * turn as the click would race the worker. Two animation frames is enough for
 * the round trip in practice; the assertions themselves retry anyway. */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 30)));
      }),
  );
}

/** Fails the test on any console error or uncaught page exception. Wired into
 * every spec: a broken worker or a renderer that never got a context tends to
 * show up here long before any assertion notices. */
export function failOnPageErrors(page: Page): void {
  page.on('console', (msg) => {
    if (msg.type() === 'error') throw new Error(`console error: ${msg.text()}`);
  });
  page.on('pageerror', (error) => {
    throw new Error(`uncaught page exception: ${error.message}`);
  });
}
