// M4+ UI: the full v1 tool set (paint, erase, wall materials, heater/cooler
// radiators, probe, mixer, grabber) plus time controls (pause, single-step,
// speed multiplier), a pinned-species quick row backed by a full
// periodic-table modal, and a hover inspector -- all plain DOM per the
// design doc's "src/ui plain DOM/React panels", no framework. Visual layout
// follows the "Pixistry UI Refresh" design (see toolbar.ts, side-panel.ts,
// periodic-table.ts for the three panel builders this module wires
// together).
import { createRenderer, type Renderer } from '../render/renderer';
import { AMBIENT_TEMPERATURE_K, kelvinToCelsius } from '../sim/heat';
import type { GoalProgress } from '../sim/objectives';
import type { MainToWorkerMessage, WorkerToMainMessage } from '../sim/protocol';
import { isPaintAllowed, isToolAllowed } from '../sim/scenario';
import { SCENARIOS, type Restrictions, type Scenario, type ToolKind as SimToolKind } from '../sim/scenario-data';
import type { PaletteEntry } from '../sim/species';
import { EMPTY, PhaseCode } from '../sim/grid';
import { BORDER_RANGE_K } from '../render/renderer';
import { getWall, isWallSpecId, wallList } from '../sim/walls';
import { RADIATOR_COLOR, RADIATOR_LABEL } from '../sim/radiators';
import { FUNNEL_COLOR, FUNNEL_LABEL } from '../sim/funnel';
import { STIRRER_COLOR, STIRRER_LABEL } from '../sim/stirrer';
import { DEFAULT_TUBE_CONE_SIZE, TUBE_COLOR, TUBE_LABEL } from '../sim/tube';
import { FILTER_COLOR, FILTER_LABEL } from '../sim/filter-apparatus';
import { SINK_COLOR, SINK_LABEL, sinkLineCells } from '../sim/sink';
import { funnelBounds, funnelShapeFor, nextFunnelFacing, type FunnelFacing } from '../sim/apparatus-shapes';
import { DEFAULT_FLASK_SIZE_SCALE, flaskShapeFor, nextFlaskFacing, type FlaskFacing } from '../sim/flask-shapes';
import { lumenWallCells, polylineToLumenPath, snapOctant, type Point } from '../sim/tube-shapes';
import { buildToolbar, SELECT_APPARATUS_COLOR, SELECT_APPARATUS_LABEL, type ToolbarCallbacks, type ToolKind as UiToolKind } from './toolbar';
import { buildSidePanel, type FunnelFieldValues, type SidePanelCallbacks, type SinkTallyEntry, type ToolMeta, type TubeFieldValues } from './side-panel';
import { buildPeriodicTable, type PeriodicTableCallbacks } from './periodic-table';
import { ApparatusSelection, type FunnelEditDraft, type TubeEditDraft } from './apparatus-selection';
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
  | { kind: 'sink' }
  | { kind: 'flask'; stirred: boolean }
  | { kind: 'select-apparatus' };

/** Wall-drawing tools (Glass/Insulator, and Filter -- also drawn as a
 * precise line) want the brush-width slider's minimum (1) to paint exactly
 * one pixel, for drawing precise vessel walls -- forEachCellInRadius's
 * radius is one less than the displayed width for these tools only.
 * Species/erase/radiator/stirrer keep radius === width unchanged, since a
 * wider default splash is what those actually want. */
function wallBrushRadius(tool: Tool | null, width: number): number {
  return tool?.kind === 'wall' || tool?.kind === 'filter' || tool?.kind === 'sink' ? Math.max(0, width - 1) : width;
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
    case 'flask-erlenmeyer-stirred':
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
  sinkPanel: 'none',
};

/** The three tools with no per-instance config of their own -- just a
 * label/swatch, everything else the same as TOOL_META_DEFAULTS. */
