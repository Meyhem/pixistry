// Gas constant, kJ/mol/K
export const R = 0.0083145;

/**
 * Evans-Polanyi activation energy from bonds broken and reaction enthalpy.
 * Clamped at 0 -- the linear approximation can go negative for very
 * exothermic reactions with few bonds broken, but a real activation energy
 * is never negative.
 */
export function evansPolanyiEa(bondsBrokenEnthalpy: number, deltaH: number): number {
  return Math.max(0, 0.5 * bondsBrokenEnthalpy + 0.3 * deltaH);
}

/**
 * Arrhenius-style firing probability per tick, evaluated at the exact
 * temperature (not the tempBucket used to memoize product search) so
 * ignition behavior stays smooth rather than stair-stepping.
 */
export function reactionProbability(Ea: number, T: number): number {
  if (T <= 0) return 0;
  return Math.exp(-Ea / (R * T));
}
