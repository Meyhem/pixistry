---
name: pixistry-debug
description: Use when debugging or verifying Pixistry sim behavior in the running app — pausing/stepping the tick loop, reading cell state, or painting species programmatically via the window.__pixistry debug API, instead of hovering pixels one at a time in the browser.
---

# Pixistry debug API

The dev build exposes `window.__pixistry` on the main thread (see
[src/ui/app.ts](../../../src/ui/app.ts), gated by `import.meta.env.DEV`). It wraps the
same worker messages the toolbar sends (`setRunning`/`step`/`paint`/`erase`) and reads
the same frame data the hover inspector uses, so the sim can be driven and inspected
from `javascript_tool` instead of clicking/hovering the canvas.

## Setup

1. `mcp__Claude_Browser__preview_start` with `{"name": "pixistry-dev"}` (config lives in
   `.claude/launch.json`, port 5173).
2. Use `mcp__Claude_Browser__javascript_tool` against the returned `tabId` to call the API.
3. `await` doesn't work in a bare expression — wrap calls needing a delay (e.g. waiting
   for a worker round trip after `paint`/`step`) in an IIFE: `(async () => { ... })()`.
4. `preview_stop` when done.

## API

- `pause()` / `resume()` / `step()` — `step()` only advances while paused; it still
  posts `setRunning`/`step` messages to the worker like the toolbar does.
- `setSpeed(n)`, `isRunning()`, `getTick()`
- `size()` → `{ width, height }` (currently 160x100)
- `getCell(x, y)` → `{ x, y, specId, label, tempK, tempC, phase, radiatorRadius, radiatorTargetK }`
  or `null` if out of bounds / no frame received yet
- `dumpGrid()` → `{ width, height, tick, specId: number[], phase: string[], tempC: number[] }`,
  flattened row-major (`idx = y * width + x`) — use for bulk assertions (e.g. "no NaN/no
  cell over MAX_TEMP_K after N ticks") instead of eyeballing the canvas
- `findSpecId(label)` → numeric specId for a species name (e.g. `'H2O'`, `'NaCl'`), or
  `undefined` if not found — species/wall labels come from `species-data.ts` and `walls.ts`
- `paint(x, y, specId, { radius?, tempC? })`, `erase(x, y, radius?)`
- `send(message)` -- raw escape hatch that posts any `MainToWorkerMessage` (see
  `protocol.ts`) straight to the worker, for messages with no dedicated wrapper above
  (`runBurst`/`cancelBurst`, `loadScenario`, `snapshotWorld`/`restoreWorld`, ...), e.g.
  `api.send({ type: 'runBurst', ticks: 1800 })`

## Example: pause, place a reagent, read it back

```js
(async () => {
  const api = window.__pixistry;
  api.pause();
  const specId = api.findSpecId('H2O');
  api.paint(50, 50, specId, { radius: 3, tempC: 25 });
  await new Promise((r) => setTimeout(r, 150)); // worker round trip
  const cell = api.getCell(50, 50);
  api.resume();
  return JSON.stringify(cell);
})();
```

## Notes

- This is a debugging aid only, not part of the app's real API — never import it from
  app code, and it doesn't exist in production builds (`import.meta.env.DEV` guard).
- For the runaway-guard fuzz testing style described in `CLAUDE.md` (`heat.ts`'s
  `MAX_DELTA_T_PER_TICK`/`MAX_TEMP_K`), prefer a real `vitest` test operating on
  `SimGrid` directly — it's faster and more precise than driving the live browser tick
  loop. Use this API when you specifically need to verify behavior in the actual running
  app (UI-observable bugs, render/worker wiring, things a unit test wouldn't catch).
