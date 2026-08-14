// Title screen: the app's entry point (see main.ts). Plain DOM, same
// convention as the rest of src/ui.
import { el } from './dom';

export interface MenuCallbacks {
  onSandbox(): void;
  onCampaign(): void;
  onCabinet(): void;
  onRecipeBook(): void;
  onComfortSettings(): void;
}

export function buildMenu(container: HTMLElement, cb: MenuCallbacks): void {
  container.innerHTML = '';
  container.className = 'menu-screen';

  const title = el('div', 'menu-title');
  title.textContent = 'PIXISTRY';
  container.appendChild(title);

  const subtitle = el('div', 'menu-subtitle');
  subtitle.textContent = 'falling-sand chemistry sandbox';
  container.appendChild(subtitle);

  const cards = el('div', 'menu-cards');
  cards.appendChild(makeCard('Sandbox', 'Everything unlocked -- paint, build, react, no goals.', cb.onSandbox));
  cards.appendChild(makeCard('Campaign', 'Scenarios with a target product to make.', cb.onCampaign));
  cards.appendChild(makeCard('Cabinet', "Every species you've ever made, collected.", cb.onCabinet));
  cards.appendChild(makeCard('Recipe Book', 'Search what makes what, straight from the reaction table.', cb.onRecipeBook));
  cards.appendChild(makeCard('Comfort settings', 'Quiet mode, reduced motion, high contrast, bigger UI.', cb.onComfortSettings));
  container.appendChild(cards);
}

function makeCard(title: string, blurb: string, onClick: () => void): HTMLButtonElement {
  const card = el('button', 'menu-card');
  const titleEl = el('div', 'menu-card-title');
  titleEl.textContent = title;
  const blurbEl = el('div', 'menu-card-blurb');
  blurbEl.textContent = blurb;
  card.appendChild(titleEl);
  card.appendChild(blurbEl);
  card.onclick = onClick;
  return card;
}
