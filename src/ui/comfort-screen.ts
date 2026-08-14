// The Comfort settings screen: four checkboxes over comfort-settings.ts's
// ComfortSettings, plain DOM same as the rest of src/ui. Reachable from the
// title menu, and (via the same builder) from a small in-game settings
// button (see app.ts) so a player never has to leave a scenario to calm the
// experience down.
import { el } from './dom';
import type { ComfortSettings } from './comfort-settings';

export interface ComfortScreenCallbacks {
  onChange(next: ComfortSettings): void;
  onBack(): void;
}

const TOGGLES: ReadonlyArray<{ key: keyof ComfortSettings; label: string; blurb: string }> = [
  { key: 'quiet', label: 'Quiet mode', blurb: 'Mute chimes and every other sound.' },
  { key: 'reduceMotion', label: 'Reduce motion', blurb: 'Turn off the sink sparkle and other flash effects.' },
  { key: 'highContrast', label: 'High contrast', blurb: 'Bolder outlines and text for better readability.' },
  { key: 'bigUI', label: 'Bigger UI', blurb: 'Larger buttons and text throughout.' },
];

export function buildComfortScreen(container: HTMLElement, settings: ComfortSettings, cb: ComfortScreenCallbacks): void {
  container.innerHTML = '';
  container.className = 'comfort-screen';

  const header = el('div', 'scenario-select-header');
  const backButton = el('button', 'scenario-back-btn');
  backButton.textContent = '← Menu';
  backButton.onclick = cb.onBack;
  header.appendChild(backButton);
  const title = el('div', 'scenario-select-title');
  title.textContent = 'COMFORT SETTINGS';
  header.appendChild(title);
  container.appendChild(header);

  const list = el('div', 'comfort-toggle-list');
  for (const toggle of TOGGLES) {
    const row = el('label', 'comfort-toggle-row');
    const checkbox = el('input', 'comfort-toggle-checkbox');
    checkbox.type = 'checkbox';
    checkbox.checked = settings[toggle.key];
    checkbox.onchange = () => cb.onChange({ ...settings, [toggle.key]: checkbox.checked });
    const text = el('div', 'comfort-toggle-text');
    const label = el('div', 'comfort-toggle-label');
    label.textContent = toggle.label;
    const blurb = el('div', 'comfort-toggle-blurb');
    blurb.textContent = toggle.blurb;
    text.appendChild(label);
    text.appendChild(blurb);
    row.appendChild(checkbox);
    row.appendChild(text);
    list.appendChild(row);
  }
  container.appendChild(list);
}
