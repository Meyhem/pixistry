// The tool rail: a vertical strip down the left edge of the bench with one
// icon slot per tool, always visible. It replaces the five Tool Chest
// category buttons that used to sit in the top HUD strip -- every apparatus
// and tool is now one click away instead of two (button, then a modal to
// scroll), and the rail doubles as the "what's selected" readout, since the
// active tool's slot wears its own swatch.
//
// Species are the one thing the rail can't hold a slot for -- there are 149
// of them -- so the top slot opens the Tool Chest modal (tool-chest.ts),
// which is now purely the species picker.
//
// This module is the canonical home for the UI-side `ToolKind` union and the
// select-apparatus label/color (both lived in tool-chest.ts while the chest
// was what enumerated every tool, and in the deleted toolbar.ts before that),
// since the rail is what enumerates them now.
import type { WallMaterial } from '../sim/walls';
import { RADIATOR_COLOR, RADIATOR_LABEL } from '../sim/radiators';
import { FUNNEL_COLOR, FUNNEL_LABEL } from '../sim/funnel';
import { STIRRER_COLOR, STIRRER_LABEL } from '../sim/stirrer';
import { TUBE_COLOR, TUBE_LABEL } from '../sim/tube';
import { FILTER_COLOR, FILTER_LABEL } from '../sim/filter-apparatus';
import { SINK_COLOR, SINK_LABEL, VENT_COLOR, VENT_LABEL } from '../sim/sink';
import { el } from './dom';
import { toolIcon, type IconName } from './tool-icons';

export type ToolKind =
  | 'radiator'
  | 'erase'
  | 'mixer'
  | 'grabber'
  | 'funnel'
  | 'stirrer'
  | 'tube'
  | 'filter'
  | 'sink'
  | 'vent'
  | 'flask-erlenmeyer'
  | 'flask-beaker'
  | 'select-apparatus';

export const SELECT_APPARATUS_LABEL = 'Select';
export const SELECT_APPARATUS_COLOR = '#4da3ff';

export const ERASE_COLOR = '#8a8a8a';
export const MIXER_COLOR = '#c9a8ff';
export const GRABBER_COLOR = '#f2d94e';

export interface ToolRailCallbacks {
  isToolActive(kind: ToolKind): boolean;
  isWallActive(specId: number): boolean;
  onSelectTool(kind: ToolKind): void;
  onSelectWall(specId: number): void;

  /** The species slot: opens the Tool Chest, and shows whichever species is
   * currently painting (label/swatch) so the rail covers every tool state. */
  speciesActive: boolean;
  speciesLabel: string;
  speciesColor: string;
  onOpenSpecies(): void;

  /** Campaign restrictions (absent in sandbox, which locks nothing) -- a
   * locked slot greys out and says why, rather than silently no-op'ing at
   * the worker. */
  isToolLocked?(kind: ToolKind): boolean;
  isWallLocked?(specId: number): boolean;
}

interface RailSlot {
  label: string;
  color: string;
  icon: IconName;
  active: boolean;
  locked: boolean;
  onSelect(): void;
}

/** The rail's groups, top to bottom. Captions are short enough to fit the
 * rail's own width -- they're the only trace left of the chest's section
 * headings, and they're what stops fifteen icons reading as one undivided
 * pile. */
const GROUP_CAPTIONS = ['GLASS', 'HEAT', 'FLOW', 'TOOLS'] as const;

function toolSlot(label: string, color: string, icon: IconName, kind: ToolKind, cb: ToolRailCallbacks): RailSlot {
  return {
    label,
    color,
    icon,
    active: cb.isToolActive(kind),
    locked: !!cb.isToolLocked?.(kind),
    onSelect: () => cb.onSelectTool(kind),
  };
}

function wallSlot(label: string, icon: IconName, wall: WallMaterial, cb: ToolRailCallbacks): RailSlot {
  return {
    label,
    color: wall.color,
    icon,
    active: cb.isWallActive(wall.specId),
    locked: !!cb.isWallLocked?.(wall.specId),
    onSelect: () => cb.onSelectWall(wall.specId),
  };
}

/** The four groups' slots. Which group a tool lands in is an editorial call,
 * not something derived from ToolKind: the Stirrer is filed under heat/mixing
 * rather than flow because that's what a player reaches for it *for*. */