const SIMPLE_TOOL_META: Record<'erase' | 'mixer' | 'grabber', { label: string; color: string }> = {
  erase: { label: 'Erase', color: '#8a8a8a' },
  mixer: { label: 'Mix', color: '#c9a8ff' },
  grabber: { label: 'Grab', color: '#f2d94e' },
};

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

  const header = document.createElement('div');
  header.className = 'app-header';
  const titleEl = document.createElement('div');
  titleEl.className = 'app-title';
  titleEl.textContent = 'PIXISTRY';
  const subtitleEl = document.createElement('div');
  subtitleEl.className = 'app-subtitle';
  subtitleEl.textContent = 'falling-sand chemistry sandbox';
  header.appendChild(titleEl);
  header.appendChild(subtitleEl);
  if (options.mode === 'campaign') {
    const modeBadge = document.createElement('span');
    modeBadge.className = 'mode-badge';
    modeBadge.textContent = 'CAMPAIGN';
    header.appendChild(modeBadge);
  }
  const settingsButton = document.createElement('button');
  settingsButton.className = 'menu-exit-btn settings-btn';
  settingsButton.textContent = '⚙';
  settingsButton.title = 'Comfort settings';
  settingsButton.onclick = () => toggleSettingsOverlay(true);
  header.appendChild(settingsButton);
  if (options.onExitToMenu) {
    const menuButton = document.createElement('button');
    menuButton.className = 'menu-exit-btn';
    menuButton.textContent = '← Menu';
    menuButton.title = 'Back to the title screen';
    menuButton.onclick = () => {
      if (!window.confirm('Leave and return to the menu? This will lose anything not saved.')) return;
      options.onExitToMenu?.();
    };
    header.appendChild(menuButton);
  }
  root.appendChild(header);

  const settingsOverlay = document.createElement('div');
  settingsOverlay.className = 'pt-overlay';
  settingsOverlay.style.display = 'none';
  root.appendChild(settingsOverlay);

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

  const toolbar = document.createElement('div');
  toolbar.className = 'toolbar';
  root.appendChild(toolbar);

  const workspace = document.createElement('div');
  workspace.className = 'workspace';
  root.appendChild(workspace);

  const canvasCol = document.createElement('div');
  canvasCol.className = 'canvas-col';
  workspace.appendChild(canvasCol);

  // Campaign objective HUD -- above the canvas (see design doc's "progress
  // bar filled with the product's own color... this is the game"), empty
  // and hidden in sandbox mode and before the briefing's Start is clicked.
  const campaignHud = document.createElement('div');
  campaignHud.className = 'campaign-hud';
  campaignHud.style.display = 'none';
  canvasCol.appendChild(campaignHud);

  const canvasWrap = document.createElement('div');
  canvasWrap.className = 'canvas-wrap';
  canvasCol.appendChild(canvasWrap);

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

  const legend = document.createElement('div');
  legend.className = 'legend';
  const hotK = AMBIENT_TEMPERATURE_K + BORDER_RANGE_K;
  const coldK = AMBIENT_TEMPERATURE_K - BORDER_RANGE_K;
  legend.innerHTML = `
    <div class="legend-item"><span class="legend-swatch normal"></span><span class="legend-label">NORMAL</span></div>
    <div class="legend-item"><span class="legend-swatch hot"></span><span class="legend-label">HOT &middot; &gt;${formatCelsius(kelvinToCelsius(hotK))}</span></div>
    <div class="legend-item"><span class="legend-swatch cold"></span><span class="legend-label">COLD &middot; &lt;${formatCelsius(kelvinToCelsius(coldK))}</span></div>
  `;
  canvasCol.appendChild(legend);

  // canvasWrap always fills all the space canvas-col has left after the
  // toolbar/legend/side-panel take their share, so it never leaves dead
  // space next to the side panel. The actual sim canvas inside it is sized
  // to the largest box that preserves the grid's aspect ratio and fits
  // within canvasWrap, then centered -- letterboxing (if any, when the
  // available box is short and wide) lands above/below the canvas rather
  // than as padding around the whole wrap. Re-run whenever canvas-col's box
  // changes; plain CSS aspect-ratio auto-sizing doesn't reliably shrink a
  // block to fit *both* axes at once (it'll happily overflow one dimension
  // while respecting the other), so this is done in JS instead.
  const fitCanvasWrap = (): void => {
    const availW = Math.floor(canvasCol.clientWidth);
    // The campaign HUD (see canvasCol's first child) sits above the canvas
    // and, unlike the legend below it, only takes up space some of the time
    // -- its rendered height has to come out of the same budget or the
    // canvas would overflow canvas-col whenever it's showing.
    const hudH = campaignHud.style.display === 'none' ? 0 : Math.ceil(campaignHud.getBoundingClientRect().height) + 12;
    const legendH = Math.ceil(legend.getBoundingClientRect().height);
    const availH = Math.floor(canvasCol.clientHeight - legendH - 12 - hudH); // 12 = legend's margin-top
    if (availW <= 0 || availH <= 0) return;
    // canvasWrap/canvas are children of the ResizeObserver's own target
    // (canvasCol), so writing new sizes here re-triggers that same
    // observer -- canvas-wrap's box-sizing:border-box (see style.css) is
    // what makes that converge instead of amplifying forever. This guard
    // just avoids the redundant write (and the observer wakeup it'd cause)
    // once a call has already reached that fixed point.
    const widthPx = `${availW}px`;
    const heightPx = `${availH}px`;
    if (canvasWrap.style.width === widthPx && canvasWrap.style.height === heightPx) return;
    canvasWrap.style.width = widthPx;
    canvasWrap.style.height = heightPx;
    const ratio = gridWidth > 0 && gridHeight > 0 ? gridWidth / gridHeight : 1.6;
    const width = Math.floor(Math.min(availW, availH * ratio));
    const height = Math.floor(width / ratio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    updateApparatusOverlay(lastHoverX, lastHoverY);
    updateSelectionBox();
  };
  const resizeObserver = new ResizeObserver(fitCanvasWrap);
  resizeObserver.observe(canvasCol);
  window.addEventListener('resize', fitCanvasWrap);

  const sidePanel = document.createElement('div');
  sidePanel.className = 'side-panel';
  workspace.appendChild(sidePanel);

  const ptOverlay = document.createElement('div');
  ptOverlay.className = 'pt-overlay';
  ptOverlay.style.display = 'none';
  root.appendChild(ptOverlay);

  // Campaign briefing/win modal -- same fixed backdrop as ptOverlay (see
  // .campaign-overlay in style.css), shown full-screen over an otherwise
  // inert bench until Start is clicked, and again once the goals are met.
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

  // In-progress polygon draw (tool === 'tube'): points already committed by
  // a click, plus a live rubber-band preview point tracking the cursor
  // (snapped from the last committed point -- see updateTubeDrawPreview).
  // Cleared back to [] on right-click/Escape (see finishOrCancelTubeDraw).
  let tubeDrawPoints: Point[] = [];
  let tubeDrawPreview: Point | null = null;

  // In-progress sink line draw (tool === 'sink'): set on pointerdown, held
  // through the drag, and committed as one paintSinkLine message on
  // pointerup -- see the window pointerup handler below. Unlike every brush
  // tool, a sink is a single free-form drag from anchor to release point,
  // not a repeated per-move paint.
  let sinkDrawStart: Point | null = null;

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
      return { ...TOOL_META_DEFAULTS, label: FILTER_LABEL, color: FILTER_COLOR, category: 'APPARATUS', filterPanel: 'config' };
    }
    if (t.kind === 'sink') {
      return { ...TOOL_META_DEFAULTS, label: SINK_LABEL, color: SINK_COLOR, category: 'APPARATUS', sinkPanel: 'config' };
    }
    if (t.kind === 'flask') {
      return {
        ...TOOL_META_DEFAULTS,
        label: t.stirred ? 'Erlenmeyer (stirred)' : 'Erlenmeyer',
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
      const selectedTube = selectedFunnel ? undefined : apparatusSelection.findTube(apparatusSelection.selectedTubeId);
      const nothingSelected = !selectedFunnel && !selectedTube;
      return {
        ...TOOL_META_DEFAULTS,
        label: selectedFunnel ? FUNNEL_LABEL : selectedTube ? TUBE_LABEL : SELECT_APPARATUS_LABEL,
        color: selectedFunnel ? FUNNEL_COLOR : selectedTube ? TUBE_COLOR : SELECT_APPARATUS_COLOR,
        category: nothingSelected ? 'TOOL' : 'APPARATUS',
        showBrushWidth: false,
        funnelPanel: selectedFunnel ? 'edit' : nothingSelected ? 'edit-empty' : 'none',
        tubePanel: selectedTube ? 'edit' : 'none',
      };
    }
    const info = SIMPLE_TOOL_META[t.kind];
    return { ...TOOL_META_DEFAULTS, label: info.label, color: info.color, category: 'TOOL' };
  }

  function setTool(next: Tool): void {
    // Switching away from the tube tool mid-draw discards whatever's been
    // clicked so far rather than leaving it to silently reappear (still
    // held in tubeDrawPoints) if the player switches back later.
    if (tool?.kind === 'tube' && next.kind !== 'tube' && tubeDrawPoints.length > 0) {
      tubeDrawPoints = [];
      tubeDrawPreview = null;
    }
    // Same discard-on-switch convention as the tube draw above: an
    // in-progress sink drag shouldn't silently resume/commit if the player
    // switches tools mid-drag.
    if (tool?.kind === 'sink' && next.kind !== 'sink') {
      sinkDrawStart = null;
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
  function sinkTallyEntries(): SinkTallyEntry[] {
    if (!lastSinkTotals) return [];
    const entries: SinkTallyEntry[] = [];
    for (let specId = 0; specId < lastSinkTotals.length; specId++) {
      const count = lastSinkTotals[specId] as number;
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
    renderToolbar();
    renderSidePanel();
    fitCanvasWrap();
  }

  function renderToolbar(): void {
    const toolbarCallbacks: ToolbarCallbacks = {
      isPaintActive: (specId) => tool?.kind === 'paint' && tool.specId === specId,
      isWallActive: (specId) => tool?.kind === 'wall' && tool.specId === specId,
      isToolActive: (kind) => {
        if (kind === 'flask-erlenmeyer') return tool?.kind === 'flask' && !tool.stirred;
        if (kind === 'flask-erlenmeyer-stirred') return tool?.kind === 'flask' && tool.stirred;
        return tool?.kind === kind;
      },
      isPinned: (label) => pinnedLabels.includes(label),
      onSelectPaint: (specId) => setTool({ kind: 'paint', specId }),
      onSelectWall: (specId) => setTool({ kind: 'wall', specId }),
      onSelectTool: (kind) => {
        if (kind === 'flask-erlenmeyer') setTool({ kind: 'flask', stirred: false });
        else if (kind === 'flask-erlenmeyer-stirred') setTool({ kind: 'flask', stirred: true });
        else setTool({ kind });
      },
      onTogglePin: togglePin,
      onOpenPeriodicTable: () => {
        ptTarget = 'paint';
        ptOpen = true;
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
      hasSnapshot,
      onResetWorld: () => {
        // In campaign mode, "Clear All" means "start this experiment over"
        // -- a bare resetWorld would wipe the worker's activeScenario too
        // (see worker.ts's 'resetWorld' handler), leaving this module still
        // thinking a scenario is active while the worker no longer
        // restricts anything.
        if (activeScenario) {
          if (!window.confirm('Reset this experiment back to the start?')) return;
          loadScenarioInto(activeScenario);
          return;
        }
        if (!window.confirm('Clear the whole grid? This cannot be undone unless you Save first.')) return;
        send({ type: 'resetWorld' });
      },
      onSnapshotWorld: () => send({ type: 'snapshotWorld' }),
      onRestoreWorld: () => send({ type: 'restoreWorld' }),
      pinnable: !restrictions,
      periodicTableLocked: !!restrictions && restrictions.paintSpecies !== 'all',
      resetWorldLabel: activeScenario ? 'Reset Experiment' : 'Clear All',
    };
    if (restrictions) {
      const activeRestrictions = restrictions;
      toolbarCallbacks.isWallLocked = (specId) => !isPaintAllowed(activeRestrictions, specId);
      toolbarCallbacks.isToolLocked = (kind) => {
        const simKind = toSimToolKind(kind);
        return simKind === null ? false : !isToolAllowed(activeRestrictions, simKind);
      };
    }
    buildToolbar(toolbar, palette, wallList(), effectivePinnedLabels(), toolbarCallbacks);
  }

  function renderSidePanel(): void {
    const meta = describeToolMeta(tool);
    const isEditMode = tool?.kind === 'select-apparatus';
    const selectedFunnel = isEditMode ? apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId) : undefined;
    const selectedTube = isEditMode && !selectedFunnel ? apparatusSelection.findTube(apparatusSelection.selectedTubeId) : undefined;
    // The select-apparatus tool's own selection can go stale (the selected
    // funnel/tube got erased) -- drop it rather than keep pointing an edit
    // panel at nothing.
    if (isEditMode && apparatusSelection.selectedFunnelId !== null && !selectedFunnel) apparatusSelection.selectFunnel(null);
    if (isEditMode && apparatusSelection.selectedTubeId !== null && !selectedTube) apparatusSelection.selectTube(null);
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
    const isTubeEditMode = isEditMode && !!selectedTube;
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
      flaskSizeScale,
      onSetFlaskSize: (value) => {
        flaskSizeScale = value;
      },
      sinkTally: sinkTallyEntries(),
      sinkGrandTotal: lastSinkGrandTotal,
      onResetSinkCounts: () => send({ type: 'resetSinkCounts' }),
    };
    buildSidePanel(sidePanel, meta, sidePanelCallbacks);

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
        onClose: () => {
          ptOpen = false;
          ptSelectedSymbol = null;
          render();
        },
      };
      buildPeriodicTable(ptOverlay, palette, ptCallbacks);
    } else {
      ptOverlay.style.display = 'none';
      ptOverlay.innerHTML = '';
    }

    updateSelectionBox();
    updateApparatusOverlay(lastHoverX, lastHoverY);
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
    const showTubeDraw = tool?.kind === 'tube' && tubeDrawPoints.length > 0;
    const showSinkDraw = tool?.kind === 'sink' && sinkDrawStart !== null;
    const editingTube = tool?.kind === 'select-apparatus' ? apparatusSelection.findTube(apparatusSelection.selectedTubeId) : undefined;
    if ((!showFunnelGhost && !showFlaskGhost && !showTubeDraw && !showSinkDraw && !editingTube) || gridWidth === 0 || gridHeight === 0) {
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
      const shape = flaskShapeFor(flaskFacing, flaskSizeScale);
      for (const cell of shape.cells) {
        const px = x + cell.dx;
        const py = y + cell.dy;
        previewCtx.fillRect(px * cellPxX, py * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
      }
    }

    if (showTubeDraw) {
      const last = tubeDrawPoints[tubeDrawPoints.length - 1] as Point;
      tubeDrawPreview = snapOctant(last, { x, y });
      drawTubeGhost(previewCtx, [...tubeDrawPoints, tubeDrawPreview], cellPxX, cellPxY, true);
    }

    if (editingTube) {
      drawTubeGhost(previewCtx, editingTube.points, cellPxX, cellPxY, false);
    }

    if (showSinkDraw && sinkDrawStart) {
      const width = wallBrushRadius(tool, brushWidth);
      previewCtx.fillStyle = 'rgba(224, 72, 158, 0.5)';
      for (const cell of sinkLineCells(sinkDrawStart.x, sinkDrawStart.y, x, y, width)) {
        previewCtx.fillRect(cell.x * cellPxX, cell.y * cellPxY, cellPxX + 0.5, cellPxY + 0.5);
      }
    }
  }

  /** Commits the in-progress tube draw (right-click): places a new tube if
   * at least one full segment was drawn, or silently discards a lone mouth
   * click with nothing to commit yet. */
  function finishTubeDraw(): void {
    if (tubeDrawPoints.length >= 2) {
      send({ type: 'placeTube', points: tubeDrawPoints, coneSize: tubeDraft.coneSize, filter: tubeDraft.filter ? [...tubeDraft.filter] : null });
    }
    cancelTubeDraw();
  }

  /** Discards the in-progress tube draw entirely (Escape) -- unlike
   * right-click, never places anything even if segments were already
   * committed. */
  function cancelTubeDraw(): void {
    tubeDrawPoints = [];
    tubeDrawPreview = null;
    render();
    updateApparatusOverlay(lastHoverX, lastHoverY);
  }

  /** Positions the select-apparatus tool's corner-bracket overlay over the
   * selected funnel's bounding box, or hides it. */
  function updateSelectionBox(): void {
    const selected = tool?.kind === 'select-apparatus' ? apparatusSelection.findFunnel(apparatusSelection.selectedFunnelId) : undefined;
    if (!selected || gridWidth === 0 || gridHeight === 0) {
      selectBox.style.display = 'none';
      return;
    }
    const rect = canvas.getBoundingClientRect();
    const cellPxX = rect.width / gridWidth;
    const cellPxY = rect.height / gridHeight;
    const bounds = funnelBounds(funnelShapeFor(selected.facing));
    selectBox.style.display = 'block';
    selectBox.style.left = `${canvas.offsetLeft + (selected.anchorX + bounds.minDx) * cellPxX}px`;
    selectBox.style.top = `${canvas.offsetTop + (selected.anchorY + bounds.minDy) * cellPxY}px`;
    selectBox.style.width = `${(bounds.maxDx - bounds.minDx + 1) * cellPxX}px`;
    selectBox.style.height = `${(bounds.maxDy - bounds.minDy + 1) * cellPxY}px`;
  }

  function applyTool(x: number, y: number): void {
    if (!tool) return;
    switch (tool.kind) {
      case 'paint':
        send({ type: 'paint', x, y, radius: brushWidth, specId: tool.specId, tempC: brushTempC });
        break;
      case 'wall':
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
        send({ type: 'paintFilter', x, y, radius: wallBrushRadius(tool, brushWidth) });
        break;
      case 'sink':
        // Handled directly by the pointerdown/pointermove/pointerup handlers
        // below (sinkDrawStart, committed on release) rather than here -- a
        // sink is a single free-form drag from anchor to release point, not
        // a repeated per-move paint like the other brush tools.
        break;
      case 'flask':
        send({ type: 'placeFlask', x, y, facing: flaskFacing, sizeScale: flaskSizeScale, stirred: tool.stirred });
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
      case 'tube': {
        const last = tubeDrawPoints[tubeDrawPoints.length - 1];
        const snapped = last ? snapOctant(last, { x, y }) : { x, y };
        tubeDrawPoints = [...tubeDrawPoints, snapped];
        render();
        break;
      }
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
    const sinkNote = lastSinkMask && (lastSinkMask[idx] as number) > 0 ? ` · ${SINK_LABEL}` : '';
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
    isPointerDown = true;
    const { x, y } = gridCoordsFromEvent(event);
    if (tool?.kind === 'grabber') {
      isGrabbing = true;
      send({ type: 'grabStart', x, y, radius: brushWidth });
    } else if (tool?.kind === 'mixer') {
      isMixing = true;
      send({ type: 'stirStart', x, y, radius: brushWidth });
    } else if (tool?.kind === 'sink') {
      sinkDrawStart = { x, y };
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
      } else if (tool?.kind !== 'funnel' && tool?.kind !== 'tube' && tool?.kind !== 'sink') {
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
      }
    },
    { passive: false },
  );
  // Right-click finishes the in-progress tube draw (commits every already-
  // clicked segment) rather than opening the browser context menu.
  canvas.addEventListener('contextmenu', (event) => {
    if (tool?.kind !== 'tube') return;
    event.preventDefault();
    finishTubeDraw();
  });
  function handleKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && tool?.kind === 'tube' && tubeDrawPoints.length > 0) {
      cancelTubeDraw();
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
    if (sinkDrawStart) {
      const width = wallBrushRadius(tool, brushWidth);
      send({ type: 'paintSinkLine', x0: sinkDrawStart.x, y0: sinkDrawStart.y, x1: lastHoverX, y1: lastHoverY, width });
      sinkDrawStart = null;
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
      const frameMeta = scanFrameMeta(msg.specId, msg.phase, msg.tempK);
      maybeRecordDiscoveries(frameMeta);
      maybeCheckAchievements(frameMeta, msg.objectives);
      maybeSparkleSinks(msg.sinkMask, msg.sinkTotals);
      const snapshotChanged = hasSnapshot !== msg.hasSnapshot;
      hasSnapshot = msg.hasSnapshot;
      apparatusSelection.setFunnels(msg.funnels);
      apparatusSelection.setTubes(msg.tubes);
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
      });
      // The Restore button's disabled state depends on hasSnapshot -- only
      // rebuild the toolbar when it actually flips (Save/Restore/Reset
      // World are the only things that change it), not every frame.
      if (snapshotChanged) renderToolbar();
      // The select-apparatus tool's edit panel shows a placed funnel's live
      // "Remaining" count and needs to reflect Reset immediately -- only the
      // side panel is rebuilt here, not the toolbar, so a rapid succession of
      // frame ticks can't blow away a toolbar button mid-click.
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
