// Title screen: the app's entry point (see main.ts). Plain DOM, same
// convention as the rest of src/ui. Cabinet and Comfort settings are shown
// as disabled cards rather than omitted -- the destination exists in the
// design (.grill/campaign-mode.md) even though the phases that build them
// (6) haven't landed yet, and a visible-but-locked card previews what's
// coming rather than just disappearing.
import { el } from './dom';

export interface MenuCallbacks {
  onSandbox(): void;
  onCampaign(): void;
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
  cards.appendChild(makeCard('Cabinet', "Every species you've ever made, collected."));
  cards.appendChild(makeCard('Comfort settings', 'Quiet mode, reduced motion, high contrast.'));
  container.appendChild(cards);
}

function makeCard(title: string, blurb: string, onClick?: () => void): HTMLButtonElement {
  const card = el('button', 'menu-card');
  const disabled = !onClick;
  card.disabled = disabled;
  const titleEl = el('div', 'menu-card-title');
  titleEl.textContent = title;
  const blurbEl = el('div', 'menu-card-blurb');
  blurbEl.textContent = disabled ? `${blurb} (Coming soon)` : blurb;
  card.appendChild(titleEl);
  card.appendChild(blurbEl);
  if (onClick) card.onclick = onClick;
  return card;
}
