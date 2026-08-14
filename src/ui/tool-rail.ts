// The tool rail: a vertical strip down the left edge of the bench with one
// icon slot per tool, always visible. It replaces the five Tool Chest
// category buttons that used to sit in the top HUD strip -- every apparatus
// and tool is now one click away instead of two (button, then a modal to
// scroll), and the rail doubles as the "what's selected" readout, since the
// active tool's slot wears its own swatch.
//
// Species are the one thing the rail can't hold a slot *each* for -- there
// are 149 -- so the Paint slot, sitting with the everyday tools in the first
// group, opens the Tool Chest modal (tool-chest.ts, now purely the species
// picker) and renames itself to whichever species is loaded.
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
  /** One sentence on what the tool actually does, under the name in the
   * hover flyout. An icon rail is only readable if hovering a glyph you
   * don't recognise *explains* it, rather than just naming it -- "Filter"
   * and "Sink" say nothing on their own. */
  description: string;
  color: string;
  icon: IconName;
  active: boolean;
  locked: boolean;
  /** Extra class on the button -- only the species slot uses one. */
  className?: string;
  onSelect(): void;
}

/** The rail's groups, top to bottom. Captions are short enough to fit the
 * rail's own width -- they're the only trace left of the chest's section
 * headings, and they're what stops sixteen icons reading as one undivided
 * pile. */
const GROUP_CAPTIONS = ['TOOLS', 'GLASS', 'HEAT', 'FLOW'] as const;

function toolSlot(label: string, description: string, color: string, icon: IconName, kind: ToolKind, cb: ToolRailCallbacks): RailSlot {
  return {
    label,
    description,
    color,
    icon,
    active: cb.isToolActive(kind),
    locked: !!cb.isToolLocked?.(kind),
    onSelect: () => cb.onSelectTool(kind),
  };
}

