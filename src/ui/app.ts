// M4+ UI: the full v1 tool set (paint, erase, wall materials, heater/cooler
// radiators, probe, mixer, grabber) plus time controls (pause, single-step,
// speed multiplier) and a hover inspector -- all plain DOM per the design
// doc's "src/ui plain DOM/React panels", no framework.
//
// Layout is "full-bleed canvas + floating HUD + modals": the sim canvas fills
// the entire mount, and the only permanent chrome is two translucent HUD
// strips hovering over its top and bottom edges (hud.ts). Everything else is
// a modal over that canvas -- the Tool Chest (tool-chest.ts) for picking a
// tool, the tool-settings modal (side-panel.ts's builder, rendered into an
// overlay) for configuring it, plus the periodic table, the bench menu, and
// comfort settings. This replaced a docked 4-row toolbar card and a permanent
// 260px side-panel column, which between them left the canvas about a sixth
// of the window.
import { createRenderer, type Renderer } from '../render/renderer';
import { AMBIENT_TEMPERATURE_K, kelvinToCelsius } from '../sim/heat';
import type { GoalProgress } from '../sim/objectives';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../sim/protocol';
import { isPaintAllowed, isToolAllowed } from '../sim/scenario';
import { SCENARIOS, type Restrictions, type Scenario, type ToolKind as SimToolKind } from '../sim/scenario-data';
import type { PaletteEntry } from '../sim/species';
import { EMPTY, PhaseCode, SinkMaskValue } from '../sim/grid';
import { BORDER_RANGE_K } from '../render/renderer';
import { getWall, GLASS_WALL_SPEC_ID, isWallSpecId, wallList } from '../sim/walls';
import { RADIATOR_COLOR, RADIATOR_LABEL } from '../sim/radiators';
import { FUNNEL_COLOR, FUNNEL_LABEL } from '../sim/funnel';
import { STIRRER_COLOR, STIRRER_LABEL } from '../sim/stirrer';
import { DEFAULT_TUBE_CONE_SIZE, TUBE_COLOR, TUBE_LABEL } from '../sim/tube';
import { FLASK_COLOR } from '../sim/flask';
import { FILTER_COLOR, FILTER_LABEL } from '../sim/filter-apparatus';
import { SINK_COLOR, SINK_LABEL, sinkLineCells, VENT_COLOR, VENT_LABEL } from '../sim/sink';
import { funnelBounds, funnelShapeFor, nextFunnelFacing, type FunnelFacing } from '../sim/apparatus-shapes';
import { DEFAULT_FLASK_KIND, DEFAULT_FLASK_SIZE_SCALE, flaskBounds, flaskShapeFor, nextFlaskFacing, type FlaskFacing, type FlaskKind } from '../sim/flask-shapes';
import { lumenWallCells, polylineToLumenPath, snapOctant, type Point } from '../sim/tube-shapes';
import { buildToolChest, type ToolChestCallbacks } from './tool-chest';
import {
  buildToolRail,
  ERASE_COLOR,
  GRABBER_COLOR,
  MIXER_COLOR,
  SELECT_APPARATUS_COLOR,
  SELECT_APPARATUS_LABEL,
  type ToolKind as UiToolKind,
  type ToolRailCallbacks,
} from './tool-rail';
import { buildBenchMenu, buildHud, type BenchMenuCallbacks, type HudCallbacks } from './hud';
import { buildSidePanel, type FunnelFieldValues, type SidePanelCallbacks, type SinkTallyEntry, type ToolMeta, type TubeFieldValues } from './side-panel';
import { buildPeriodicTable, type PeriodicTableCallbacks } from './periodic-table';
import { ApparatusSelection, type FlaskEditDraft, type FunnelEditDraft, type TubeEditDraft } from './apparatus-selection';
import { buildBriefing, buildObjectiveHud, buildWinOverlay, type BurstStatus } from './campaign-hud';
import { loadProgress, recordCompletion, recordDiscovery, saveProgress, starsForCompletion, unlockAchievement } from './campaign-progress';
import { installDebugHook } from './debug-hook';
import { isElementLabel } from './species-classify';
import { buildSpeciesLookup } from './species-lookup';
import { describeObjectives, isScenarioWon } from './objective-display';
import { formatCelsius } from './format';
import { applyComfortSettings, loadComfortSettings, saveComfortSettings } from './comfort-settings';
import { buildComfortScreen } from './comfort-screen';
import { playChime, type ChimePitch } from './sound';
import { MADE_IT_RAIN_LIQUID_H2O_COUNT, PRECIPITATE_LABELS, THERMAL_RUNAWAY_THRESHOLD_K } from './achievements';
import { scanFrameMeta } from './frame-meta';

/** Matches worker.ts's TICK_MS (1000/60) -- used to turn a frame's raw tick
 * count into an elapsed-seconds readout for the win overlay/star rating. */
const TICKS_PER_SECOND = 60;
/** Run Test's fast-forward length (see .grill/campaign-mode.md's Phase 5) --
 * 30 sim-seconds, the exact figure the design doc measures against. Fixed
 * for now since no shipped scenario needs a different duration yet; would
 * become scenario-configurable if a future Tier 3 level's sustain window
 * needs more runway than this. */
const RUN_TEST_TICKS = 30 * TICKS_PER_SECOND;
const DEFAULT_RADIUS = 2;
const DEFAULT_RADIATION_RADIUS = 3;
const DEFAULT_RADIATOR_TARGET_C = 100;
const DEFAULT_BRUSH_TEMP_C = 21;
const DEFAULT_FUNNEL_RATE_PER_MINUTE = 60;
const DEFAULT_FUNNEL_TOTAL_AMOUNT = 100;
const DEFAULT_PINNED_LABELS = ['H2O', 'NaCl', 'Fe', 'Cu', 'Na', 'Cl2', 'O2', 'C', 'Ag'];
const PINNED_STORAGE_KEY = 'pixistry.pinnedSpecies';

type Tool =
  | { kind: 'paint'; specId: number }
  | { kind: 'erase' }
  | { kind: 'wall'; specId: number }
  | { kind: 'radiator' }
  | { kind: 'mixer' }
  | { kind: 'grabber' }
  | { kind: 'funnel' }
  | { kind: 'stirrer' }
  | { kind: 'tube' }
  | { kind: 'filter' }
  // Sink and Vent are one tool variant carrying which port it draws (see
  // grid.ts's SinkMaskValue) rather than two: everything about the
  // interaction -- the free-form drag, the ghost preview, the commit on
  // pointerup -- is identical, and only the committed mask value, the
  // swatch, and the tally panel's heading differ.
  | { kind: 'sink'; port: SinkMaskValue.Sink | SinkMaskValue.Vent }
  | { kind: 'flask'; flask: FlaskKind }
  | { kind: 'select-apparatus' };

/** Wall-drawing tools (Insulator, and the Sink/Vent line) want the brush-
 * width slider's minimum (1) to paint exactly one pixel, for drawing precise
 * vessel walls -- forEachCellInRadius's radius is one less than the displayed
 * width for these tools only. Species/erase/radiator/stirrer keep
 * radius === width unchanged, since a wider default splash is what those
 * actually want. (Glass and Filter no longer appear here at all: both are
 * drawn as fixed one-cell-wide lines now, with no width to scale.) */
function wallBrushRadius(tool: Tool | null, width: number): number {
  return tool?.kind === 'wall' || tool?.kind === 'sink' ? Math.max(0, width - 1) : width;
}

/** Glass is the one wall material drawn as a clicked polygon chain rather
 * than a free-draw brush (the same interaction as the conveyor tube), since
 * what players actually want from it is precise, cleanly joined vessel
 * walls. Insulator keeps the brush. */
function isGlassPolygonTool(t: Tool | null): boolean {
  return t?.kind === 'wall' && t.specId === GLASS_WALL_SPEC_ID;
}

/** Dismiss a modal by clicking its backdrop -- the same gesture Esc does,
 * for the half of players who reach for the mouse instead.
 *
 * Both the pointerdown *and* the click have to land on the backdrop itself.
 * A click event fires on the nearest common ancestor of its down and up
 * targets, so a drag that starts on a slider inside the modal and releases
 * out over the backdrop (easy to do with the brush-width slider) would
 * otherwise read as a backdrop click and close the modal mid-adjustment. */
function closeOnBackdropClick(overlay: HTMLElement, close: () => void): void {
  let downOnBackdrop = false;
  overlay.addEventListener('pointerdown', (event) => {
    downOnBackdrop = event.target === overlay;
  });
  overlay.addEventListener('click', (event) => {
    const wasBackdrop = downOnBackdrop;
    downOnBackdrop = false;
    if (wasBackdrop && event.target === overlay) close();
  });
}

/** Tools drawn as a single straight drag from anchor to release point (see
 * lineDrawStart), rather than a repeated per-move brush paint. */
function isLineDragTool(t: Tool | null): boolean {
  return t?.kind === 'sink' || t?.kind === 'filter';
}

/** Tools drawn as a clicked point chain, committed on right-click and
 * discarded on Escape (see polyDrawPoints). */
function isPolygonTool(t: Tool | null): boolean {
  return t?.kind === 'tube' || isGlassPolygonTool(t);
}

/** Maps the toolbar's own ToolKind (kept separate from scenario-data.ts's --
 * see that file's doc comment on why sim can't import ui's) onto the
 * sim-scoped one Restrictions.tools and isToolAllowed actually check
 * against, so the toolbar can grey out what a campaign scenario forbids.
 * null for 'select-apparatus', which only edits already-placed apparatus and
 * has no restriction of its own to check. */
function toSimToolKind(kind: UiToolKind): SimToolKind | null {
  switch (kind) {
    case 'flask-erlenmeyer':
    case 'flask-beaker':
      return 'flask';
    case 'select-apparatus':
      return null;
    default:
      return kind;
  }
}

const PHASE_LABEL: Record<number, string> = {
  [PhaseCode.Empty]: 'empty',
  [PhaseCode.Solid]: 'solid',
  [PhaseCode.Liquid]: 'liquid',
  [PhaseCode.Gas]: 'gas',
};

/** Baseline every describeToolMeta branch starts from -- most fields are
 * "off"/empty for most tools, so each branch below only lists what it
 * overrides instead of spelling out all twelve fields every time. */
const TOOL_META_DEFAULTS: ToolMeta = {
  label: '',
  color: '',
  category: '',
  isSpecies: false,
  meltLabel: '',
  boilLabel: '',
  phaseLabel: '',
  isThermal: false,
  showBrushTemp: false,
  showBrushWidth: true,
  funnelPanel: 'none',
  tubePanel: 'none',
  filterPanel: 'none',
  flaskPanel: 'none',
  glassPanel: 'none',
  sinkPanel: 'none',
};

/** The three tools with no per-instance config of their own -- just a
 * label/swatch, everything else the same as TOOL_META_DEFAULTS. */
const SIMPLE_TOOL_META: Record<'erase' | 'mixer' | 'grabber', { label: string; color: string }> = {
  erase: { label: 'Erase', color: ERASE_COLOR },
  mixer: { label: 'Mix', color: MIXER_COLOR },
  grabber: { label: 'Grab', color: GRABBER_COLOR },
};

/** The flask tool's display name -- the vessel shape plus, when it's on,
 * the stirred setting (one tool with a toggle, rather than the two separate
 * "Erlenmeyer"/"Erlenmeyer (stirred)" tools this replaced). */
function flaskLabel(kind: FlaskKind, stirred: boolean): string {
  const base = kind === 'beaker' ? 'Beaker' : 'Erlenmeyer';
  return stirred ? `${base} (stirred)` : base;
}

function loadPinnedLabels(): string[] {
  try {
    const raw = localStorage.getItem(PINNED_STORAGE_KEY);
    if (!raw) return [...DEFAULT_PINNED_LABELS];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every((x) => typeof x === 'string')) return [...DEFAULT_PINNED_LABELS];
    return parsed;
  } catch {
    return [...DEFAULT_PINNED_LABELS];
  }
}

function savePinnedLabels(labels: readonly string[]): void {
  try {
    localStorage.setItem(PINNED_STORAGE_KEY, JSON.stringify(labels));
  } catch {
    // Storage unavailable (private browsing, quota) -- pins just won't
    // survive a reload, which is a fine degradation.
  }
}

export interface MountAppOptions {
  /** Which shell launched this mount -- shows a CAMPAIGN badge in the
   * header, and in campaign mode gates loadScenarioInto's lookup below. */
  mode?: 'sandbox' | 'campaign';
  /** Which scenario to load in campaign mode -- looked up in
   * scenario-data.ts's SCENARIOS by id. A campaign mount with no matching
   * id (or mode !== 'campaign') just runs as an unrestricted bench, same as
   * sandbox. */
  scenarioId?: string;
  /** Present when a menu shell mounted this app and can take it down again
   * -- shows a "Menu" button in the header that calls back rather than
   * leaving the player stuck in Sandbox/Campaign with no way out. */
  onExitToMenu?: () => void;
  /** Campaign mode only: the win overlay's "Campaign menu" button uses this
   * to go back to the scenario picker rather than all the way out to the
   * title screen (onExitToMenu) -- falls back to onExitToMenu if unset. */
  onExitToScenarioSelect?: () => void;
}

