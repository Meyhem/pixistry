// Campaign scenario picker: cards with title/blurb/stars, locked ones
// disabled. `ScenarioSummary` is a display-only shape independent of the
// real `Scenario` data type Phase 3 (.grill/campaign-mode.md) will add to
// src/sim/scenario-data.ts -- this screen only needs enough to render a
// grid and report which id was picked, so it doesn't need to wait on that
// engine work to exist.
import { el } from './dom';

export interface ScenarioSummary {
  id: string;
  title: string;
  blurb: string;
  locked?: boolean;
  /** 0-3 stars if completed at least once; undefined if never completed. */
  stars?: number;
}

export interface ScenarioSelectCallbacks {
  onSelect(scenarioId: string): void;
  onBack(): void;
}

export function buildScenarioSelect(container: HTMLElement, scenarios: readonly ScenarioSummary[], cb: ScenarioSelectCallbacks): void {
  container.innerHTML = '';
  container.className = 'scenario-select-screen';

  const header = el('div', 'scenario-select-header');
  const backButton = el('button', 'scenario-back-btn');
  backButton.textContent = '← Menu';
  backButton.onclick = cb.onBack;
  header.appendChild(backButton);
  const title = el('div', 'scenario-select-title');
  title.textContent = 'CAMPAIGN';
  header.appendChild(title);
  container.appendChild(header);

  if (scenarios.length === 0) {
    const empty = el('div', 'scenario-select-empty');
    empty.textContent = 'More scenarios are on the way -- check back soon!';
    container.appendChild(empty);
    return;
  }

  const grid = el('div', 'scenario-grid');
  for (const scenario of scenarios) {
    const card = el('button', 'scenario-card');
    card.disabled = !!scenario.locked;
    if (scenario.locked) card.classList.add('locked');
    const titleEl = el('div', 'scenario-card-title');
    titleEl.textContent = scenario.title;
    const blurbEl = el('div', 'scenario-card-blurb');
    blurbEl.textContent = scenario.blurb;
    card.appendChild(titleEl);
    card.appendChild(blurbEl);
    if (scenario.stars !== undefined) {
      const stars = el('div', 'scenario-card-stars');
      stars.textContent = '★'.repeat(scenario.stars) + '☆'.repeat(3 - scenario.stars);
      card.appendChild(stars);
    }
    if (!scenario.locked) card.onclick = () => cb.onSelect(scenario.id);
    grid.appendChild(card);
  }
  container.appendChild(grid);
}
