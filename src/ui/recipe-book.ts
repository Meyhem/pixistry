// The Recipe Book (see .grill/campaign-mode.md's §6 points 9-10): search a
// species and see every REACTIONS rule that makes it ("recipe") or consumes
// it ("reacts with"), generated straight from the static reaction table --
// no new data, this is purely a different view onto reactions.ts/
// species-data.ts. A menu-level screen (see main.ts) covering both points 9
// and 10 in one search box rather than two separate screens, since both are
// the same lookup over the same static table. Fully open here (matches the
// design doc's "fully open in sandbox"); not yet wired into an in-game,
// discovery-gated variant for campaign mode -- see .grill/campaign-mode.md's
// Phase 6 note for why that's a deliberate scope cut for this pass.
import { REACTIONS, type ReactionRule } from '../sim/reactions';
import { SPECIES } from '../sim/species-data';
import { el } from './dom';

export interface RecipeBookCallbacks {
  onBack(): void;
}

function nameOf(specId: number): string {
  return SPECIES[specId]?.name ?? `spec ${specId}`;
}

function formatRule(rule: ReactionRule): string {
  const reactants = rule.reactants.map(nameOf).join(' + ');
  const products = rule.products.map(nameOf).join(' + ');
  const notes: string[] = [];
  if (rule.minTempK !== undefined) notes.push(`needs ≥ ${rule.minTempK} K`);
  notes.push(`${Math.round(rule.probability * 100)}% chance/tick`);
  return `${reactants} → ${products} (${notes.join(', ')})`;
}

export function buildRecipeBook(container: HTMLElement, cb: RecipeBookCallbacks): void {
  container.innerHTML = '';
  container.className = 'recipe-book-screen';

  const header = el('div', 'scenario-select-header');
  const backButton = el('button', 'scenario-back-btn');
  backButton.textContent = '← Menu';
  backButton.onclick = cb.onBack;
  header.appendChild(backButton);
  const title = el('div', 'scenario-select-title');
  title.textContent = 'RECIPE BOOK';
  header.appendChild(title);
  container.appendChild(header);

  const searchRow = el('div', 'recipe-search-row');
  const input = el('input', 'recipe-search-input');
  input.type = 'text';
  input.placeholder = 'Search a species, e.g. NaCl';
  input.setAttribute('list', 'recipe-book-species-list');
  const datalist = el('datalist');
  datalist.id = 'recipe-book-species-list';
  for (const species of SPECIES) {
    const option = document.createElement('option');
    option.value = species.name;
    datalist.appendChild(option);
  }
  searchRow.appendChild(input);
  searchRow.appendChild(datalist);
  container.appendChild(searchRow);

  const results = el('div', 'recipe-results');
  container.appendChild(results);

  function renderResults(query: string): void {
    results.innerHTML = '';
    const trimmed = query.trim();
    if (!trimmed) {
      const hint = el('div', 'scenario-select-empty');
      hint.textContent = 'Type a species name above to see what makes it and what it reacts with.';
      results.appendChild(hint);
      return;
    }
    const specId = SPECIES.findIndex((s) => s.name.toLowerCase() === trimmed.toLowerCase());
    if (specId === -1) {
      const empty = el('div', 'scenario-select-empty');
      empty.textContent = `No species named "${trimmed}" -- check the spelling (case-insensitive, exact match).`;
      results.appendChild(empty);
      return;
    }

    const producedBy = REACTIONS.filter((rule) => rule.products.includes(specId));
    const consumedIn = REACTIONS.filter((rule) => rule.reactants.includes(specId));

    results.appendChild(recipeSection(`How to make ${nameOf(specId)}`, producedBy, 'Nothing in the reaction table produces this -- it can only ever be placed by hand.'));
    results.appendChild(recipeSection(`What ${nameOf(specId)} reacts with`, consumedIn, 'This species is inert in the reaction table -- nothing consumes it.'));
  }

  function recipeSection(heading: string, rules: readonly ReactionRule[], emptyText: string): HTMLDivElement {
    const section = el('div', 'recipe-section');
    const h = el('div', 'cabinet-section-title');
    h.textContent = heading;
    section.appendChild(h);
    if (rules.length === 0) {
      const empty = el('p', 'setting-hint');
      empty.textContent = emptyText;
      section.appendChild(empty);
      return section;
    }
    const list = el('div', 'recipe-rule-list');
    for (const rule of rules) {
      const row = el('div', 'recipe-rule');
      row.textContent = formatRule(rule);
      list.appendChild(row);
    }
    section.appendChild(list);
    return section;
  }

  input.oninput = () => renderResults(input.value);
  renderResults('');
}