function railGroups(walls: readonly WallMaterial[], cb: ToolRailCallbacks): RailSlot[][] {
  const glassWall = walls.find((w) => w.kind === 'glass');
  const insulatorWall = walls.find((w) => w.kind === 'insulator');

  const glassware: RailSlot[] = [
    // One slot per vessel shape -- whether it comes with a stirrer is a
    // setting in the tool's own settings panel (see side-panel.ts's flask
    // panel), not a slot per combination.
    toolSlot('Erlenmeyer', FUNNEL_COLOR, 'erlenmeyer', 'flask-erlenmeyer', cb),
    toolSlot('Beaker', FUNNEL_COLOR, 'beaker', 'flask-beaker', cb),
  ];
  if (glassWall) glassware.push(wallSlot(`${glassWall.label} (polygon)`, 'glass', glassWall, cb));

  const thermal: RailSlot[] = [];
  if (insulatorWall) thermal.push(wallSlot(insulatorWall.label, 'insulator', insulatorWall, cb));
  thermal.push(
    toolSlot(RADIATOR_LABEL, RADIATOR_COLOR, 'radiator', 'radiator', cb),
    toolSlot(STIRRER_LABEL, STIRRER_COLOR, 'stirrer', 'stirrer', cb),
  );

  const flow: RailSlot[] = [
    toolSlot(FUNNEL_LABEL, FUNNEL_COLOR, 'funnel', 'funnel', cb),
    toolSlot(TUBE_LABEL, TUBE_COLOR, 'tube', 'tube', cb),
    toolSlot(FILTER_LABEL, FILTER_COLOR, 'filter', 'filter', cb),
    toolSlot(SINK_LABEL, SINK_COLOR, 'sink', 'sink', cb),
    toolSlot(VENT_LABEL, VENT_COLOR, 'vent', 'vent', cb),
  ];

  const tools: RailSlot[] = [
    toolSlot('Erase', ERASE_COLOR, 'erase', 'erase', cb),
    toolSlot('Mix', MIXER_COLOR, 'mix', 'mixer', cb),
    toolSlot('Grab', GRABBER_COLOR, 'grab', 'grabber', cb),
    // select-apparatus only edits already-placed apparatus (it creates no
    // matter of its own), so it's never locked -- there's no sim-side
    // ToolKind for it to be checked against.
    toolSlot(SELECT_APPARATUS_LABEL, SELECT_APPARATUS_COLOR, 'select', 'select-apparatus', cb),
  ];

  return [glassware, thermal, flow, tools];
}

function slotButton(slot: RailSlot): HTMLButtonElement {
  const button = el('button', 'rail-slot');
  button.style.setProperty('--swatch', slot.color);
  button.appendChild(toolIcon(slot.icon));

  // The name rides along as a hover flyout (see .rail-slot-name) rather than
  // a native title tooltip: a 500ms tooltip delay is too slow for a rail
  // you're meant to scan.
  const name = el('span', 'rail-slot-name');
  name.textContent = slot.label;
  button.appendChild(name);

  if (slot.active) button.classList.add('active');
  if (slot.locked) {
    button.classList.add('locked');
    button.disabled = true;
    button.setAttribute('aria-label', `${slot.label} -- not available in this experiment`);
    const lock = el('span', 'rail-slot-lock');
    lock.textContent = '🔒';
    button.appendChild(lock);
  } else {
    button.setAttribute('aria-label', slot.label);
    button.onclick = slot.onSelect;
  }
  return button;
}

export function buildToolRail(container: HTMLElement, walls: readonly WallMaterial[], cb: ToolRailCallbacks): void {
  container.innerHTML = '';

  // The species slot is its own group at the top: it's the only slot that
  // opens a modal rather than selecting a tool outright, and the only one
  // whose swatch changes with what's selected inside it.
  const speciesGroup = el('div', 'rail-group');
  const speciesCaption = el('div', 'rail-caption');
  speciesCaption.textContent = 'PAINT';
  speciesGroup.appendChild(speciesCaption);
  const species = el('button', 'rail-slot rail-slot-species');
  species.style.setProperty('--swatch', cb.speciesColor);
  species.appendChild(toolIcon('species'));
  const speciesName = el('span', 'rail-slot-name');
  speciesName.textContent = cb.speciesActive ? cb.speciesLabel : 'Elements & Compounds';
  species.appendChild(speciesName);
  if (cb.speciesActive) species.classList.add('active');
  species.setAttribute('aria-label', cb.speciesActive ? `${cb.speciesLabel} -- pick another species (T)` : 'Elements & Compounds (T)');
  species.onclick = cb.onOpenSpecies;
  speciesGroup.appendChild(species);
  container.appendChild(speciesGroup);

  railGroups(walls, cb).forEach((slots, index) => {
    const group = el('div', 'rail-group');
    const caption = el('div', 'rail-caption');
    caption.textContent = GROUP_CAPTIONS[index] ?? '';
    group.appendChild(caption);
    for (const slot of slots) group.appendChild(slotButton(slot));
    container.appendChild(group);
  });
}
