// The floating HUD: one translucent strip along the top of the bench,
// carrying identity, the active-tool readout, and the transport controls
// (pause/step/speed) plus the bench menu.
//
// There was a second strip along the bottom holding brush width, brush
// temperature and the temperature legend. All three moved into the settings
// dock (side-panel.ts) once that became permanent furniture: the dock has
// vertical room to spare, the sliders belong next to the rest of the active
// tool's settings rather than in a different corner of the screen, and the
// bottom of the bench is now free canvas.
//
// Per-tool configuration is the one thing that isn't behind a modal: it lives
// in the settings dock on the right edge of the bench (side-panel.ts, mounted
// by app.ts), permanently visible for whichever tool is active. Everything
// else -- picking a tool (tool-rail.ts's left rail, and tool-chest.ts for
// species), the periodic table, comfort settings, save/restore/clear -- is a
// modal, so no pixel of bench is spent on a control the player isn't using
// right now.
import { el } from './dom';

const SPEEDS = [0.25, 0.5, 1, 2, 4];

export interface HudCallbacks {
  /** Active tool -- label/swatch come straight from side-panel.ts's ToolMeta,
   * so the readout, the rail's highlighted slot and the settings dock all
   * agree. */
  toolLabel: string;
  toolColor: string;
  toolCategory: string;
  running: boolean;
  speed: number;
  onTogglePause(): void;
  onStep(): void;
  onSetSpeed(speed: number): void;

  onOpenBenchMenu(): void;

  campaign: boolean;
}

export function buildHud(top: HTMLElement, cb: HudCallbacks): void {
  top.innerHTML = '';

  const left = el('div', 'hud-cluster');

  const mark = el('div', 'hud-mark');
  mark.textContent = 'PIXISTRY';
  left.appendChild(mark);
  if (cb.campaign) {
    const badge = el('span', 'mode-badge');
    badge.textContent = 'CAMPAIGN';
    left.appendChild(badge);
  }

  // A readout, not a button: picking a tool is the rail's job now (see
  // tool-rail.ts, which highlights the active slot). This says *what* is
  // selected in words, which fifteen icons on their own can't.
  const chip = el('div', 'hud-active-tool');
  const swatch = el('span', 'hud-active-swatch');
  swatch.style.background = cb.toolColor || '#3a3d3a';
  const chipText = el('span', 'hud-active-text');
  const chipLabel = el('span', 'hud-active-label');
  chipLabel.textContent = cb.toolLabel;
  chipText.appendChild(chipLabel);
  if (cb.toolCategory) {
    const chipCategory = el('span', 'hud-active-category');
    chipCategory.textContent = cb.toolCategory;
    chipText.appendChild(chipCategory);
  }
  chip.appendChild(swatch);
  chip.appendChild(chipText);
  left.appendChild(chip);
  top.appendChild(left);

  const right = el('div', 'hud-cluster');

  const pauseButton = el('button', 'hud-btn pause-btn');
  pauseButton.classList.toggle('active', !cb.running);
  pauseButton.textContent = cb.running ? '⏸' : '▶';
  pauseButton.title = cb.running ? 'Pause (Space)' : 'Resume (Space)';
  pauseButton.onclick = cb.onTogglePause;
  right.appendChild(pauseButton);

  const stepButton = el('button', 'hud-btn');
  stepButton.textContent = '⏭';
  stepButton.title = 'Step one tick (.)';
  stepButton.onclick = cb.onStep;
  right.appendChild(stepButton);

  const speedSelect = el('select', 'speed-select hud-select');
  speedSelect.title = 'Simulation speed';
  for (const s of SPEEDS) {
    const option = el('option');
    option.value = String(s);
    option.textContent = `${s}x`;
    if (s === cb.speed) option.selected = true;
    speedSelect.appendChild(option);
  }
  speedSelect.onchange = () => cb.onSetSpeed(Number(speedSelect.value));
  right.appendChild(speedSelect);

  right.appendChild(el('span', 'hud-sep'));

  const benchButton = el('button', 'hud-btn');
  benchButton.textContent = '⋯';
  benchButton.title = 'Bench menu -- save, restore, clear, settings (M)';
  benchButton.onclick = cb.onOpenBenchMenu;
  right.appendChild(benchButton);

  top.appendChild(right);
}