function wallSlot(label: string, description: string, icon: IconName, wall: WallMaterial, cb: ToolRailCallbacks): RailSlot {
  return {
    label,
    description,
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

  // The everyday five, in the order a hand reaches for them: point at
  // something, put matter down, take it away, then the two that rearrange
  // what's already there. Paint sits among them rather than in a group of its
  // own -- it's the tool you use most, not a category.
  const tools: RailSlot[] = [
    // select-apparatus only edits already-placed apparatus (it creates no
    // matter of its own), so it's never locked -- there's no sim-side
    // ToolKind for it to be checked against.
    toolSlot(
      SELECT_APPARATUS_LABEL,
      'Click a placed funnel, tube or flask to move it or change its settings.',
      SELECT_APPARATUS_COLOR,
      'select',
      'select-apparatus',
      cb,
    ),
    speciesSlot(cb),
    toolSlot('Erase', 'Drag to wipe cells back to empty.', ERASE_COLOR, 'erase', 'erase', cb),
    toolSlot('Mix', 'Drag to stir: randomizes the contents of every cell under the brush.', MIXER_COLOR, 'mix', 'mixer', cb),
    toolSlot('Grab', 'Drag matter from one place to another, temperature and all.', GRABBER_COLOR, 'grab', 'grabber', cb),
  ];

  const glassware: RailSlot[] = [
    // One slot per vessel shape -- whether it comes with a stirrer is a
    // setting in the tool's own settings panel (see side-panel.ts's flask
    // panel), not a slot per combination.
    toolSlot('Erlenmeyer', 'A conical flask. Scroll to rotate, click to place.', FUNNEL_COLOR, 'erlenmeyer', 'flask-erlenmeyer', cb),
    toolSlot('Beaker', 'A straight-walled vessel with a wide mouth. Scroll to rotate, click to place.', FUNNEL_COLOR, 'beaker', 'flask-beaker', cb),
  ];
  if (glassWall) {
    glassware.push(
      wallSlot(
        `${glassWall.label} (polygon)`,
        'Draw your own vessel: click each corner, right-click to finish.',
        'glass',
        glassWall,
        cb,
      ),
    );
  }

  const thermal: RailSlot[] = [];
  if (insulatorWall) {
    thermal.push(wallSlot(insulatorWall.label, 'A wall that barely conducts heat -- keeps a reaction warm.', 'insulator', insulatorWall, cb));
  }
  thermal.push(
    toolSlot(
      RADIATOR_LABEL,
      'Drives everything in its radius toward a target temperature -- heats or cools, and nothing collides with it.',
      RADIATOR_COLOR,
      'radiator',
      'radiator',
      cb,
    ),
    toolSlot(
      STIRRER_LABEL,
      'Keeps agitating whatever sits inside it, every tick, once placed.',
      STIRRER_COLOR,
      'stirrer',
      'stirrer',
      cb,
    ),
  );

  const flow: RailSlot[] = [
    toolSlot(FUNNEL_LABEL, 'Drips one species at a set rate, from a finite or endless supply.', FUNNEL_COLOR, 'funnel', 'funnel', cb),
    toolSlot(
      TUBE_LABEL,
      'Sucks matter in at the mouth and carries it to the far end. Click each knee, right-click to finish.',
      TUBE_COLOR,
      'tube',
      'tube',
      cb,
    ),
    toolSlot(FILTER_LABEL, 'A line only the species you list can pass through. Everything else is blocked.', FILTER_COLOR, 'filter', 'filter', cb),
    toolSlot(SINK_LABEL, 'A line that swallows whatever touches it and counts what it caught.', SINK_COLOR, 'sink', 'sink', cb),
    toolSlot(VENT_LABEL, 'A line that throws away whatever touches it -- somewhere for waste to go.', VENT_COLOR, 'vent', 'vent', cb),
  ];

  return [tools, glassware, thermal, flow];
}

/** The paint slot. Unlike every other slot it opens a modal (the Tool Chest
 * species picker) rather than selecting outright, and it renames itself to
 * whichever species is loaded -- it's both the "pick a species" button and
 * the readout of which one is on the brush. */
function speciesSlot(cb: ToolRailCallbacks): RailSlot {
  return {
    label: cb.speciesActive ? cb.speciesLabel : 'Paint',
    description: cb.speciesActive
      ? `Painting ${cb.speciesLabel}. Click to pick a different species (T).`
      : 'Pick an element or compound to paint onto the bench (T).',
    // Unpainted, the slot wears the app's own accent rather than a stale
    // species color: nothing is selected to be colored *by*.
    color: cb.speciesColor,
    icon: 'species',
    active: cb.speciesActive,
    locked: false,
    className: 'rail-slot-species',
    onSelect: cb.onOpenSpecies,
  };
}

function slotButton(slot: RailSlot): HTMLButtonElement {
  const button = el('button', slot.className ? `rail-slot ${slot.className}` : 'rail-slot');
  button.style.setProperty('--swatch', slot.color);
  button.appendChild(toolIcon(slot.icon));

  // Name and description ride along as a hover flyout (see .rail-slot-name)
  // rather than a native title tooltip: a 500ms tooltip delay is too slow for
  // a rail you're meant to scan, and a title can't carry two lines.
  const flyout = el('span', 'rail-slot-name');
  const name = el('span', 'rail-slot-title');
  name.textContent = slot.label;
  flyout.appendChild(name);
  const description = el('span', 'rail-slot-desc');
  description.textContent = slot.locked ? 'Not available in this experiment.' : slot.description;
  flyout.appendChild(description);
  button.appendChild(flyout);

  if (slot.active) button.classList.add('active');
  if (slot.locked) {
    button.classList.add('locked');
    button.disabled = true;
    button.setAttribute('aria-label', `${slot.label} -- not available in this experiment`);
    const lock = el('span', 'rail-slot-lock');
    lock.textContent = '🔒';
    button.appendChild(lock);
  } else {
    button.setAttribute('aria-label', `${slot.label}. ${slot.description}`);
    button.onclick = slot.onSelect;
  }
  return button;
}

export function buildToolRail(container: HTMLElement, walls: readonly WallMaterial[], cb: ToolRailCallbacks): void {
  container.innerHTML = '';

  railGroups(walls, cb).forEach((slots, index) => {
    const group = el('div', 'rail-group');
    const caption = el('div', 'rail-caption');
    caption.textContent = GROUP_CAPTIONS[index] ?? '';
    group.appendChild(caption);
    for (const slot of slots) group.appendChild(slotButton(slot));
    container.appendChild(group);
  });
}
