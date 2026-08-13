// Heater/cooler apparatus -- pure radiation, no collision. A placed
// radiator is NOT matter: it doesn't occupy grid.specId at all, so nothing
// falls onto it, displaces it, or is blocked by it -- a particle simply
// passes through (or rests on top of, or sits inside) the same cell, and
// that's what changes its temperature. The wattage is tracked in
// SimGrid.radiator, a background field independent of specId/phase/u; see
// heat.ts's stepRadiators, which reads that array directly every tick and
// radiates into cells within the player-configurable radiation radius, the
// same way the earlier heater-glass/cooler-glass wall materials did (see
// walls.ts's header) -- only the "occupies a cell and blocks movement" part
// was removed.
export type RadiatorSign = 1 | -1;

export interface RadiatorKind {
  readonly sign: RadiatorSign;
  readonly label: string;
  readonly color: string;
  readonly watts: number;
}

export const HEATER_WATTS = 400;
export const COOLER_WATTS = -400;

export const RADIATORS: readonly RadiatorKind[] = [
  { sign: 1, label: 'Heater', color: '#ff9d5c', watts: HEATER_WATTS },
  { sign: -1, label: 'Cooler', color: '#5cc8ff', watts: COOLER_WATTS },
];

export function radiatorFor(sign: RadiatorSign): RadiatorKind {
  const found = RADIATORS.find((r) => r.sign === sign);
  if (!found) throw new Error(`no radiator kind for sign ${sign}`);
  return found;
}
