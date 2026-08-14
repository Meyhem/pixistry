// Campaign-mode overlay panels: the entry briefing card, the persistent
// objective HUD with progress bars + progressive hints, and the win overlay.
// Plain DOM, same convention as menu.ts/scenario-select.ts -- presentation
// only, callers own all state (app.ts) and pass in already-computed display
// data (ObjectiveDisplay[] from objective-display.ts) rather than this
// module reaching into GoalProgress/Scenario internals itself.
import type { Scenario } from '../sim/scenario-data';
import { el } from './dom';
import { formatDuration } from './format';
import type { ObjectiveDisplay } from './objective-display';

export interface BriefingCallbacks {
  onStart(): void;
}

/** The entry modal shown before a scenario's bench is touchable -- title,
 * blurb, briefing lines, and a Start button. Rendered into a fixed overlay
 * container the same way the periodic-table modal is (see app.ts's
 * ptOverlay); the underlying toolbar/canvas exist behind it but are inert
 * until Start, since worker restrictions are already active from
 * loadScenario -- this is purely "has the player acknowledged the goal yet". */
export function buildBriefing(container: HTMLElement, scenario: Scenario, cb: BriefingCallbacks): void {
  container.innerHTML = '';
  const modal = el('div', 'campaign-modal briefing-modal');

  const title = el('div', 'campaign-modal-title');
  title.textContent = scenario.title;
  modal.appendChild(title);

  const blurb = el('div', 'campaign-modal-blurb');
  blurb.textContent = scenario.blurb;
  modal.appendChild(blurb);

  const lines = el('div', 'briefing-lines');
  for (const line of scenario.briefing) {
    const p = el('p', 'briefing-line');
    p.textContent = line;
    lines.appendChild(p);
  }
  modal.appendChild(lines);

  const startButton = el('button', 'campaign-primary-btn');
  startButton.textContent = 'Start experiment';
  startButton.onclick = cb.onStart;
  modal.appendChild(startButton);

  container.appendChild(modal);
}

/** Live status of an in-flight Run Test burst (see worker.ts's
 * 'burstProgress') -- null when no burst is running. */
export interface BurstStatus {
  readonly ticksTotal: number;
  readonly ticksRemaining: number;
}

export interface ObjectiveHudCallbacks {
  onRevealHint(): void;
  /** Fast-forwards the bench to see if the built apparatus holds up (see
   * .grill/campaign-mode.md's Phase 5) -- fires a 'runBurst' message. */
  onRunTest(): void;
  onCancelTest(): void;
  /** Restores the world to right before the last Run Test (or manual Save)
   * -- literally the same 'restoreWorld' message the toolbar's own Restore
   * button sends (see toolbar.ts), offered here too since that's the
   * natural place to undo a test that didn't go how the player wanted. */
  onRewind(): void;
}

/** The persistent in-experiment HUD: one progress bar per goal (see
 * objective-display.ts), a hint box that reveals scenario.hints one at a
 * time on request rather than all at once -- being stuck with no path
 * forward is where this audience quits (.grill/campaign-mode.md point 11),
 * but a wall of hints up front would just spoil the puzzle -- and a Run Test
 * row (hidden once the scenario's already won, since there's nothing left
 * to test). */