export interface BenchMenuCallbacks {
  hasSnapshot: boolean;
  /** Apparatus undo/redo (see protocol.ts's 'undoEntities'). Separate from
   * Save/Restore below, and labelled so: this rewinds the *bench*, never the
   * chemistry, so an accidental nudge costs nothing while a minute of
   * reaction keeps running. */
  canUndoEntities: boolean;
  canRedoEntities: boolean;
  onUndoEntities(): void;
  onRedoEntities(): void;
  onSnapshotWorld(): void;
  onRestoreWorld(): void;
  resetWorldLabel: string;
  onResetWorld(): void;
  onOpenComfortSettings(): void;
  onExitToMenu?(): void;
  onClose(): void;
}

/** The ⋯ menu: the session-level actions that used to sit in the toolbar's
 * SIMULATION row. All of them are either rare (save/restore/clear) or leave
 * the bench entirely (settings/menu), so none of them earn permanent space. */
export function buildBenchMenu(container: HTMLElement, cb: BenchMenuCallbacks): void {
  container.innerHTML = '';

  const modal = el('div', 'pt-modal bench-menu-modal');
  container.appendChild(modal);

  const header = el('div', 'pt-modal-header');
  const title = el('div', 'pt-modal-title');
  title.textContent = 'Bench';
  header.appendChild(title);
  const closeButton = el('button', 'pt-close-btn');
  closeButton.textContent = '✕';
  closeButton.title = 'Close (Esc, or click outside)';
  closeButton.onclick = cb.onClose;
  header.appendChild(closeButton);
  modal.appendChild(header);

  const list = el('div', 'bench-menu-list');
  const add = (label: string, hint: string, onClick: () => void, opts: { disabled?: boolean; danger?: boolean } = {}): void => {
    const row = el('button', 'bench-menu-item');
    if (opts.danger) row.classList.add('danger');
    row.disabled = !!opts.disabled;
    const rowLabel = el('span', 'bench-menu-label');
    rowLabel.textContent = label;
    const rowHint = el('span', 'bench-menu-hint');
    rowHint.textContent = hint;
    row.appendChild(rowLabel);
    row.appendChild(rowHint);
    row.onclick = () => {
      onClick();
      cb.onClose();
    };
    list.appendChild(row);
  };

  add('Undo apparatus', cb.canUndoEntities ? 'Step the bench back -- matter keeps running (Ctrl+Z)' : 'Nothing to undo yet', cb.onUndoEntities, {
    disabled: !cb.canUndoEntities,
  });
  add('Redo apparatus', cb.canRedoEntities ? 'Step the bench forward again (Ctrl+Shift+Z)' : 'Nothing to redo', cb.onRedoEntities, {
    disabled: !cb.canRedoEntities,
  });
  add('Save', 'Snapshot the grid so you can come back to it', cb.onSnapshotWorld);
  add('Restore', cb.hasSnapshot ? 'Go back to the last saved grid' : 'Save first -- nothing saved yet', cb.onRestoreWorld, {
    disabled: !cb.hasSnapshot,
  });
  add(cb.resetWorldLabel, 'Wipe the grid and start over', cb.onResetWorld, { danger: true });
  add('Comfort settings', 'Quiet mode, reduced motion, high contrast, bigger UI', cb.onOpenComfortSettings);
  if (cb.onExitToMenu) add('Back to the title screen', 'Leaves the bench -- unsaved work is lost', cb.onExitToMenu, { danger: true });

  modal.appendChild(list);
}
