// Heater/cooler apparatus, merged into a single "Radiator" tool -- pure
// radiation, no collision. A placed radiator is NOT matter: it doesn't
// occupy grid.specId at all, so nothing falls onto it, displaces it, or is
// blocked by it -- a particle simply passes through (or rests on top of, or
// sits inside) the same cell, and that's what changes its temperature.
//
// There's no separate heater/cooler kind anymore: a radiator just carries a
// target temperature (grid.radiatorTargetK) and drives every cell within
// its reach (grid.radiatorRadius) toward that target every tick -- heating
// cells below it, cooling cells above it (see heat.ts's
// applyPointHeatSource) -- so whether a given placement acts as a heater or
// a cooler falls out of the target the player picked, not a separate tool.
// Both fields are captured once, at paint time, from whatever the side
// panel's radiation-radius/target-temperature sliders read at that moment
// (see worker.ts's 'paintRadiatorLine' handler), so moving those sliders
// afterward never changes a radiator already placed on the grid.
export const RADIATOR_WATTS = 400;
export const RADIATOR_LABEL = 'Radiator';
export const RADIATOR_COLOR = 'linear-gradient(135deg, #ff9d5c 0%, #5cc8ff 100%)';