export function buildObjectiveHud(
  container: HTMLElement,
  scenario: Scenario,
  objectives: readonly ObjectiveDisplay[],
  revealedHints: readonly string[],
  burst: BurstStatus | null,
  hasSnapshot: boolean,
  canTest: boolean,
  cb: ObjectiveHudCallbacks,
): void {
  container.innerHTML = '';
  container.className = 'campaign-hud';

  const title = el('div', 'campaign-hud-title');
  title.textContent = scenario.title;
  container.appendChild(title);

  const bars = el('div', 'campaign-hud-bars');
  for (const objective of objectives) {
    const row = el('div', 'hud-objective');
    if (objective.complete) row.classList.add('complete');
    if (objective.failed) row.classList.add('failed');

    const label = el('div', 'hud-objective-label');
    label.textContent = objective.text;
    row.appendChild(label);

    const track = el('div', 'hud-bar-track');
    const fill = el('div', 'hud-bar-fill');
    fill.style.width = `${Math.round(objective.fraction * 100)}%`;
    fill.style.background = objective.color;
    track.appendChild(fill);
    row.appendChild(track);

    const readout = el('div', 'hud-objective-readout');
    readout.textContent = objective.readout;
    row.appendChild(readout);

    bars.appendChild(row);
  }
  container.appendChild(bars);

  const hintsBox = el('div', 'campaign-hints');
  for (const hint of revealedHints) {
    const p = el('p', 'hint-line');
    p.textContent = hint;
    hintsBox.appendChild(p);
  }
  if (revealedHints.length < scenario.hints.length) {
    const hintButton = el('button', 'hint-btn');
    hintButton.textContent = revealedHints.length === 0 ? 'Need a hint?' : 'Another hint';
    hintButton.onclick = cb.onRevealHint;
    hintsBox.appendChild(hintButton);
  }
  container.appendChild(hintsBox);

  if (canTest) {
    const testRow = el('div', 'campaign-test-row');
    if (burst) {
      const done = burst.ticksTotal - burst.ticksRemaining;
      const pct = burst.ticksTotal > 0 ? Math.round((done / burst.ticksTotal) * 100) : 100;
      const status = el('div', 'test-status');
      status.textContent = `Running test… ${pct}%`;
      testRow.appendChild(status);

      const track = el('div', 'hud-bar-track');
      const fill = el('div', 'hud-bar-fill');
      fill.style.width = `${pct}%`;
      fill.style.background = '#4da3ff';
      track.appendChild(fill);
      testRow.appendChild(track);

      const cancelButton = el('button', 'campaign-secondary-btn');
      cancelButton.textContent = 'Cancel test';
      cancelButton.onclick = cb.onCancelTest;
      testRow.appendChild(cancelButton);
    } else {
      const runButton = el('button', 'campaign-secondary-btn');
      runButton.textContent = '▶ Run Test';
      runButton.title = 'Fast-forward 30 seconds to see if this holds up';
      runButton.onclick = cb.onRunTest;
      testRow.appendChild(runButton);

      if (hasSnapshot) {
        const rewindButton = el('button', 'campaign-secondary-btn');
        rewindButton.textContent = '↩ Rewind';
        rewindButton.title = 'Go back to before the last test or save';
        rewindButton.onclick = cb.onRewind;
        testRow.appendChild(rewindButton);
      }
    }
    container.appendChild(testRow);
  }
}

export interface WinOverlayCallbacks {
  onReplay(): void;
  /** Omitted when this was the last scenario in the ladder. */
  onNextScenario?(): void;
  onExitToSelect(): void;
}

/** The win screen: stars, elapsed time, the balanced-equation "fact", and
 * next steps. Shown once objective-display.ts's isScenarioWon flips true. */
export function buildWinOverlay(container: HTMLElement, scenario: Scenario, stars: number, elapsedSeconds: number, cb: WinOverlayCallbacks): void {
  container.innerHTML = '';
  const modal = el('div', 'campaign-modal win-modal');

  const title = el('div', 'campaign-modal-title');
  title.textContent = 'Experiment complete!';
  modal.appendChild(title);

  const starsEl = el('div', 'win-stars');
  starsEl.textContent = '★'.repeat(stars) + '☆'.repeat(3 - stars);
  modal.appendChild(starsEl);

  const time = el('div', 'win-time');
  time.textContent = `Finished in ${formatDuration(elapsedSeconds)}`;
  modal.appendChild(time);

  const fact = el('p', 'win-fact');
  fact.textContent = scenario.fact;
  modal.appendChild(fact);

  const actions = el('div', 'win-actions');
  const replayButton = el('button', 'campaign-secondary-btn');
  replayButton.textContent = 'Replay';
  replayButton.onclick = cb.onReplay;
  actions.appendChild(replayButton);

  if (cb.onNextScenario) {
    const nextButton = el('button', 'campaign-primary-btn');
    nextButton.textContent = 'Next experiment';
    nextButton.onclick = cb.onNextScenario;
    actions.appendChild(nextButton);
  }

  const exitButton = el('button', 'campaign-secondary-btn');
  exitButton.textContent = 'Campaign menu';
  exitButton.onclick = cb.onExitToSelect;
  actions.appendChild(exitButton);

  modal.appendChild(actions);
  container.appendChild(modal);
}
