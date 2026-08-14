import './style.css';
import { mountApp } from './ui/app';
import { buildMenu } from './ui/menu';
import { buildScenarioSelect, type ScenarioSummary } from './ui/scenario-select';
import { loadProgress } from './ui/campaign-progress';
import { SCENARIOS } from './sim/scenario-data';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('missing #app root element');
const root: HTMLElement = rootEl;

function showMenu(): void {
  buildMenu(root, {
    onSandbox: showSandbox,
    onCampaign: showScenarioSelect,
  });
}

function showSandbox(): void {
  const unmount = mountApp(root, {
    mode: 'sandbox',
    onExitToMenu: () => {
      unmount();
      showMenu();
    },
  });
}

function showCampaign(scenarioId: string): void {
  const unmount = mountApp(root, {
    mode: 'campaign',
    scenarioId,
    onExitToMenu: () => {
      unmount();
      showMenu();
    },
    onExitToScenarioSelect: () => {
      unmount();
      showScenarioSelect();
    },
  });
}

function showScenarioSelect(): void {
  // Every scenario ships unlocked for now -- with only 3 in the ladder
  // (.grill/campaign-mode.md's Phase 7 adds the rest), gating progression
  // behind completion would just add friction for this audience (see the
  // design doc's opening note on frustration walls) with nothing to protect
  // yet.
  const progress = loadProgress();
  const summaries: ScenarioSummary[] = SCENARIOS.map((scenario) => ({
    id: scenario.id,
    title: scenario.title,
    blurb: scenario.blurb,
    stars: progress.completedScenarioIds.includes(scenario.id) ? (progress.starsByScenarioId[scenario.id] ?? 0) : undefined,
  }));
  buildScenarioSelect(root, summaries, {
    onSelect: showCampaign,
    onBack: showMenu,
  });
}

showMenu();
