import { defineConfig, devices } from '@playwright/test';

// End-to-end tests drive the real app in a real browser: menu -> bench, tool
// rail clicks, and actual pointer drags across the sim canvas. They assert on
// *grid state* (via window.__pixistry, see src/ui/debug-hook.ts) rather than
// on pixels -- a falling-sand canvas is far too noisy to screenshot-diff, and
// the regressions worth catching ("the flask no longer places", "undo leaves
// glass behind") are all state, not color.
//
// The debug hook is gated on import.meta.env.DEV, so these run against the
// Vite *dev* server, never a production build.
const PORT = Number(process.env.PORT) || 5173;

export default defineConfig({
  testDir: './e2e',
  // Vitest owns src/**; Playwright owns e2e/** and the two never overlap
  // (vite.config.ts's test.include is scoped to src/sim).
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // The sim is one worker thread plus a WebGL context per page; a couple of
  // browsers at a time is plenty on a laptop and keeps CI honest.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'on-first-retry',
    video: process.env.CI ? 'retain-on-failure' : 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        // The bench sizes itself off the viewport; a fixed one keeps
        // cell-to-pixel math stable across machines.
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          // renderer.ts hard-fails without WebGL2, and headless Chromium only
          // has it via SwiftShader (software rasterization).
          args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
        },
      },
    },
  ],
  webServer: {
    command: 'npm run dev',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
