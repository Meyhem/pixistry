import './style.css';
import { mountApp } from './ui/app';
import { buildMenu } from './ui/menu';
import { buildScenarioSelect, type ScenarioSummary } from './ui/scenario-select';
import { loadProgress } from './ui/campaign-progress';
import { SCENARIOS } from './sim/scenario-data';
import { buildCabinet } from './ui/cabinet';
import { buildRecipeBook } from './ui/recipe-book';
import { buildComfortScreen } from './ui/comfort-screen';
import { applyComfortSettings, loadComfortSettings, saveComfortSettings } from './ui/comfort-settings';

const rootEl = document.getElementById('app');
if (!rootEl) throw new Error('missing #app root element');
const root: HTMLElement = rootEl;

// Comfort settings apply globally (menu screens included, not just an
// active mountApp session) -- see comfort-settings.ts.
applyComfortSettings(loadComfortSettings());

function showMenu(): void {
  buildMenu(root, {
    onSandbox: showSandbox,
    onCampaign: showScenarioSelect,
    onCabinet: showCabinet,
    onRecipeBook: showRecipeBook,
    onComfortSettings: showComfortSettings,
  });
}

function showCabinet(): void {
  buildCabinet(root, loadProgress(), { onBack: showMenu });
}

function showRecipeBook(): void {
  buildRecipeBook(root, { onBack: showMenu });
}

function showComfortSettings(): void {
  const settings = loadComfortSettings();
  buildComfortScreen(root, settings, {
    onChange: (next) => {
      saveComfortSettings(next);
      applyComfortSettings(next);
      showComfortSettings();
    },
    onBack: showMenu,
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
