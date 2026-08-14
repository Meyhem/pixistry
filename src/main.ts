import './style.css';
import { mountApp } from './ui/app';
import { buildMenu } from './ui/menu';
import { buildScenarioSelect } from './ui/scenario-select';

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

function showScenarioSelect(): void {
  // No scenarios exist yet -- .grill/campaign-mode.md's Phase 3 adds
  // scenario-data.ts and wires onSelect into mountApp's campaign mode. The
  // empty-state card here already reads fine on its own.
  buildScenarioSelect(root, [], {
    onSelect: () => {},
    onBack: showMenu,
  });
}

showMenu();
