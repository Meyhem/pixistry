// The Cabinet: a collectible card for every species the player has ever
// made (see .grill/campaign-mode.md's §6 point 6) -- turns species-data.ts's
// existing real-constant table into free collectibles, works identically in
// sandbox and campaign since it's driven purely by campaign-progress.ts's
// discoveredSpeciesLabels/discoverySourceByLabel. A menu-level screen (see
// main.ts), read straight from localStorage -- no live grid needed.
import { SPECIES } from '../sim/species-data';
import { el } from './dom';
import { ACHIEVEMENTS } from './achievements';
import type { CampaignProgress } from './campaign-progress';

export interface CabinetCallbacks {
  onBack(): void;
}

export function buildCabinet(container: HTMLElement, progress: CampaignProgress, cb: CabinetCallbacks): void {
  container.innerHTML = '';
  container.className = 'cabinet-screen';

  const header = el('div', 'scenario-select-header');
  const backButton = el('button', 'scenario-back-btn');
  backButton.textContent = '← Menu';
  backButton.onclick = cb.onBack;
  header.appendChild(backButton);
  const title = el('div', 'scenario-select-title');
  title.textContent = 'CABINET';
  header.appendChild(title);
  container.appendChild(header);

  const unlocked = new Set(progress.achievementIds);
  const achievementsBox = el('div', 'cabinet-achievements');
  const achievementsTitle = el('div', 'cabinet-section-title');
  achievementsTitle.textContent = `Achievements (${unlocked.size} / ${ACHIEVEMENTS.length})`;
  achievementsBox.appendChild(achievementsTitle);
  const achievementsList = el('div', 'achievement-list');
  for (const achievement of ACHIEVEMENTS) {
    const isUnlocked = unlocked.has(achievement.id);
    const badge = el('div', isUnlocked ? 'achievement-badge unlocked' : 'achievement-badge');
    const badgeTitle = el('div', 'achievement-badge-title');
    badgeTitle.textContent = isUnlocked ? achievement.title : '???';
    const badgeDesc = el('div', 'achievement-badge-desc');
    badgeDesc.textContent = isUnlocked ? achievement.description : 'Keep experimenting to find this one.';
    badge.appendChild(badgeTitle);
    badge.appendChild(badgeDesc);
    achievementsList.appendChild(badge);
  }
  achievementsBox.appendChild(achievementsList);
  container.appendChild(achievementsBox);

  const discovered = new Set(progress.discoveredSpeciesLabels);
  const known = SPECIES.filter((s) => discovered.has(s.name)).sort((a, b) => a.name.localeCompare(b.name));

  const count = el('div', 'cabinet-count');
  count.textContent = `${known.length} / ${SPECIES.length} species discovered`;
  container.appendChild(count);

  if (known.length === 0) {
    const empty = el('div', 'scenario-select-empty');
    empty.textContent = 'Nothing collected yet -- play Sandbox or Campaign and make something.';
    container.appendChild(empty);
    return;
  }

  const grid = el('div', 'cabinet-grid');
  for (const species of known) {
    const card = el('div', 'cabinet-card');
    const swatch = el('div', 'cabinet-swatch');
    swatch.style.background = species.color;
    card.appendChild(swatch);

    const name = el('div', 'cabinet-card-name');
    name.textContent = species.name;
    card.appendChild(name);

    const phase = el('div', 'cabinet-card-phase');
    phase.textContent = species.phaseAtSTP;
    card.appendChild(phase);

    const stats = el('div', 'cabinet-card-stats');
    stats.appendChild(statRow('Melts', `${species.meltingPointC}°C`));
    stats.appendChild(statRow('Boils', `${species.boilingPointC}°C`));
    stats.appendChild(statRow('Molar mass', `${species.molarMass} g/mol`));
    card.appendChild(stats);

    const source = progress.discoverySourceByLabel[species.name];
    if (source) {
      const sourceEl = el('div', 'cabinet-card-source');
      sourceEl.textContent = `First made in: ${source}`;
      card.appendChild(sourceEl);
    }

    grid.appendChild(card);
  }
  container.appendChild(grid);
}

function statRow(label: string, value: string): HTMLDivElement {
  const row = el('div', 'cabinet-stat-row');
  const l = el('span', 'cabinet-stat-label');
  l.textContent = label;
  const v = el('span', 'cabinet-stat-value');
  v.textContent = value;
  row.appendChild(l);
  row.appendChild(v);
  return row;
}