/** Mounts the whole app into `root` and returns an `unmount` teardown --
 * terminates the worker (stops its tick-loop `setInterval` immediately
 * rather than waiting on GC) and removes every listener/observer that
 * outlives the DOM subtree (window/ResizeObserver; the canvas's own
 * listeners die with the canvas element itself once it's detached). Called
 * by main.ts's menu shell (.grill/campaign-mode.md's Phase 2) to mount/
 * unmount Sandbox and Campaign in turn without leaking a worker or a stale
 * window listener each time. */
export function mountApp(root: HTMLElement, options: MountAppOptions = {}): () => void {
  root.innerHTML = '';
  // `root` is the one element every screen shares (main.ts hands the same
  // #app to buildMenu, buildCabinet, mountApp, ...), and each of those sets
  // its own class on it. Resetting it here matters: the title screen leaves
  // behind `menu-screen`, whose `align-items: center` used to shrink-wrap
  // this whole bench to its content width -- on a 1265px-wide window the
  // bench rendered at 762px and simply threw the other 40% away.
  root.className = 'bench-root';

  const settingsOverlay = document.createElement('div');
  settingsOverlay.className = 'pt-overlay';
  settingsOverlay.style.display = 'none';
  root.appendChild(settingsOverlay);
  // No closeOnBackdropClick here, unlike every other overlay below: comfort
  // settings isn't a card on a backdrop but a full-screen panel (see
  // comfort-screen.ts, which overwrites this element's own class and is
  // shared with the title menu), so "outside the modal" would mean the
  // panel's own empty space. Esc and its ← button close it.

  function renderSettingsOverlay(): void {
    buildComfortScreen(settingsOverlay, comfortSettings, {
      onChange: (next) => {
        comfortSettings = next;
        saveComfortSettings(next);
        applyComfortSettings(next);
        renderSettingsOverlay();
      },
      onBack: () => toggleSettingsOverlay(false),
    });
  }

  function toggleSettingsOverlay(show: boolean): void {
    if (!show) {
      settingsOverlay.style.display = 'none';
      settingsOverlay.innerHTML = '';
      return;
    }
    settingsOverlay.style.display = 'flex';
    renderSettingsOverlay();
  }

  // The bench: one positioned box filling the whole mount, with the canvas
  // and every canvas-anchored overlay inside it. The HUD strips (below) are
  // siblings that float *over* this, so nothing here is ever squeezed by
  // chrome taking a layout share.
  const bench = document.createElement('div');
  bench.className = 'bench';
  root.appendChild(bench);

  // Campaign objective HUD -- floats over the top of the canvas, just under
  // the top HUD strip (see design doc's "progress bar filled with the
  // product's own color... this is the game"), empty and hidden in sandbox
  // mode and before the briefing's Start is clicked.
  const campaignHud = document.createElement('div');
  campaignHud.className = 'campaign-hud';
  campaignHud.style.display = 'none';
  bench.appendChild(campaignHud);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  bench.appendChild(canvasWrap);

  const canvas = document.createElement('canvas');
  canvas.className = 'sim-canvas';
  canvasWrap.appendChild(canvas);

  const inspector = document.createElement('div');
  inspector.className = 'inspector';
  const inspectorSwatch = document.createElement('span');
  inspectorSwatch.className = 'inspector-swatch';
  const inspectorText = document.createElement('span');
  inspectorText.className = 'inspector-text';
  inspectorText.textContent = 'Hover the canvas to inspect a cell';
  inspector.appendChild(inspectorSwatch);
  inspector.appendChild(inspectorText);
  inspector.classList.add('empty');
  canvasWrap.appendChild(inspector);

  const brushOutline = document.createElement('div');
  brushOutline.className = 'brush-outline';
  brushOutline.style.display = 'none';
  canvasWrap.appendChild(brushOutline);

  // Ghost preview for the funnel tool (see updateApparatusOverlay): a 2D
  // overlay canvas rather than the WebGL sim canvas, since it needs to draw
  // an unrotated-in-the-grid-sense but freely positioned pixel shape purely
  // client-side, redrawn on every mousemove/wheel without round-tripping
  // through the worker.
  const apparatusPreview = document.createElement('canvas');
  apparatusPreview.className = 'apparatus-preview';
  apparatusPreview.style.display = 'none';
  canvasWrap.appendChild(apparatusPreview);
  let previewCtx: CanvasRenderingContext2D | null = null;

  // Sink sparkle overlay (see .grill/campaign-mode.md's §6 point 2) -- a
  // second 2D canvas, same sizing/positioning convention as apparatusPreview
  // above, but always present rather than tool-gated: it's redrawn (and its
  // CSS fade re-triggered) from the 'frame' handler whenever a sink's
  // sinkTotals grew since the last frame, regardless of which tool is
  // currently selected.
  const sinkSparkle = document.createElement('canvas');
  sinkSparkle.className = 'sink-sparkle';
  canvasWrap.appendChild(sinkSparkle);
  let sparkleCtx: CanvasRenderingContext2D | null = null;

  // Selection box for the select-apparatus tool: 4 corner brackets
  // positioned over the selected funnel's bounding box (see
  // updateSelectionBox).
  const selectBox = document.createElement('div');
  selectBox.className = 'apparatus-select-box';
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    const cornerEl = document.createElement('div');
    cornerEl.className = `corner ${corner}`;
    selectBox.appendChild(cornerEl);
  }
  canvasWrap.appendChild(selectBox);

  const hotK = AMBIENT_TEMPERATURE_K + BORDER_RANGE_K;
  const coldK = AMBIENT_TEMPERATURE_K - BORDER_RANGE_K;

  // The two floating HUD strips (hud.ts). Siblings of `bench` rather than
  // children, so a rebuild of either can never disturb the canvas subtree,
  // and pointer events pass through the strips' own transparent gaps back to
  // the bench (see .hud in style.css).
  const hudTop = document.createElement('div');
  hudTop.className = 'hud hud-top';
  root.appendChild(hudTop);

  const hudBottom = document.createElement('div');
  hudBottom.className = 'hud hud-bottom';
  root.appendChild(hudBottom);

  // The tool rail (tool-rail.ts) -- same "floats over the bench, sibling of
  // it" arrangement as the two HUD strips, pinned to the left edge between
  // them.
  const toolRail = document.createElement('div');
  toolRail.className = 'tool-rail';
  root.appendChild(toolRail);

  // canvasWrap fills the bench minus the tool rail's strip on the left (see
  // --rail-inset), so this only has to size the canvas *inside* it: the
  // largest box preserving the grid's aspect ratio that still fits, centered,
  // with any letterboxing landing in the wrap's margins -- which is exactly
  // where the HUD strips float, so the chrome mostly covers dead space rather
  // than bench. Measuring canvasWrap rather than bench is what keeps the
  // canvas out from under the rail. Plain CSS aspect-ratio auto-sizing
  // doesn't reliably shrink a block to fit *both* axes at once (it'll happily
  // overflow one dimension while respecting the other), so this stays in JS.
  const fitCanvasWrap = (): void => {
    const availW = Math.floor(canvasWrap.clientWidth);
    const availH = Math.floor(canvasWrap.clientHeight);
    if (availW <= 0 || availH <= 0) return;
    const ratio = gridWidth > 0 && gridHeight > 0 ? gridWidth / gridHeight : 1.6;
    const width = Math.floor(Math.min(availW, availH * ratio));
    const height = Math.floor(width / ratio);
    // The canvas is not the ResizeObserver's target (bench is, and bench's
    // own size comes from root, not from its children), so unlike the old
    // canvas-col arrangement there's no write-then-re-observe feedback loop
    // to break here.
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    updateApparatusOverlay(lastHoverX, lastHoverY);
    updateSelectionBox();
  };
  const resizeObserver = new ResizeObserver(fitCanvasWrap);
  resizeObserver.observe(bench);
  window.addEventListener('resize', fitCanvasWrap);

  // Tool Chest (tool-chest.ts), tool settings (side-panel.ts in a modal
  // shell) and the bench menu (hud.ts) -- three more backdrop overlays with
  // the same show/hide-and-rebuild convention as ptOverlay below.
  const chestOverlay = document.createElement('div');
  chestOverlay.className = 'pt-overlay';
  chestOverlay.style.display = 'none';
  root.appendChild(chestOverlay);
  closeOnBackdropClick(chestOverlay, () => {
    chestOpen = false;
    ptSelectedSymbol = null;
    render();
  });

  const toolSettingsOverlay = document.createElement('div');
  toolSettingsOverlay.className = 'pt-overlay';
  toolSettingsOverlay.style.display = 'none';
  root.appendChild(toolSettingsOverlay);
  closeOnBackdropClick(toolSettingsOverlay, () => {
    toolSettingsOpen = false;
    render();
  });

  // The tool-settings panel body is one long-lived node that gets moved into
  // the modal shell each time it opens, rather than a fresh element per open:
  // the frame handler below tests `sidePanel.contains(document.activeElement)`
  // to skip rebuilds mid-slider-drag, and that test needs a stable identity.
  const sidePanel = document.createElement('div');
  sidePanel.className = 'side-panel side-panel-modal';

  // The tool-settings modal *shell* is built once here for the same reason
  // the panel body above is: renderSidePanel runs on every worker frame for
  // some tools (select-apparatus, sink), and a shell rebuilt at 60Hz replaces
  // the ✕ button between a real mouse's pointerdown and pointerup -- so the
  // browser never fires a click and the modal simply could not be dismissed
  // by clicking it (most visible with the Select tool, whose panel rebuilds
  // every single frame). Only the title text and the overlay's display are
  // touched per render now.
  const toolSettingsModal = document.createElement('div');
  toolSettingsModal.className = 'pt-modal tool-settings-modal';
  const toolSettingsHeader = document.createElement('div');
  toolSettingsHeader.className = 'pt-modal-header';
  const toolSettingsTitle = document.createElement('div');
  toolSettingsTitle.className = 'pt-modal-title';
  toolSettingsHeader.appendChild(toolSettingsTitle);
  const toolSettingsClose = document.createElement('button');
  toolSettingsClose.className = 'pt-close-btn';
  toolSettingsClose.textContent = '✕';
  toolSettingsClose.title = 'Close (Esc, or click outside)';
  toolSettingsClose.onclick = () => {
    toolSettingsOpen = false;
    render();
  };
  toolSettingsHeader.appendChild(toolSettingsClose);
  toolSettingsModal.appendChild(toolSettingsHeader);
  toolSettingsModal.appendChild(sidePanel);
  toolSettingsOverlay.appendChild(toolSettingsModal);

  const benchMenuOverlay = document.createElement('div');
  benchMenuOverlay.className = 'pt-overlay';
  benchMenuOverlay.style.display = 'none';
  root.appendChild(benchMenuOverlay);
  closeOnBackdropClick(benchMenuOverlay, () => {
    benchMenuOpen = false;
    render();
  });

  const ptOverlay = document.createElement('div');
  ptOverlay.className = 'pt-overlay';
  ptOverlay.style.display = 'none';
  root.appendChild(ptOverlay);
  closeOnBackdropClick(ptOverlay, () => {
    ptOpen = false;
    ptSelectedSymbol = null;
    render();
  });

  // Campaign briefing/win modal -- same fixed backdrop as ptOverlay (see
  // .campaign-overlay in style.css), shown full-screen over an otherwise
  // inert bench until Start is clicked, and again once the goals are met.
  // Deliberately not click-away dismissable (and Esc doesn't close it
  // either): both states are waiting on a decision -- start the experiment,
  // replay it, take the next one -- and there's no way to bring either back
  // once dismissed.
  const campaignOverlay = document.createElement('div');
  campaignOverlay.className = 'pt-overlay campaign-overlay';
  campaignOverlay.style.display = 'none';
  root.appendChild(campaignOverlay);

  const worker = new Worker(new URL('../sim/worker.ts', import.meta.url), { type: 'module' });
  const send = (message: MainToWorkerMessage): void => worker.postMessage(message);

  // Comfort settings (see .grill/campaign-mode.md's §6 point 5) -- loaded
  // once per mount, applied immediately so body classes are correct before
  // the first frame; `renderSettingsOverlay`'s onChange keeps both this
  // variable and localStorage in sync on every toggle.
  let comfortSettings = loadComfortSettings();
  applyComfortSettings(comfortSettings);

  // In-memory campaign-progress cache (see campaign-progress.ts) -- loaded
  // once and only ever written back to localStorage when it actually
  // changes (a discovery, an achievement, or a win), not every frame. Used
  // for species discovery (Cabinet) and achievement checks in the 'frame'
  // handler below, in addition to the win-recording checkForWin already did.
  let progress = loadProgress();
  const knownSpeciesIds = new Set<number>();
  // Milestone-chime bookkeeping: the previous frame's goal fractions, so a
  // 25/50/75/100% crossing can be detected without re-deriving it from raw
  // totals (see maybePlayMilestoneChimes below).
  let prevGoalFractions: number[] = [];
  // Sink-sparkle bookkeeping: the previous frame's sinkTotals, diffed
  // against the new one to find out which species (and how much of it) got
  // consumed this frame -- see maybeSparkleSinks below.
  let prevSinkTotals: Uint32Array | null = null;

  // Campaign state -- null/false/empty for the whole session in sandbox
  // mode. `activeScenario` is looked up once from options.scenarioId; every
  // other field here is mutated by loadScenarioInto (Start/Replay/Next) and
  // the 'frame' handler's win check below.
  const initialScenario: Scenario | null =
    options.mode === 'campaign' && options.scenarioId ? (SCENARIOS.find((s) => s.id === options.scenarioId) ?? null) : null;
  let activeScenario: Scenario | null = initialScenario;
  let restrictions: Restrictions | null = initialScenario?.rules ?? null;
  let briefingAcknowledged = false;
  let scenarioWon = false;
  let winStars = 0;
  let winElapsedSeconds = 0;
  let revealedHints: string[] = [];
  let lastObjectives: GoalProgress[] = [];
  // Run Test burst status (see campaign-hud.ts's BurstStatus) -- null
  // whenever no 'runBurst' is in flight, mirrored from worker.ts's own
  // 'burstProgress' messages.
  let burst: BurstStatus | null = null;

  let gridWidth = 0;
  let gridHeight = 0;
  let renderer: Renderer | null = null;
  let palette: PaletteEntry[] = [];
  let tool: Tool | null = null;
  let running = true;
  let speed = 1;
  let brushWidth = DEFAULT_RADIUS;
  let brushTempC = DEFAULT_BRUSH_TEMP_C;
  let radiationRadius = DEFAULT_RADIATION_RADIUS;
  let targetTempC = DEFAULT_RADIATOR_TARGET_C;
  let pinnedLabels = loadPinnedLabels();
  let ptOpen = false;
  // The three modal surfaces that replaced the docked toolbar/side panel.
  // Their open state lives here (not in the DOM) for the same reason every
  // other bit of UI state does: render() rebuilds these wholesale.
  let chestOpen = false;
  let chestQuery = '';
  let toolSettingsOpen = false;
  let benchMenuOpen = false;
  let ptSelectedSymbol: string | null = null;
  let ptTarget: 'paint' | 'funnel-config' | 'funnel-edit' | 'tube-filter-add' | 'tube-filter-edit-add' | 'filter-add' = 'paint';
  let isPointerDown = false;
  let isGrabbing = false;
  // The mixer tool's active brush stroke: while held, position updates go
  // straight to the worker's stirState (stirStart/stirMove/stirEnd) instead
  // of through applyTool, since the worker re-stirs that position every
  // simulation tick on its own -- see worker.ts's runOneTick.
  let isMixing = false;

  // Addition-funnel tool config (pre-placement) -- captured into the
  // instance at placement time, same "settings are a snapshot, not
  // retroactive" convention as the radiator's sliders (see
  // describeToolMeta's radiator case). Same shape as ApparatusSelection's
  // FunnelEditDraft (a placed funnel's live edit draft) so funnelSetter
  // below can write through either one uniformly.
  const funnelDraft: FunnelEditDraft = {
    specId: 0,
    tempC: DEFAULT_BRUSH_TEMP_C,
    ratePerMinute: DEFAULT_FUNNEL_RATE_PER_MINUTE,
    totalMode: 'finite',
    totalAmount: DEFAULT_FUNNEL_TOTAL_AMOUNT,
  };
  let funnelFacing: FunnelFacing = 'down';
  let lastHoverX = 0;
  let lastHoverY = 0;

  // Flask apparatus config (pre-placement) -- same "captured at placement
  // time" convention as funnelFacing/funnelDraft above. Facing rotates in
  // 45-degree steps (8 facings), unlike the funnel's 4.
  let flaskFacing: FlaskFacing = 'up';
  let flaskSizeScale = DEFAULT_FLASK_SIZE_SCALE;
  // Whether a placed flask comes with a stirrer over its interior. One
  // setting shared by both glassware shapes (see side-panel.ts's flask
  // panel), replacing the separate "Erlenmeyer (stirred)" chest entry.
  let flaskStirred = false;

  // select-apparatus tool's selection/edit-draft/drag state for both
  // apparatus types -- see apparatus-selection.ts.
  const apparatusSelection = new ApparatusSelection();

  // Conveyor-tube tool config (pre-placement) -- same "captured at placement
  // time" convention as the funnel's config above, and same shape as
  // ApparatusSelection's TubeEditDraft for the same reason (see
  // funnelDraft/funnelSetter). null filter = accept every species.
  const tubeDraft: TubeEditDraft = { coneSize: DEFAULT_TUBE_CONE_SIZE, filter: null };

  // Filter apparatus's global species allow-list -- unlike the funnel/tube
  // drafts above, this isn't captured at placement time: it's a live global
  // gate (see worker.ts's filterAllowSpecies) sent to the worker immediately
  // on every add/remove via sendFilterSpecies, since it affects every filter
  // line already drawn on the grid, not just future placements.
  let filterSpecies = new Set<number>();
  function sendFilterSpecies(): void {
    send({ type: 'setFilterSpecies', species: [...filterSpecies] });
  }

  // In-progress polygon draw (see isPolygonTool -- the conveyor tube and the
  // Glass tool share the interaction): points already committed by a click,
  // plus a live rubber-band preview point tracking the cursor (snapped from
  // the last committed point). Cleared back to [] on right-click/Escape (see
  // finishPolyDraw/cancelPolyDraw).
  let polyDrawPoints: Point[] = [];
  let polyDrawPreview: Point | null = null;

  // In-progress straight-line draw (see isLineDragTool -- the Sink/Vent and
  // the Filter share it): set on pointerdown, held through the drag, and
  // committed as one paintSinkLine/paintFilterLine message on pointerup (see
  // the window pointerup handler below). Unlike every brush tool, these are a
  // single free-form drag from anchor to release point, not a repeated
  // per-move paint.
  let lineDrawStart: Point | null = null;

  // Label/color/palette-entry lookup for the probe, funnel field display,
  // and debug hook (see species-lookup.ts).
  const speciesLookup = buildSpeciesLookup();

  // Latest frame data, kept around purely so the hover inspector can look
  // up a cell locally without a worker round trip.
  let lastSpecId: Uint16Array | null = null;
  let lastPhase: Uint8Array | null = null;
  let lastTempK: Float32Array | null = null;
  let lastRadiatorRadius: Uint8Array | null = null;
  let lastRadiatorTargetK: Float32Array | null = null;
  let lastSinkMask: Uint8Array | null = null;
  let lastSinkTotals: Uint32Array | null = null;
  let lastSinkGrandTotal = 0;
  let lastVentTotals: Uint32Array | null = null;
  let lastVentGrandTotal = 0;
  let hasSnapshot = false;
  let lastTick = 0;

  function describeToolMeta(t: Tool | null): ToolMeta {
    if (!t) return { ...TOOL_META_DEFAULTS, label: 'No tool selected', color: '#3a3d3a' };
    if (t.kind === 'paint') {
      const entry = speciesLookup.paletteEntryOf(t.specId);
      if (!entry) return describeToolMeta(null);
      return {
        ...TOOL_META_DEFAULTS,
        label: entry.label,
        color: entry.color,
        category: isElementLabel(entry.label) ? 'ELEMENT' : 'COMPOUND',
        isSpecies: true,
        meltLabel: formatCelsius(entry.meltingPointC),
        boilLabel: formatCelsius(entry.boilingPointC),
        phaseLabel: PHASE_LABEL[entry.phase] ?? '',
        showBrushTemp: true,
      };
    }
    if (t.kind === 'wall') {
      const wall = getWall(t.specId);
      // Glass draws as a polygon chain stamped at ambient temperature (see
      // isGlassPolygonTool and the worker's 'placeGlassPolyline'), so it has
      // neither a brush width nor a brush temperature to offer.
      if (isGlassPolygonTool(t)) {
        return {
          ...TOOL_META_DEFAULTS,
          label: wall.label,
          color: wall.color,
          category: 'APPARATUS',
          showBrushWidth: false,
          glassPanel: 'config',
        };
      }
      return { ...TOOL_META_DEFAULTS, label: wall.label, color: wall.color, category: 'APPARATUS', showBrushTemp: true };
    }
    if (t.kind === 'radiator') {
      return { ...TOOL_META_DEFAULTS, label: RADIATOR_LABEL, color: RADIATOR_COLOR, category: 'APPARATUS', isThermal: true };
    }
    if (t.kind === 'funnel') {
      return {
        ...TOOL_META_DEFAULTS,
        label: FUNNEL_LABEL,
        color: FUNNEL_COLOR,
        category: 'APPARATUS',
        showBrushWidth: false,
        funnelPanel: 'config',
      };
    }
    if (t.kind === 'tube') {
      return {
        ...TOOL_META_DEFAULTS,
        label: TUBE_LABEL,
        color: TUBE_COLOR,
        category: 'APPARATUS',
        showBrushWidth: false,
        tubePanel: 'config',
      };
    }
    if (t.kind === 'stirrer') {
      return { ...TOOL_META_DEFAULTS, label: STIRRER_LABEL, color: STIRRER_COLOR, category: 'APPARATUS' };
    }
    if (t.kind === 'filter') {
      // Always a one-cell-wide line drag -- no brush width to show.
      return { ...TOOL_META_DEFAULTS, label: FILTER_LABEL, color: FILTER_COLOR, category: 'APPARATUS', showBrushWidth: false, filterPanel: 'config' };
    }
    if (t.kind === 'sink') {
      const isVent = t.port === SinkMaskValue.Vent;
      return {
        ...TOOL_META_DEFAULTS,
        label: isVent ? VENT_LABEL : SINK_LABEL,
        color: isVent ? VENT_COLOR : SINK_COLOR,
        category: 'APPARATUS',
        sinkPanel: isVent ? 'vent' : 'sink',
      };
    }
    if (t.kind === 'flask') {
      return {
        ...TOOL_META_DEFAULTS,
        label: flaskLabel(t.flask, flaskStirred),
        color: FUNNEL_COLOR,
        category: 'APPARATUS',
        showBrushWidth: false,
        flaskPanel: 'config',
      };
    }
    if (t.kind === 'select-apparatus') {
      // The only branch that depends on live selection state rather than
      // just the tool kind, so it stays logic instead of a static table row.
      const selectedFunnel = apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId);
      const selectedTube = apparatusSelection.findTube(apparatusSelection.selectedTubeId);
      const selectedFlask = apparatusSelection.findFlask(apparatusSelection.selectedFlaskId);
      const nothingSelected = !selectedFunnel && !selectedTube && !selectedFlask;
      return {
        ...TOOL_META_DEFAULTS,
        label: selectedFunnel
          ? FUNNEL_LABEL
          : selectedTube
            ? TUBE_LABEL
            : selectedFlask
              ? // Prefer the live edit draft over the worker's snapshot: the
                // snapshot only catches up a frame later, and the HUD chip
                // isn't rebuilt per frame, so a shape/stirred toggle would
                // otherwise keep reading stale until some unrelated render.
                flaskLabel(
                  apparatusSelection.flaskEditDraft?.kind ?? selectedFlask.kind,
                  apparatusSelection.flaskEditDraft?.stirred ?? selectedFlask.stirred,
                )
              : SELECT_APPARATUS_LABEL,
        color: selectedFunnel ? FUNNEL_COLOR : selectedTube ? TUBE_COLOR : selectedFlask ? FLASK_COLOR : SELECT_APPARATUS_COLOR,
        category: nothingSelected ? 'TOOL' : 'APPARATUS',
        showBrushWidth: false,
        funnelPanel: selectedFunnel ? 'edit' : nothingSelected ? 'edit-empty' : 'none',
        tubePanel: selectedTube ? 'edit' : 'none',
        flaskPanel: selectedFlask ? 'edit' : 'none',
      };
    }
    const info = SIMPLE_TOOL_META[t.kind];
    return { ...TOOL_META_DEFAULTS, label: info.label, color: info.color, category: 'TOOL' };
  }

  function setTool(next: Tool): void {
    // Switching away from the tube tool mid-draw discards whatever's been
    // clicked so far rather than leaving it to silently reappear (still
    // held in polyDrawPoints) if the player switches back later.
    if (isPolygonTool(tool) && polyDrawPoints.length > 0) {
      polyDrawPoints = [];
      polyDrawPreview = null;
    }
    // Same discard-on-switch convention as the tube draw above: an
    // in-progress sink drag shouldn't silently resume/commit if the player
    // switches tools mid-drag.
    if (isLineDragTool(tool)) {
      lineDrawStart = null;
    }
    tool = next;
    render();
  }

  function togglePin(label: string): void {
    pinnedLabels = pinnedLabels.includes(label) ? pinnedLabels.filter((x) => x !== label) : [...pinnedLabels, label];
    savePinnedLabels(pinnedLabels);
    render();
  }

  /** Pushes the edit draft's full config to the worker as one message -- see
   * FunnelEditDraft's doc comment for why every field is sent together
   * rather than patched individually. */
  function sendFunnelUpdate(): void {
    const { selectedFunnelId, editDraft } = apparatusSelection;
    if (selectedFunnelId === null || !editDraft) return;
    send({
      type: 'updateFunnel',
      id: selectedFunnelId,
      specId: editDraft.specId,
      tempC: editDraft.tempC,
      ratePerMinute: editDraft.ratePerMinute,
      total: editDraft.totalMode === 'infinite' ? null : editDraft.totalAmount,
    });
  }

  /** Pushes a selected flask's whole config to the worker, which re-stamps
   * the vessel (see flask.ts's updateFlaskInstance). */
  function sendFlaskUpdate(): void {
    const { selectedFlaskId, flaskEditDraft } = apparatusSelection;
    if (selectedFlaskId === null || !flaskEditDraft) return;
    send({
      type: 'updateFlask',
      id: selectedFlaskId,
      facing: flaskEditDraft.facing,
      sizeScale: flaskEditDraft.sizeScale,
      stirred: flaskEditDraft.stirred,
      kind: flaskEditDraft.kind,
    });
  }

  function sendTubeUpdate(): void {
    const { selectedTubeId, tubeEditDraft } = apparatusSelection;
    if (selectedTubeId === null || !tubeEditDraft) return;
    send({
      type: 'updateTube',
      id: selectedTubeId,
      coneSize: tubeEditDraft.coneSize,
      filter: tubeEditDraft.filter ? [...tubeEditDraft.filter] : null,
    });
  }

  /** Non-zero entries of the Sink tool's global tally, sorted highest-first
   * -- built fresh from the latest frame's sinkTotals each render rather
   * than stored incrementally, since the worker is the source of truth (a
   * Reset zeroes it there, not just in the UI). Species with no palette
   * entry (a non-paintable reaction product, same as the inspector's
   * fallback) are skipped rather than shown as "spec N" -- a raw id means
   * nothing to the player in a tally list. */
  function sinkTallyEntries(totals: Uint32Array | null): SinkTallyEntry[] {
    if (!totals) return [];
    const entries: SinkTallyEntry[] = [];
    for (let specId = 0; specId < totals.length; specId++) {
      const count = totals[specId] as number;
      if (count === 0) continue;
      const label = speciesLookup.labelOf(specId);
      const color = speciesLookup.colorOf(specId);
      if (!label || !color) continue;
      entries.push({ label, color, count });
    }
    entries.sort((a, b) => b.count - a.count);
    return entries;
  }

  /** The ELEMENTS quick-row in campaign mode: the scenario's exact allowed
   * paint species (the "gear you get" from the briefing), replacing the
   * player's own sandbox pins for the duration -- 'all' falls back to the
   * normal pinned row (a future sandbox-like scenario), 'none' shows no
   * species at all (a funnel-only continuous-process scenario). */
  function effectivePinnedLabels(): string[] {
    if (!restrictions || restrictions.paintSpecies === 'all') return pinnedLabels;
    if (restrictions.paintSpecies === 'none') return [];
    return restrictions.paintSpecies.map((specId) => speciesLookup.labelOf(specId)).filter((label): label is string => !!label);
  }

  /** The species a freshly (re)loaded scenario should start the paint tool
   * on -- the first of the scenario's allowed reagents, or the usual
   * sandbox pinned-species default when unrestricted. undefined (no default
   * paint tool) for a 'none' scenario, which only works through funnels. */
  function defaultPaintSpecId(): number | undefined {
    if (restrictions && restrictions.paintSpecies !== 'all') {
      return restrictions.paintSpecies === 'none' ? undefined : restrictions.paintSpecies[0];
    }
    const firstPinned = pinnedLabels.map((label) => palette.find((entry) => entry.label === label)).find((entry): entry is PaletteEntry => !!entry);
    return (firstPinned ?? palette[0])?.specId;
  }

  /** Stamps a scenario onto the worker (fresh bench, restrictions active)
   * and resets every piece of campaign UI state back to "briefing not yet
   * acknowledged" -- shared by the initial mount, the win overlay's Replay,
   * and its Next experiment, so all three go through exactly one path. */
  function loadScenarioInto(scenario: Scenario): void {
    activeScenario = scenario;
    restrictions = scenario.rules;
    briefingAcknowledged = false;
    scenarioWon = false;
    winStars = 0;
    winElapsedSeconds = 0;
    revealedHints = [];
    lastObjectives = [];
    prevGoalFractions = [];
    burst = null;
    canvasWrap.classList.remove('bursting');
    const specId = defaultPaintSpecId();
    tool = specId !== undefined ? { kind: 'paint', specId } : null;
    send({ type: 'loadScenario', scenario });
    render();
    renderCampaignHud();
    renderCampaignOverlay();
  }

  /** The persistent in-experiment progress panel (see campaign-hud.ts's
   * buildObjectiveHud) -- hidden in sandbox mode and before Start, since
   * there's nothing to show yet. Rebuilt on every frame while a scenario is
   * running so its bars track the worker's live objectives. */
  function renderCampaignHud(): void {
    if (!activeScenario || !briefingAcknowledged) {
      campaignHud.style.display = 'none';
      campaignHud.innerHTML = '';
      return;
    }
    campaignHud.style.display = 'flex';
    buildObjectiveHud(
      campaignHud,
      activeScenario,
      describeObjectives(lastObjectives, speciesLookup),
      revealedHints,
      burst,
      hasSnapshot,
      !scenarioWon,
      {
        onRevealHint: () => {
          const next = activeScenario?.hints[revealedHints.length];
          if (next === undefined) return;
          revealedHints = [...revealedHints, next];
          renderCampaignHud();
          // A revealed hint adds a line and changes the HUD's height, unlike
          // the routine per-frame progress-bar updates below -- re-fit the
          // canvas so it doesn't end up overlapping the taller panel.
          fitCanvasWrap();
        },
        onRunTest: () => {
          if (burst) return;
          send({ type: 'runBurst', ticks: RUN_TEST_TICKS });
        },
        onCancelTest: () => send({ type: 'cancelBurst' }),
        onRewind: () => send({ type: 'restoreWorld' }),
      },
    );
  }

  /** The full-screen briefing (before Start) / win (after every goal is
   * met) modal -- mutually exclusive, both hidden in sandbox mode and once
   * the player is mid-experiment. */
  function renderCampaignOverlay(): void {
    if (!activeScenario) {
      campaignOverlay.style.display = 'none';
      campaignOverlay.innerHTML = '';
      return;
    }
    if (!briefingAcknowledged) {
      campaignOverlay.style.display = 'flex';
      buildBriefing(campaignOverlay, activeScenario, {
        onStart: () => {
          briefingAcknowledged = true;
          renderCampaignOverlay();
          renderCampaignHud();
          // The HUD just went from hidden to visible -- see the hint-reveal
          // handler's comment on why this needs an explicit re-fit.
          fitCanvasWrap();
        },
      });
      return;
    }
    if (scenarioWon) {
      campaignOverlay.style.display = 'flex';
      const index = SCENARIOS.findIndex((s) => s.id === activeScenario?.id);
      const next = index >= 0 ? SCENARIOS[index + 1] : undefined;
      buildWinOverlay(campaignOverlay, activeScenario, winStars, winElapsedSeconds, {
        onReplay: () => loadScenarioInto(activeScenario as Scenario),
        onNextScenario: next ? () => loadScenarioInto(next) : undefined,
        onExitToSelect: () => (options.onExitToScenarioSelect ?? options.onExitToMenu)?.(),
      });
      return;
    }
    campaignOverlay.style.display = 'none';
    campaignOverlay.innerHTML = '';
  }

  function render(): void {
    renderHud();
    renderToolRail();
    renderToolChest();
    renderBenchMenu();
    renderSidePanel();
    fitCanvasWrap();
  }

  /** Whether the active tool has anything to configure beyond the two brush
   * sliders the HUD already carries -- decides whether the "⚙ Tool settings"
   * button appears at all, so it never opens an empty modal. */
  function hasToolSettings(meta: ToolMeta): boolean {
    return (
      meta.isSpecies ||
      meta.isThermal ||
      meta.funnelPanel !== 'none' ||
      meta.tubePanel !== 'none' ||
      meta.filterPanel !== 'none' ||
      meta.flaskPanel !== 'none' ||
      meta.glassPanel !== 'none' ||
      meta.sinkPanel !== 'none'
    );
  }

  function isToolKindActive(kind: UiToolKind): boolean {
    if (kind === 'flask-erlenmeyer') return tool?.kind === 'flask' && tool.flask === 'erlenmeyer';
    if (kind === 'flask-beaker') return tool?.kind === 'flask' && tool.flask === 'beaker';
    if (kind === 'sink') return tool?.kind === 'sink' && tool.port === SinkMaskValue.Sink;
    if (kind === 'vent') return tool?.kind === 'sink' && tool.port === SinkMaskValue.Vent;
    return tool?.kind === kind;
  }

  function selectToolKind(kind: UiToolKind): void {
    if (kind === 'flask-erlenmeyer') setTool({ kind: 'flask', flask: 'erlenmeyer' });
    else if (kind === 'flask-beaker') setTool({ kind: 'flask', flask: 'beaker' });
    else if (kind === 'sink') setTool({ kind: 'sink', port: SinkMaskValue.Sink });
    else if (kind === 'vent') setTool({ kind: 'sink', port: SinkMaskValue.Vent });
    else setTool({ kind });
  }

  /** In campaign mode, "Clear All" means "start this experiment over" -- a
   * bare resetWorld would wipe the worker's activeScenario too (see
   * worker.ts's 'resetWorld' handler), leaving this module still thinking a
   * scenario is active while the worker no longer restricts anything. */
  function resetWorld(): void {
    if (activeScenario) {
      if (!window.confirm('Reset this experiment back to the start?')) return;
      loadScenarioInto(activeScenario);
      return;
    }
    if (!window.confirm('Clear the whole grid? This cannot be undone unless you Save first.')) return;
    send({ type: 'resetWorld' });
  }

  function renderHud(): void {
    const meta = describeToolMeta(tool);
    const hudCallbacks: HudCallbacks = {
      toolLabel: meta.label,
      toolColor: meta.color,
      toolCategory: meta.category,
      hasToolSettings: hasToolSettings(meta),
      onOpenToolSettings: () => {
        toolSettingsOpen = true;
        render();
      },
      running,
      speed,
      onTogglePause: () => {
        running = !running;
        send({ type: 'setRunning', running });
        render();
      },
      onStep: () => send({ type: 'step' }),
      onSetSpeed: (value) => {
        speed = value;
        send({ type: 'setSpeed', speed });
        render();
      },
      onOpenBenchMenu: () => {
        benchMenuOpen = true;
        render();
      },
      campaign: options.mode === 'campaign',
      showBrushWidth: meta.showBrushWidth,
      brushWidth,
      // No render() on either brush slider: a rebuild mid-drag would replace
      // the input node under the browser's own drag gesture and kill it (same
      // reasoning as side-panel.ts's addSlider). The slider updates its own
      // readout in place.
      onSetBrushWidth: (value) => {
        brushWidth = value;
      },
      showBrushTemp: meta.showBrushTemp,
      brushTempC,
      onSetBrushTemp: (value) => {
        brushTempC = value;
      },
      hotLabel: formatCelsius(kelvinToCelsius(hotK)),
      coldLabel: formatCelsius(kelvinToCelsius(coldK)),
    };
    buildHud(hudTop, hudBottom, hudCallbacks);
  }

  function openChest(): void {
    chestOpen = true;
    render();
  }

  function renderToolChest(): void {
    if (!chestOpen) {
      chestOverlay.style.display = 'none';
      chestOverlay.innerHTML = '';
      return;
    }
    chestOverlay.style.display = 'flex';
    const chestCallbacks: ToolChestCallbacks = {
      isPaintActive: (specId) => tool?.kind === 'paint' && tool.specId === specId,
      isPinned: (label) => pinnedLabels.includes(label),
      onSelectPaint: (specId) => setTool({ kind: 'paint', specId }),
      onTogglePin: togglePin,
      // The chest's periodic-table body shares ptSelectedSymbol with the
      // standalone modal -- the two are never open at once (the chest is the
      // paint picker, the modal is the funnel/tube/filter one), and both
      // clear it on close.
      selectedSymbol: ptSelectedSymbol,
      onSelectElement: (symbol) => {
        ptSelectedSymbol = symbol;
        render();
      },
      onClose: () => {
        chestOpen = false;
        ptSelectedSymbol = null;
        render();
      },
      pinnable: !restrictions,
      query: chestQuery,
      // Owned here rather than inside the chest so the search box survives the
      // rebuild that follows a pin toggle.
      onSetQuery: (value) => {
        chestQuery = value;
      },
    };
    if (restrictions) {
      const activeRestrictions = restrictions;
      chestCallbacks.isPaintLocked = (specId) => !isPaintAllowed(activeRestrictions, specId);
    }
    buildToolChest(chestOverlay, palette, effectivePinnedLabels(), chestCallbacks);
  }

  /** The left rail: every apparatus and tool as its own icon slot, plus the
   * species slot that opens the chest above. Rebuilt on every render() like
   * the HUD -- the active slot has to follow whatever setTool did. */
  function renderToolRail(): void {
    const activeSpecies = tool?.kind === 'paint' ? speciesLookup.paletteEntryOf(tool.specId) : null;
    const railCallbacks: ToolRailCallbacks = {
      isToolActive: isToolKindActive,
      isWallActive: (specId) => tool?.kind === 'wall' && tool.specId === specId,
      onSelectTool: selectToolKind,
      onSelectWall: (specId) => setTool({ kind: 'wall', specId }),
      speciesActive: !!activeSpecies,
      speciesLabel: activeSpecies?.label ?? 'Paint',
      speciesColor: activeSpecies?.color ?? '#6fd3a8',
      onOpenSpecies: openChest,
    };
    if (restrictions) {
      const activeRestrictions = restrictions;
      railCallbacks.isWallLocked = (specId) => !isPaintAllowed(activeRestrictions, specId);
      railCallbacks.isToolLocked = (kind) => {
        const simKind = toSimToolKind(kind);
        return simKind === null ? false : !isToolAllowed(activeRestrictions, simKind);
      };
    }
    buildToolRail(toolRail, wallList(), railCallbacks);
  }

  function renderBenchMenu(): void {
    if (!benchMenuOpen) {
      benchMenuOverlay.style.display = 'none';
      benchMenuOverlay.innerHTML = '';
      return;
    }
    benchMenuOverlay.style.display = 'flex';
    const close = (): void => {
      benchMenuOpen = false;
      render();
    };
    const benchMenuCallbacks: BenchMenuCallbacks = {
      hasSnapshot,
      onSnapshotWorld: () => send({ type: 'snapshotWorld' }),
      onRestoreWorld: () => send({ type: 'restoreWorld' }),
      resetWorldLabel: activeScenario ? 'Reset Experiment' : 'Clear All',
      onResetWorld: resetWorld,
      onOpenComfortSettings: () => toggleSettingsOverlay(true),
      onClose: close,
    };
    if (options.onExitToMenu) {
      benchMenuCallbacks.onExitToMenu = () => {
        if (!window.confirm('Leave and return to the menu? This will lose anything not saved.')) return;
        options.onExitToMenu?.();
      };
    }
    buildBenchMenu(benchMenuOverlay, benchMenuCallbacks);
  }

  function renderSidePanel(): void {
    const meta = describeToolMeta(tool);
    const showingVent = meta.sinkPanel === 'vent';
    const isEditMode = tool?.kind === 'select-apparatus';
    // The select-apparatus tool's own selection can go stale (the selected
    // apparatus got erased) -- drop it rather than keep pointing an edit
    // panel at nothing.
    if (isEditMode) apparatusSelection.dropStaleSelection();
    const selectedFunnel = isEditMode ? apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId) : undefined;
    const selectedTube = isEditMode ? apparatusSelection.findTube(apparatusSelection.selectedTubeId) : undefined;
    const selectedFlask = isEditMode ? apparatusSelection.findFlask(apparatusSelection.selectedFlaskId) : undefined;
    if (isEditMode && selectedFunnel && !apparatusSelection.editDraft) {
      apparatusSelection.editDraft = {
        specId: selectedFunnel.specId,
        tempC: selectedFunnel.tempC,
        ratePerMinute: selectedFunnel.ratePerMinute,
        totalMode: selectedFunnel.total === null ? 'infinite' : 'finite',
        totalAmount: selectedFunnel.total ?? funnelDraft.totalAmount,
      };
    }
    if (isEditMode && selectedTube && !apparatusSelection.tubeEditDraft) {
      apparatusSelection.tubeEditDraft = {
        coneSize: selectedTube.coneSize,
        filter: selectedTube.filter ? new Set(selectedTube.filter) : null,
      };
    }
    if (isEditMode && selectedFlask && !apparatusSelection.flaskEditDraft) {
      apparatusSelection.flaskEditDraft = {
        facing: selectedFlask.facing,
        sizeScale: selectedFlask.sizeScale,
        stirred: selectedFlask.stirred,
        kind: selectedFlask.kind,
      };
    }
    const isTubeEditMode = isEditMode && !!selectedTube;
    const isFlaskEditMode = isEditMode && !!selectedFlask;
    const flaskFields: FlaskEditDraft =
      isFlaskEditMode && apparatusSelection.flaskEditDraft
        ? apparatusSelection.flaskEditDraft
        : { facing: flaskFacing, sizeScale: flaskSizeScale, stirred: flaskStirred, kind: tool?.kind === 'flask' ? tool.flask : DEFAULT_FLASK_KIND };
    const tubeFields: TubeFieldValues =
      isTubeEditMode && apparatusSelection.tubeEditDraft ? apparatusSelection.tubeEditDraft : tubeDraft;

    const funnelFields: FunnelFieldValues =
      isEditMode && apparatusSelection.editDraft
        ? {
            specLabel: speciesLookup.labelOf(apparatusSelection.editDraft.specId) ?? `spec ${apparatusSelection.editDraft.specId}`,
            specColor: speciesLookup.colorOf(apparatusSelection.editDraft.specId) ?? '#888',
            tempC: apparatusSelection.editDraft.tempC,
            ratePerMinute: apparatusSelection.editDraft.ratePerMinute,
            totalMode: apparatusSelection.editDraft.totalMode,
            totalAmount: apparatusSelection.editDraft.totalAmount,
            remaining: selectedFunnel?.remaining ?? null,
            enabled: selectedFunnel?.enabled ?? false,
          }
        : {
            specLabel: speciesLookup.labelOf(funnelDraft.specId) ?? `spec ${funnelDraft.specId}`,
            specColor: speciesLookup.colorOf(funnelDraft.specId) ?? '#888',
            tempC: funnelDraft.tempC,
            ratePerMinute: funnelDraft.ratePerMinute,
            totalMode: funnelDraft.totalMode,
            totalAmount: funnelDraft.totalAmount,
            remaining: null,
            enabled: false,
          };

    // The radiator tool's settings are only ever read at paint time (see
    // applyTool's 'radiator' case) -- adjusting these sliders is local UI
    // state until the next paint, and never retroactively touches radiators
    // already placed on the grid (see grid.ts's radiatorRadius/
    // radiatorTargetK doc comment). The funnel tool's config works the same
    // way pre-placement; once placed, select-apparatus edits go live
    // instead (see sendFunnelUpdate).
    //
    // Writes through whichever draft is live -- a placed funnel's
    // apparatusSelection.editDraft in edit mode, or the pre-placement
    // funnelDraft otherwise -- and pushes the change to the worker
    // immediately when editing a placed funnel. No render() by default: a
    // rebuild mid-drag would replace the slider DOM node under the
    // browser's own drag gesture, killing it (the slider's own oninput
    // already updates its displayed value in place -- see side-panel.ts's
    // addSlider). Pass { render: true } for a field whose panel layout
    // itself depends on the value (see onSetFunnelTotalMode below).
    function funnelSetter<K extends keyof FunnelEditDraft>(key: K, opts: { render?: boolean } = {}): (value: FunnelEditDraft[K]) => void {
      return (value) => {
        if (isEditMode && apparatusSelection.editDraft) {
          apparatusSelection.editDraft[key] = value;
          sendFunnelUpdate();
        } else {
          funnelDraft[key] = value;
        }
        if (opts.render) render();
      };
    }

    /** Adds specId to a species filter set -- null means "accept every
     * species" (the default), so adding to that state starts a fresh
     * single-member Set rather than materializing the full palette (unlike
     * the old checkbox-list's deny-list semantics, a chip list reads as an
     * allow-list). Shared by both branches (a placed tube's live filter, or
     * the pre-placement one) of onOpenTubeFilterPicker's ptTarget dispatch
     * below. */
    function addFilterSpecies(filter: ReadonlySet<number> | null, specId: number): Set<number> {
      const next = new Set(filter ?? []);
      next.add(specId);
      return next;
    }

    /** Removes specId from a species filter set, collapsing back to null
     * (accept every species) once the last chip is removed rather than
     * leaving an empty-but-non-null Set, which would silently mean "blocks
     * everything." */
    function removeFilterSpecies(filter: ReadonlySet<number> | null, specId: number): Set<number> | null {
      if (!filter) return null;
      const next = new Set(filter);
      next.delete(specId);
      return next.size === 0 ? null : next;
    }

    /** Same convention as funnelSetter, for the tube tool's coneSize/filter
     * fields. */
    function tubeSetter<K extends keyof TubeEditDraft>(key: K, opts: { render?: boolean } = {}): (value: TubeEditDraft[K]) => void {
      return (value) => {
        if (isTubeEditMode && apparatusSelection.tubeEditDraft) {
          apparatusSelection.tubeEditDraft[key] = value;
          sendTubeUpdate();
        } else {
          tubeDraft[key] = value;
        }
        if (opts.render) render();
      };
    }

    /** Same convention as funnelSetter/tubeSetter: writes through whichever
     * flask config is live -- a selected flask's edit draft (pushed straight
     * to the worker, which re-stamps the vessel) or the pre-placement tool
     * state. */
    function flaskSetter<K extends keyof FlaskEditDraft>(key: K, opts: { render?: boolean } = {}): (value: FlaskEditDraft[K]) => void {
      return (value) => {
        if (isFlaskEditMode && apparatusSelection.flaskEditDraft) {
          apparatusSelection.flaskEditDraft[key] = value;
          sendFlaskUpdate();
        } else if (key === 'sizeScale') {
          flaskSizeScale = value as number;
        } else if (key === 'stirred') {
          flaskStirred = value as boolean;
        }
        if (opts.render) render();
      };
    }

    const sidePanelCallbacks: SidePanelCallbacks = {
      brushWidth,
      onSetBrushWidth: (value) => {
        brushWidth = value;
      },
      brushTempC,
      onSetBrushTemp: (value) => {
        brushTempC = value;
      },
      radiationRadius,
      onSetRadiationRadius: (value) => {
        radiationRadius = value;
      },
      targetTempC,
      onSetTargetTemp: (value) => {
        targetTempC = value;
      },
      funnelFields,
      onOpenFunnelSpeciesPicker: () => {
        ptTarget = isEditMode ? 'funnel-edit' : 'funnel-config';
        ptOpen = true;
        render();
      },
      onSetFunnelTemp: funnelSetter('tempC'),
      onSetFunnelRate: funnelSetter('ratePerMinute'),
      // Unlike the other three fields (sliders, which rebuild-on-input would
      // fight the browser's native drag gesture -- see funnelSetter's doc
      // comment), totalMode is a discrete button toggle: switching finite
      // <-> infinite shows/hides the Amount field, so this one needs a
      // render to update the panel's layout.
      onSetFunnelTotalMode: funnelSetter('totalMode', { render: true }),
      onSetFunnelTotalAmount: funnelSetter('totalAmount'),
      onSetFunnelEnabled: (enabled) => {
        if (apparatusSelection.selectedFunnelId !== null) {
          send({ type: 'setFunnelEnabled', id: apparatusSelection.selectedFunnelId, enabled });
        }
      },
      onResetFunnel: () => {
        if (apparatusSelection.selectedFunnelId !== null) send({ type: 'resetFunnel', id: apparatusSelection.selectedFunnelId });
      },
      tubeFields,
      tubePalette: palette,
      onSetTubeConeSize: tubeSetter('coneSize'),
      onOpenTubeFilterPicker: () => {
        ptTarget = isTubeEditMode ? 'tube-filter-edit-add' : 'tube-filter-add';
        ptOpen = true;
        render();
      },
      onRemoveTubeFilterSpecies: (specId) => {
        if (isTubeEditMode && apparatusSelection.tubeEditDraft) {
          apparatusSelection.tubeEditDraft.filter = removeFilterSpecies(apparatusSelection.tubeEditDraft.filter, specId);
          sendTubeUpdate();
        } else {
          tubeDraft.filter = removeFilterSpecies(tubeDraft.filter, specId);
        }
        render();
      },
      filterSpecies,
      filterPalette: palette,
      onOpenFilterSpeciesPicker: () => {
        ptTarget = 'filter-add';
        ptOpen = true;
        render();
      },
      onRemoveFilterSpecies: (specId) => {
        filterSpecies.delete(specId);
        sendFilterSpecies();
        render();
      },
      flaskSizeScale: flaskFields.sizeScale,
      // No render() while a slider is being dragged -- see funnelSetter.
      onSetFlaskSize: flaskSetter('sizeScale'),
      flaskStirred: flaskFields.stirred,
      // Unlike the size slider, this is a discrete two-button toggle whose
      // own active state has to be redrawn -- and the HUD's tool chip shows
      // the stirred/plain label too, so this one does render().
      onSetFlaskStirred: flaskSetter('stirred', { render: true }),
      flaskShape: flaskFields.kind,
      onSetFlaskShape: flaskSetter('kind', { render: true }),
      // A Vent's panel shows what it threw away, a Sink's what it collected
      // -- two tallies, one panel (see side-panel.ts's sinkPanel).
      sinkTally: sinkTallyEntries(showingVent ? lastVentTotals : lastSinkTotals),
      sinkGrandTotal: showingVent ? lastVentGrandTotal : lastSinkGrandTotal,
      onResetSinkCounts: () => send({ type: 'resetSinkCounts' }),
    };
    // Brush width/temperature live permanently in the bottom HUD strip now,
    // so the modal suppresses its own copies rather than showing the same two
    // sliders twice (with the HUD's pair visible right behind the backdrop).
    buildSidePanel(sidePanel, { ...meta, showBrushWidth: false, showBrushTemp: false }, sidePanelCallbacks);
    renderToolSettingsOverlay(meta);

    if (ptOpen) {
      ptOverlay.style.display = 'flex';
      const ptCallbacks: PeriodicTableCallbacks = {
        selectedSymbol: ptSelectedSymbol,
        isPinned: (label) => pinnedLabels.includes(label),
        onSelectElement: (symbol) => {
          ptSelectedSymbol = symbol;
          render();
        },
        onSelectSpecies: (specId) => {
          if (ptTarget === 'funnel-config') {
            funnelDraft.specId = specId;
          } else if (ptTarget === 'funnel-edit' && apparatusSelection.editDraft) {
            apparatusSelection.editDraft.specId = specId;
            sendFunnelUpdate();
          } else if (ptTarget === 'tube-filter-add') {
            tubeDraft.filter = addFilterSpecies(tubeDraft.filter, specId);
          } else if (ptTarget === 'tube-filter-edit-add' && apparatusSelection.tubeEditDraft) {
            apparatusSelection.tubeEditDraft.filter = addFilterSpecies(apparatusSelection.tubeEditDraft.filter, specId);
            sendTubeUpdate();
          } else if (ptTarget === 'filter-add') {
            filterSpecies.add(specId);
            sendFilterSpecies();
          } else {
            setTool({ kind: 'paint', specId });
          }
          ptOpen = false;
          ptSelectedSymbol = null;
          render();
        },
        onTogglePin: togglePin,
        pinnable: !restrictions,
        onClose: () => {
          ptOpen = false;
          ptSelectedSymbol = null;
          render();
        },
      };
      if (restrictions) {
        const activeRestrictions = restrictions;
        ptCallbacks.isPaintLocked = (specId) => !isPaintAllowed(activeRestrictions, specId);
      }
      buildPeriodicTable(ptOverlay, palette, ptCallbacks);
    } else {
      ptOverlay.style.display = 'none';
      ptOverlay.innerHTML = '';
    }

    updateSelectionBox();
    updateApparatusOverlay(lastHoverX, lastHoverY);
  }

  /** Shows/hides the long-lived tool-settings modal (shell and body are both
   * built once -- see toolSettingsModal's declaration for why neither may be
   * rebuilt per render) and retitles it for the active tool. */
  function renderToolSettingsOverlay(meta: ToolMeta): void {
    // A tool with nothing left to configure once the HUD owns the brush
    // sliders has no modal to open; if it became the active tool while the
    // modal was up, close it rather than show an empty shell.
    if (!toolSettingsOpen || !hasToolSettings(meta)) {
      toolSettingsOpen = false;
      toolSettingsOverlay.style.display = 'none';
      return;
    }
    toolSettingsTitle.textContent = `${meta.label} settings`;
    toolSettingsOverlay.style.display = 'flex';
  }

  function gridCoordsFromEvent(event: PointerEvent): { x: number; y: number } {
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * gridWidth);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * gridHeight);
    return { x, y };
  }

  // Mirrors worker.ts's paintCircle: a brush of "radius" covers every cell
  // within that many grid cells of the center, so the visible outline spans
  // (2*radius + 1) cells across, converted to CSS pixels via the canvas's
  // on-screen size (which can differ from the grid's cell size due to CSS
  // scaling).
  function updateBrushOutline(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    if (gridWidth === 0 || gridHeight === 0) return;
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    const { x, y } = gridCoordsFromEvent(event);
    const centerPxX = (x + 0.5) * cellPxX;
    const centerPxY = (y + 0.5) * cellPxY;
    const radius = wallBrushRadius(tool, brushWidth);
    const diameterX = (2 * radius + 1) * cellPxX;
    const diameterY = (2 * radius + 1) * cellPxY;
    brushOutline.style.display = 'block';
    brushOutline.style.left = `${canvas.offsetLeft + centerPxX - diameterX / 2}px`;
    brushOutline.style.top = `${canvas.offsetTop + centerPxY - diameterY / 2}px`;
    brushOutline.style.width = `${diameterX}px`;
    brushOutline.style.height = `${diameterY}px`;
  }

  /** Draws the Glass tool's in-progress polygon: the exact one-cell-wide
   * cells the commit will stamp (the same Bresenham rasterization the worker
   * runs, via sinkLineCells), plus a handle dot on every clicked corner. */
  function drawGlassGhost(ctx: CanvasRenderingContext2D, points: readonly Point[], cellPxX: number, cellPxY: number): void {
    ctx.fillStyle = 'rgba(169, 214, 232, 0.75)';
    for (let i = 0; i + 1 < points.length; i++) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      for (const cell of sinkLineCells(a.x, a.y, b.x, b.y, 0)) {
        ctx.fillRect(cell.x * cellPxX, cell.y * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
      }
    }
    ctx.fillStyle = '#f2d94e';
    const handleR = Math.max(3, Math.min(cellPxX, cellPxY) * 0.7);
    for (const p of points) {
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * cellPxX, (p.y + 0.5) * cellPxY, handleR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Draws a tube's lumen (translucent species-blue) and wall ring
   * (translucent grey) plus a handle circle over each knee, onto the
   * already-sized/cleared preview canvas -- shared by the in-progress draw
   * (tool === 'tube') and the select-apparatus edit overlay for whichever
   * tube is currently selected, so both read the same visual language. */
  function drawTubeGhost(ctx: CanvasRenderingContext2D, points: readonly Point[], cellPxX: number, cellPxY: number, isDraft: boolean): void {
    if (points.length === 0) return;
    const lumen = polylineToLumenPath(points);
    ctx.fillStyle = isDraft ? 'rgba(169, 214, 232, 0.45)' : 'rgba(169, 214, 232, 0.3)';
    for (const cell of lumen) {
      ctx.fillRect(cell.x * cellPxX, cell.y * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
    }
    ctx.fillStyle = 'rgba(210, 210, 210, 0.55)';
    for (const cell of lumenWallCells(lumen)) {
      ctx.fillRect(cell.x * cellPxX, cell.y * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
    }
    ctx.fillStyle = isDraft ? '#f2d94e' : '#4da3ff';
    const handleR = Math.max(3, Math.min(cellPxX, cellPxY) * 0.7);
    for (const p of points) {
      ctx.beginPath();
      ctx.arc((p.x + 0.5) * cellPxX, (p.y + 0.5) * cellPxY, handleR, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** Ghost preview overlay, drawn on the shared 2D canvas (see
   * apparatusPreview's creation comment): the funnel tool's rotated glass
   * outline at the hovered cell, the tube tool's in-progress polyline with
   * a live rubber-band segment to the cursor, or the select-apparatus
   * tool's knee/segment handles for whichever tube is currently selected.
   * Resized to match the sim canvas's on-screen CSS size every call --
   * cheap, since it only runs on hover/wheel, not every tick. */
  function updateApparatusOverlay(x: number, y: number): void {
    const showFunnelGhost = tool?.kind === 'funnel';
    const showFlaskGhost = tool?.kind === 'flask';
    const showPolyDraw = isPolygonTool(tool) && polyDrawPoints.length > 0;
    const showLineDraw = isLineDragTool(tool) && lineDrawStart !== null;
    const editingTube = tool?.kind === 'select-apparatus' ? apparatusSelection.findTube(apparatusSelection.selectedTubeId) : undefined;
    if ((!showFunnelGhost && !showFlaskGhost && !showPolyDraw && !showLineDraw && !editingTube) || gridWidth === 0 || gridHeight === 0) {
      apparatusPreview.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (apparatusPreview.width !== width || apparatusPreview.height !== height) {
      apparatusPreview.width = width;
      apparatusPreview.height = height;
      previewCtx = apparatusPreview.getContext('2d');
    }
    if (!previewCtx) return;
    apparatusPreview.style.display = 'block';
    apparatusPreview.style.left = `${canvas.offsetLeft}px`;
    apparatusPreview.style.top = `${canvas.offsetTop}px`;
    apparatusPreview.style.width = `${width}px`;
    apparatusPreview.style.height = `${height}px`;
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    previewCtx.clearRect(0, 0, apparatusPreview.width, apparatusPreview.height);

    if (showFunnelGhost) {
      previewCtx.fillStyle = 'rgba(169, 214, 232, 0.55)';
      const shape = funnelShapeFor(funnelFacing);
      for (const cell of shape.cells) {
        const px = x + cell.dx;
        const py = y + cell.dy;
        previewCtx.fillRect(px * cellPxX, py * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
      }
    }

    if (showFlaskGhost) {
      previewCtx.fillStyle = 'rgba(169, 214, 232, 0.55)';
      const shape = flaskShapeFor(flaskFacing, flaskSizeScale, tool?.kind === 'flask' ? tool.flask : DEFAULT_FLASK_KIND);
      for (const cell of shape.cells) {
        const px = x + cell.dx;
        const py = y + cell.dy;
        previewCtx.fillRect(px * cellPxX, py * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
      }
    }

    if (showPolyDraw) {
      const last = polyDrawPoints[polyDrawPoints.length - 1] as Point;
      polyDrawPreview = snapOctant(last, { x, y });
      const chain = [...polyDrawPoints, polyDrawPreview];
      if (tool?.kind === 'tube') {
        drawTubeGhost(previewCtx, chain, cellPxX, cellPxY, true);
      } else {
        drawGlassGhost(previewCtx, chain, cellPxX, cellPxY);
      }
    }

    if (editingTube) {
      drawTubeGhost(previewCtx, editingTube.points, cellPxX, cellPxY, false);
    }

    if (showLineDraw && lineDrawStart) {
      const isFilter = tool?.kind === 'filter';
      const width = isFilter ? 0 : wallBrushRadius(tool, brushWidth);
      previewCtx.fillStyle = isFilter
        ? 'rgba(140, 224, 150, 0.6)'
        : tool?.kind === 'sink' && tool.port === SinkMaskValue.Vent
          ? 'rgba(111, 143, 168, 0.5)'
          : 'rgba(224, 72, 158, 0.5)';
      for (const cell of sinkLineCells(lineDrawStart.x, lineDrawStart.y, x, y, width)) {
        previewCtx.fillRect(cell.x * cellPxX, cell.y * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
      }
    }
  }

  /** Commits the in-progress polygon draw (right-click): places the tube or
   * stamps the glass polyline if at least one full segment was drawn, or
   * silently discards a lone first click with nothing to commit yet. */
  function finishPolyDraw(): void {
    if (polyDrawPoints.length >= 2) {
      if (tool?.kind === 'tube') {
        send({ type: 'placeTube', points: polyDrawPoints, coneSize: tubeDraft.coneSize, filter: tubeDraft.filter ? [...tubeDraft.filter] : null });
      } else {
        send({ type: 'placeGlassPolyline', points: polyDrawPoints });
      }
    }
    cancelPolyDraw();
  }

  /** Discards the in-progress polygon draw entirely (Escape) -- unlike
   * right-click, never places anything even if segments were already
   * committed. */
  function cancelPolyDraw(): void {
    polyDrawPoints = [];
    polyDrawPreview = null;
    render();
    updateApparatusOverlay(lastHoverX, lastHoverY);
  }

  /** Positions the select-apparatus tool's corner-bracket overlay over the
   * selected funnel's bounding box, or hides it. */
  function updateSelectionBox(): void {
    const isEditMode = tool?.kind === 'select-apparatus';
    const funnel = isEditMode ? apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId) : undefined;
    const flask = isEditMode ? apparatusSelection.findFlask(apparatusSelection.selectedFlaskId) : undefined;
    const box = funnel
      ? { anchorX: funnel.anchorX, anchorY: funnel.anchorY, bounds: funnelBounds(funnelShapeFor(funnel.facing)) }
      : flask
        ? { anchorX: flask.x, anchorY: flask.y, bounds: flaskBounds(flaskShapeFor(flask.facing, flask.sizeScale, flask.kind)) }
        : null;
    if (!box || gridWidth === 0 || gridHeight === 0) {
      selectBox.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    const { anchorX, anchorY, bounds } = box;
    selectBox.style.display = 'block';
    selectBox.style.left = `${canvas.offsetLeft + (anchorX + bounds.minDx) * cellPxX}px`;
    selectBox.style.top = `${canvas.offsetTop + (anchorY + bounds.minDy) * cellPxY}px`;
    selectBox.style.width = `${(bounds.maxDx - bounds.minDx + 1) * cellPxX}px`;
    selectBox.style.height = `${(bounds.maxDy - bounds.minDy + 1) * cellPxY}px`;
  }

  /** Commits one clicked corner of a polygon draw (tube or glass), snapped
   * to an octant direction from the previous corner so every segment is
   * axis- or diagonal-aligned -- see tube-shapes.ts's snapOctant. */
  function addPolyPoint(x: number, y: number): void {
    const last = polyDrawPoints[polyDrawPoints.length - 1];
    const snapped = last ? snapOctant(last, { x, y }) : { x, y };
    polyDrawPoints = [...polyDrawPoints, snapped];
    render();
  }

  function applyTool(x: number, y: number): void {
    if (!tool) return;
    switch (tool.kind) {
      case 'paint':
        send({ type: 'paint', x, y, radius: brushWidth, specId: tool.specId, tempC: brushTempC });
        break;
      case 'wall':
        if (isGlassPolygonTool(tool)) {
          addPolyPoint(x, y);
          break;
        }
        send({ type: 'paint', x, y, radius: wallBrushRadius(tool, brushWidth), specId: tool.specId, tempC: brushTempC });
        break;
      case 'radiator':
        send({ type: 'paintRadiator', x, y, brushRadius: brushWidth, radiationRadius, targetTempC });
        break;
      case 'erase':
        send({ type: 'erase', x, y, radius: brushWidth });
        break;
      case 'mixer':
        // Handled directly by the pointerdown/pointermove/pointerup
        // handlers below (stirStart/stirMove/stirEnd) rather than here, so
        // the worker can keep re-stirring the held brush every simulation
        // tick, not just once per pointer event -- see isMixing.
        break;
      case 'stirrer':
        send({ type: 'paintStirrer', x, y, radius: brushWidth });
        break;
      case 'filter':
        // Handled by the pointerdown/pointerup line-drag handlers below
        // (lineDrawStart), same as the sink -- a filter is one straight
        // one-cell-wide line, not a brush.
        break;
      case 'sink':
        // Handled directly by the pointerdown/pointermove/pointerup handlers
        // below (lineDrawStart, committed on release) rather than here -- a
        // sink is a single free-form drag from anchor to release point, not
        // a repeated per-move paint like the other brush tools.
        break;
      case 'flask':
        send({ type: 'placeFlask', x, y, facing: flaskFacing, sizeScale: flaskSizeScale, stirred: flaskStirred, kind: tool.flask });
        break;
      case 'grabber':
        break;
      case 'funnel':
        send({
          type: 'placeFunnel',
          x,
          y,
          facing: funnelFacing,
          specId: funnelDraft.specId,
          tempC: funnelDraft.tempC,
          ratePerMinute: funnelDraft.ratePerMinute,
          total: funnelDraft.totalMode === 'infinite' ? null : funnelDraft.totalAmount,
        });
        break;
      case 'tube':
        addPolyPoint(x, y);
        break;
      case 'select-apparatus':
        apparatusSelection.beginSelection(x, y);
        render();
        break;
    }
  }

  function updateInspector(x: number, y: number): void {
    if (!lastSpecId || !lastPhase || !lastTempK || !renderer) return;
    if (x < 0 || y < 0 || x >= gridWidth || y >= gridHeight) {
      inspector.classList.add('empty');
      inspectorText.textContent = 'Hover the canvas to inspect a cell';
      return;
    }
    const idx = y * gridWidth + x;
    const specId = lastSpecId[idx] as number;
    const hasRadiator = lastRadiatorRadius ? (lastRadiatorRadius[idx] as number) > 0 : false;
    const radiatorNote = hasRadiator && lastRadiatorTargetK ? ` · radiator target ${formatCelsius(kelvinToCelsius(lastRadiatorTargetK[idx] as number))}` : '';
    const port = lastSinkMask ? (lastSinkMask[idx] as SinkMaskValue) : SinkMaskValue.None;
    const sinkNote = port === SinkMaskValue.None ? '' : ` · ${port === SinkMaskValue.Vent ? VENT_LABEL : SINK_LABEL}`;
    if (specId === EMPTY) {
      inspector.classList.add('empty');
      inspectorText.textContent = `empty${radiatorNote}${sinkNote}`;
      return;
    }
    inspector.classList.remove('empty');
    const label = speciesLookup.labelOf(specId) ?? `spec ${specId}`;
    inspectorSwatch.style.background = speciesLookup.colorOf(specId) ?? '#888';
    const tempC = kelvinToCelsius(lastTempK[idx] as number);
    const phaseCode = lastPhase[idx] as number;
    const phase = PHASE_LABEL[phaseCode] ?? 'unknown';
    inspectorText.textContent = `${label} · ${tempC.toFixed(1)}°C · ${phase}${radiatorNote}${sinkNote}`;
  }

  canvas.addEventListener('pointerdown', (event) => {
    // Left button only. A right-click on a polygon draw means "finish here"
    // (see the contextmenu handler below), and the browser fires pointerdown
    // before contextmenu -- without this guard the right-click first committed
    // the corner under the cursor and *then* finished, so the segment the user
    // was aiming away from got placed anyway.
    if (event.button !== 0) return;
    isPointerDown = true;
    const { x, y } = gridCoordsFromEvent(event);
    if (tool?.kind === 'grabber') {
      isGrabbing = true;
      send({ type: 'grabStart', x, y, radius: brushWidth });
    } else if (tool?.kind === 'mixer') {
      isMixing = true;
      send({ type: 'stirStart', x, y, radius: brushWidth });
    } else if (isLineDragTool(tool)) {
      lineDrawStart = { x, y };
      updateApparatusOverlay(x, y);
    } else {
      applyTool(x, y);
    }
  });
  canvas.addEventListener('pointermove', (event) => {
    const { x, y } = gridCoordsFromEvent(event);
    lastHoverX = x;
    lastHoverY = y;
    if (isPointerDown) {
      if (isGrabbing) {
        send({ type: 'grabMove', x, y });
      } else if (isMixing) {
        send({ type: 'stirMove', x, y });
      } else if (tool?.kind === 'select-apparatus') {
        // Selecting is a single-click action (applyTool already ran once on
        // pointerdown), but if that click grabbed a funnel or a tube
        // knee/segment, dragging moves it -- see continueDrag's doc comment.
        const msg = apparatusSelection.continueDrag(x, y);
        if (msg) send(msg);
      } else if (tool?.kind !== 'funnel' && !isPolygonTool(tool) && !isLineDragTool(tool)) {
        // Single-click action (place once) rather than a brush --
        // applyTool already ran once on pointerdown, so a drag shouldn't
        // re-place on every move.
        applyTool(x, y);
      }
    }
    updateInspector(x, y);
    updateBrushOutline(event);
    updateApparatusOverlay(x, y);
  });
  canvas.addEventListener('pointerleave', () => {
    inspector.classList.add('empty');
    inspectorText.textContent = 'Hover the canvas to inspect a cell';
    brushOutline.style.display = 'none';
    apparatusPreview.style.display = 'none';
  });
  canvas.addEventListener(
    'wheel',
    (event) => {
      if (tool?.kind === 'funnel') {
        event.preventDefault();
        funnelFacing = nextFunnelFacing(funnelFacing, event.deltaY > 0 ? 1 : -1);
        updateApparatusOverlay(lastHoverX, lastHoverY);
      } else if (tool?.kind === 'flask') {
        event.preventDefault();
        flaskFacing = nextFlaskFacing(flaskFacing, event.deltaY > 0 ? 1 : -1);
        updateApparatusOverlay(lastHoverX, lastHoverY);
      } else if (tool?.kind === 'select-apparatus') {
        // A selected flask rotates on the wheel exactly like an unplaced one
        // does -- the same gesture before and after placement, rather than a
        // button that only exists in the edit panel.
        const selected = apparatusSelection.findFlask(apparatusSelection.selectedFlaskId);
        if (!selected) return;
        event.preventDefault();
        const draft = apparatusSelection.flaskEditDraft;
        const facing = nextFlaskFacing(draft?.facing ?? selected.facing, event.deltaY > 0 ? 1 : -1);
        if (draft) draft.facing = facing;
        send({
          type: 'updateFlask',
          id: selected.id,
          facing,
          sizeScale: draft?.sizeScale ?? selected.sizeScale,
          stirred: draft?.stirred ?? selected.stirred,
          kind: draft?.kind ?? selected.kind,
        });
      }
    },
    { passive: false },
  );
  // Right-click finishes the in-progress tube draw -- it commits every
  // already-clicked segment and drops the rubber-band segment still tracking
  // the cursor (which was never a click, so it was never a corner) -- rather
  // than opening the browser context menu.
  canvas.addEventListener('contextmenu', (event) => {
    if (!isPolygonTool(tool)) return;
    event.preventDefault();
    finishPolyDraw();
  });
  /** Any modal currently up. Escape closes the topmost one before it falls
   * through to the tube-draw cancel below, and the single-letter shortcuts
   * are suppressed while one is open (they'd otherwise fire underneath it). */
  function anyModalOpen(): boolean {
    return chestOpen || toolSettingsOpen || benchMenuOpen || ptOpen || settingsOverlay.style.display !== 'none';
  }

  function handleKeydown(event: KeyboardEvent): void {
    // Modals put real text inputs on screen (the chest's search box, the
    // funnel's amount field): a bare letter typed into one of those is text,
    // not a shortcut.
    const target = event.target as HTMLElement | null;
    const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');

    if (event.key === 'Escape') {
      if (benchMenuOpen || toolSettingsOpen || chestOpen || ptOpen) {
        // Innermost-first: the standalone periodic table (the funnel/tube/
        // filter species picker) opens over the side panel.
        if (ptOpen) {
          ptOpen = false;
          ptSelectedSymbol = null;
        } else if (benchMenuOpen) benchMenuOpen = false;
        else if (toolSettingsOpen) toolSettingsOpen = false;
        else {
          chestOpen = false;
          ptSelectedSymbol = null;
        }
        render();
        return;
      }
      if (settingsOverlay.style.display !== 'none') {
        toggleSettingsOverlay(false);
        return;
      }
      if (isPolygonTool(tool) && polyDrawPoints.length > 0) cancelPolyDraw();
      return;
    }

    if (typing || anyModalOpen() || event.ctrlKey || event.metaKey || event.altKey) return;

    // Now that picking a tool means opening a modal, the things you do most
    // often between picks get keys of their own -- otherwise the redesign
    // would trade screen space for clicks.
    if (event.key === 't' || event.key === 'T') {
      event.preventDefault();
      openChest();
    } else if (event.key === 'e' || event.key === 'E') {
      if (!hasToolSettings(describeToolMeta(tool))) return;
      event.preventDefault();
      toolSettingsOpen = true;
      render();
    } else if (event.key === 'm' || event.key === 'M') {
      event.preventDefault();
      benchMenuOpen = true;
      render();
    } else if (event.key === ' ') {
      event.preventDefault();
      running = !running;
      send({ type: 'setRunning', running });
      render();
    } else if (event.key === '.') {
      event.preventDefault();
      send({ type: 'step' });
    }
  }
  window.addEventListener('keydown', handleKeydown);

  function handleWindowPointerUp(): void {
    if (isGrabbing) {
      send({ type: 'grabEnd' });
      isGrabbing = false;
    }
    if (isMixing) {
      send({ type: 'stirEnd' });
      isMixing = false;
    }
    if (lineDrawStart) {
      if (tool?.kind === 'filter') {
        send({ type: 'paintFilterLine', x0: lineDrawStart.x, y0: lineDrawStart.y, x1: lastHoverX, y1: lastHoverY });
      } else {
        const width = wallBrushRadius(tool, brushWidth);
        const port = tool?.kind === 'sink' ? tool.port : SinkMaskValue.Sink;
        send({ type: 'paintSinkLine', x0: lineDrawStart.x, y0: lineDrawStart.y, x1: lastHoverX, y1: lastHoverY, width, port });
      }
      lineDrawStart = null;
      updateApparatusOverlay(lastHoverX, lastHoverY);
    }
    apparatusSelection.endDrag();
    isPointerDown = false;
  }
  window.addEventListener('pointerup', handleWindowPointerUp);

  worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
    const msg = event.data;
    if (msg.type === 'ready') {
      gridWidth = msg.width;
      gridHeight = msg.height;
      palette = msg.palette;
      speciesLookup.setPalette(msg.palette);
      renderer = createRenderer(canvas, gridWidth, gridHeight);
      for (const entry of msg.palette) renderer.setColorForSpec(entry.specId, entry.color);
      for (const wall of wallList()) renderer.setColorForSpec(wall.specId, wall.color);

      if (activeScenario) {
        loadScenarioInto(activeScenario);
      } else {
        const firstPinned = pinnedLabels.map((label) => palette.find((entry) => entry.label === label)).find((entry): entry is PaletteEntry => !!entry);
        const initial = firstPinned ?? palette[0];
        if (initial) {
          tool = { kind: 'paint', specId: initial.specId };
          funnelDraft.specId = initial.specId;
        }
        render();
      }
    } else if (msg.type === 'frame') {
      lastSpecId = msg.specId;
      lastPhase = msg.phase;
      lastTempK = msg.tempK;
      lastRadiatorRadius = msg.radiatorRadius;
      lastRadiatorTargetK = msg.radiatorTargetK;
      lastSinkMask = msg.sinkMask;
      lastSinkTotals = msg.sinkTotals;
      lastSinkGrandTotal = msg.sinkGrandTotal;
      lastVentTotals = msg.ventTotals;
      lastVentGrandTotal = msg.ventGrandTotal;
      const frameMeta = scanFrameMeta(msg.specId, msg.phase, msg.tempK);
      maybeRecordDiscoveries(frameMeta);
      maybeCheckAchievements(frameMeta, msg.objectives);
      maybeSparkleSinks(msg.sinkMask, msg.sinkTotals);
      const snapshotChanged = hasSnapshot !== msg.hasSnapshot;
      hasSnapshot = msg.hasSnapshot;
      apparatusSelection.setFunnels(msg.funnels);
      apparatusSelection.setTubes(msg.tubes);
      apparatusSelection.setFlasks(msg.flasks);
      lastTick = msg.tick;
      renderer?.drawFrame({
        specId: msg.specId,
        phase: msg.phase,
        tempK: msg.tempK,
        radiatorRadius: msg.radiatorRadius,
        radiatorTargetK: msg.radiatorTargetK,
        stirrerMask: msg.stirrerMask,
        tubeMask: msg.tubeMask,
        filterMask: msg.filterMask,
        funnelFillSpecId: msg.funnelFillSpecId,
        sinkMask: msg.sinkMask,
        catalystStrength: msg.catalystStrength,
      });
      // Restore's disabled state depends on hasSnapshot -- only rebuild the
      // bench menu when it actually flips (Save/Restore/Reset World are the
      // only things that change it), not every frame. A no-op unless that
      // menu happens to be open.
      if (snapshotChanged) renderBenchMenu();
      // The select-apparatus tool's edit panel shows a placed funnel's live
      // "Remaining" count and needs to reflect Reset immediately -- only the
      // tool-settings panel is rebuilt here, not the HUD, so a rapid
      // succession of frame ticks can't blow away a HUD control mid-click.
      //
      // Skipped while focus is inside the panel itself: a rebuild replaces
      // the DOM node under an active drag (e.g. the cone-size range input),
      // which kills the browser's native drag gesture on every tick -- a
      // slider could only ever be "clicked" (one input event, completing
      // before the next frame lands), never dragged.
      if (tool?.kind === 'select-apparatus') {
        if (!sidePanel.contains(document.activeElement)) renderSidePanel();
      } else {
        updateSelectionBox();
        // The Sink tool's tally panel shows a live running count -- same
        // "skip while a slider drag is in progress" guard as the funnel
        // edit panel above (see its comment), so a tick landing mid-drag
        // can't kill the browser's native drag gesture on the brush-width
        // slider.
        if (tool?.kind === 'sink' && !sidePanel.contains(document.activeElement)) renderSidePanel();
      }

      if (activeScenario) {
        checkForWin(msg.objectives, msg.tick);
      }
    } else if (msg.type === 'burstProgress') {
      burst = msg.ticksRemaining > 0 ? { ticksTotal: msg.ticksTotal, ticksRemaining: msg.ticksRemaining } : null;
      canvasWrap.classList.toggle('bursting', burst !== null);
      // A Run Test can win a continuous-process scenario on its own -- the
      // burst is exactly "let it run and see if it holds up" (see
      // .grill/campaign-mode.md's Phase 5), so this uses the same win check
      // real-time frames do rather than requiring the player to separately
      // notice and declare victory.
      if (activeScenario) {
        checkForWin(msg.objectives, msg.tick);
      }
    }
  };

  /** Cabinet bookkeeping (see cabinet.ts): the first time a specId shows up
   * on the grid this session, record it against `progress` if it's not
   * already known from an earlier session. `knownSpeciesIds` is purely a
   * perf guard -- once a specId has been checked once, it's never rechecked
   * against the (growing) discoveredSpeciesLabels array again. Works
   * identically in sandbox and campaign, matching the design doc's "works
   * in sandbox too" for the Cabinet. */
  function maybeRecordDiscoveries(meta: ReturnType<typeof scanFrameMeta>): void {
    let changed = false;
    for (const specId of meta.presentSpecIds) {
      if (knownSpeciesIds.has(specId) || isWallSpecId(specId)) continue;
      knownSpeciesIds.add(specId);
      const label = speciesLookup.labelOf(specId);
      if (!label || progress.discoveredSpeciesLabels.includes(label)) continue;
      progress = recordDiscovery(progress, label, activeScenario?.title ?? 'Sandbox');
      changed = true;
    }
    if (changed) saveProgress(progress);
  }

  /** Achievement checks (see achievements.ts) -- each trigger reads only
   * data a frame already carries (present species, max temperature, live
   * water count, goal progress), no new sim instrumentation. Runs every
   * frame in both modes; unlockAchievement is idempotent so re-checking an
   * already-unlocked one is just a cheap no-op array scan. */
  function maybeCheckAchievements(meta: ReturnType<typeof scanFrameMeta>, objectives: readonly GoalProgress[]): void {
    let changed = false;
    const unlock = (id: string): void => {
      const next = unlockAchievement(progress, id);
      if (next !== progress) {
        progress = next;
        changed = true;
      }
    };
    for (const specId of meta.presentSpecIds) {
      const label = speciesLookup.labelOf(specId);
      if (!label) continue;
      if (PRECIPITATE_LABELS.has(label)) unlock('first-precipitate');
      if (label === 'NH4Cl') unlock('white-smoke');
    }
    if (meta.maxTempK >= THERMAL_RUNAWAY_THRESHOLD_K) unlock('thermal-runaway-survivor');
    if (meta.liquidH2OCount >= MADE_IT_RAIN_LIQUID_H2O_COUNT) unlock('made-it-rain');
    for (const goal of objectives) {
      if (goal.kind === 'purity' && goal.currentFraction >= 0.999) unlock('zero-waste');
    }
    if (changed) saveProgress(progress);
  }

  const CHIMEABLE_GOAL_KINDS = new Set<GoalProgress['kind']>(['collect', 'collectAny', 'rate', 'purity']);
  const MILESTONES: ReadonlyArray<{ frac: number; pitch: ChimePitch }> = [
    { frac: 0.25, pitch: 'quarter' },
    { frac: 0.5, pitch: 'half' },
    { frac: 0.75, pitch: 'threeQuarter' },
    { frac: 1.0, pitch: 'full' },
  ];

  /** Milestone chimes (see .grill/campaign-mode.md's §6 point 3) -- plays
   * the highest newly-crossed 25/50/75/100% threshold per goal per frame.
   * Only for goals where "fraction" means "progress towards done"
   * ('collect'/'collectAny'/'rate'/'purity') -- a 'limit'/'maxTempK'
   * ceiling goal's fraction means "how close to failing" (see
   * objective-display.ts), which isn't something to celebrate rising. */
  function maybePlayMilestoneChimes(objectives: readonly GoalProgress[]): void {
    const display = describeObjectives(objectives, speciesLookup);
    display.forEach((obj, i) => {
      const kind = objectives[i]?.kind;
      if (!kind || !CHIMEABLE_GOAL_KINDS.has(kind)) return;
      const prevFraction = prevGoalFractions[i] ?? 0;
      for (let m = MILESTONES.length - 1; m >= 0; m--) {
        const milestone = MILESTONES[m] as (typeof MILESTONES)[number];
        if (prevFraction < milestone.frac && obj.fraction >= milestone.frac) {
          playChime(milestone.pitch, comfortSettings.quiet);
          break;
        }
      }
    });
    prevGoalFractions = display.map((obj) => obj.fraction);
  }

  /** Sink sparkle (see .grill/campaign-mode.md's §6 point 2) -- diffs this
   * frame's sinkTotals against the last one; any species whose count grew
   * gets a handful of dots flashed along the sink line, tinted with that
   * species' own color, then faded out by a CSS animation (see
   * style.css's .sink-sparkle.flash). A no-op under Reduce Motion. */
  function maybeSparkleSinks(sinkMask: Uint8Array, sinkTotals: Uint32Array): void {
    const prev = prevSinkTotals;
    prevSinkTotals = sinkTotals;
    if (comfortSettings.reduceMotion || !prev || gridWidth === 0 || gridHeight === 0) return;

    const deltas: Array<{ specId: number; count: number }> = [];
    for (let specId = 0; specId < sinkTotals.length; specId++) {
      const delta = (sinkTotals[specId] ?? 0) - (prev[specId] ?? 0);
      if (delta > 0) deltas.push({ specId, count: delta });
    }
    if (deltas.length === 0) return;

    const cells: Point[] = [];
    for (let y = 0; y < gridHeight; y++) {
      for (let x = 0; x < gridWidth; x++) {
        if (sinkMask[y * gridWidth + x]) cells.push({ x, y });
      }
    }
    if (cells.length === 0) return;

    const rect = canvas.getBoundingClientRect();
    const width = Math.round(rect.width);
    const height = Math.round(rect.height);
    if (sinkSparkle.width !== width || sinkSparkle.height !== height) {
      sinkSparkle.width = width;
      sinkSparkle.height = height;
      sparkleCtx = sinkSparkle.getContext('2d');
    }
    if (!sparkleCtx) return;
    sinkSparkle.style.left = `${canvas.offsetLeft}px`;
    sinkSparkle.style.top = `${canvas.offsetTop}px`;
    sinkSparkle.style.width = `${width}px`;
    sinkSparkle.style.height = `${height}px`;
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    sparkleCtx.clearRect(0, 0, sinkSparkle.width, sinkSparkle.height);

    const totalDelta = deltas.reduce((sum, d) => sum + d.count, 0);
    const DOTS_PER_SPARKLE = 24;
    for (const { specId, count } of deltas) {
      sparkleCtx.fillStyle = speciesLookup.colorOf(specId) ?? '#ffffff';
      const dots = Math.max(1, Math.round((count / totalDelta) * DOTS_PER_SPARKLE));
      const r = Math.max(cellPxX, cellPxY) * 0.9;
      for (let i = 0; i < dots; i++) {
        const cell = cells[Math.floor(Math.random() * cells.length)] as Point;
        sparkleCtx.beginPath();
        sparkleCtx.arc(cell.x * cellPxX + cellPxX / 2, cell.y * cellPxY + cellPxY / 2, r, 0, Math.PI * 2);
        sparkleCtx.fill();
      }
    }

    // Remove+reflow+add re-triggers the CSS fade-out animation even if a
    // previous sparkle is still fading -- otherwise re-adding a class
    // that's already present is a no-op and the animation wouldn't restart.
    sinkSparkle.classList.remove('flash');
    void sinkSparkle.offsetWidth;
    sinkSparkle.classList.add('flash');
  }

  /** Shared by the 'frame' and 'burstProgress' handlers: scores the active
   * scenario's live objectives and, the first time every goal is met, locks
   * in the win (stars/elapsed time from `tickNum`, persisted) and shows the
   * win overlay. Both real-time play and a Run Test burst can trigger this
   * -- see worker.ts's 'burstProgress' doc comment. */
  function checkForWin(objectives: GoalProgress[], tickNum: number): void {
    if (!activeScenario) return;
    lastObjectives = objectives;
    if (briefingAcknowledged) maybePlayMilestoneChimes(objectives);
    // Gated on briefingAcknowledged too, not just isScenarioWon's own
    // empty-array guard -- no reason to score a scenario the player hasn't
    // even started yet, and it keeps this check from ever racing the
    // worker's own 'loadScenario' handling on the very first frame.
    if (briefingAcknowledged && !scenarioWon && isScenarioWon(objectives)) {
      scenarioWon = true;
      winElapsedSeconds = tickNum / TICKS_PER_SECOND;
      winStars = starsForCompletion(activeScenario.par?.seconds, winElapsedSeconds);
      // Folds onto the shared in-memory `progress` (not a fresh loadProgress()
      // call) so it can't clobber a discovery/achievement this same tick's
      // maybeRecordDiscoveries/maybeCheckAchievements already wrote -- both
      // write through the same variable and saveProgress call.
      progress = recordCompletion(progress, activeScenario.id, winStars, winElapsedSeconds);
      saveProgress(progress);
      playChime('win', comfortSettings.quiet);
      renderCampaignOverlay();
    }
    renderCampaignHud();
  }

  // Dev-only debug hook (see debug-hook.ts) -- not part of the app's real
  // API, never imported by app code, purely a debugging aid.
  installDebugHook({
    send,
    render,
    getState: () => ({
      running,
      speed,
      tick: lastTick,
      gridWidth,
      gridHeight,
      specId: lastSpecId,
      phase: lastPhase,
      tempK: lastTempK,
      radiatorRadius: lastRadiatorRadius,
      radiatorTargetK: lastRadiatorTargetK,
      brushTempC,
      palette,
    }),
    setRunning: (value) => {
      running = value;
    },
    setSpeed: (value) => {
      speed = value;
    },
    labelOf: (specId) => speciesLookup.labelOf(specId),
  });

  return function unmount(): void {
    worker.terminate();
    resizeObserver.disconnect();
    window.removeEventListener('resize', fitCanvasWrap);
    window.removeEventListener('keydown', handleKeydown);
    window.removeEventListener('pointerup', handleWindowPointerUp);
  };
}
