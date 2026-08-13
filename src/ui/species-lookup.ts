// Species/wall label+color+palette-entry lookup for app.ts's hover
// inspector, funnel field display, and debug hook -- built once from
// SPECIES + walls (specIds are stable array indices, shared by the main
// thread and worker, so this never needs to round-trip through the worker
// to know what a given specId is called). Split out because app.ts used to
// build the same label/color maps twice: once from SPECIES at mount time,
// and again from the worker's 'ready' palette -- redundant, since
// buildPalette() (species.ts) copies its label/color straight from the same
// SPECIES entries in the first place.
import type { PaletteEntry } from '../sim/species';
import { SPECIES } from '../sim/species-data';
import { wallList } from '../sim/walls';

export interface SpeciesLookup {
  /** Species/wall display name for a specId, or undefined if unknown. */
  labelOf(specId: number): string | undefined;
  /** Species/wall swatch color for a specId, or undefined if unknown. */
  colorOf(specId: number): string | undefined;
  /** The paintable palette entry for a specId (undefined for a wall, or a
   * non-paintable species) -- an O(1) lookup instead of paletteEntryFor's
   * old `palette.find(...)` scan on every side-panel render. Only populated
   * after setPalette has been called. */
  paletteEntryOf(specId: number): PaletteEntry | undefined;
  /** Indexes the worker's 'ready' palette by specId -- call once, when it
   * arrives. */
  setPalette(palette: readonly PaletteEntry[]): void;
}

export function buildSpeciesLookup(): SpeciesLookup {
  const labelBySpecId = new Map<number, string>();
  const colorBySpecId = new Map<number, string>();
  SPECIES.forEach((data, specId) => {
    labelBySpecId.set(specId, data.name);
    colorBySpecId.set(specId, data.color);
  });
  for (const wall of wallList()) {
    labelBySpecId.set(wall.specId, wall.label);
    colorBySpecId.set(wall.specId, wall.color);
  }

  let paletteEntryBySpecId = new Map<number, PaletteEntry>();

  return {
    labelOf: (specId) => labelBySpecId.get(specId),
    colorOf: (specId) => colorBySpecId.get(specId),
    paletteEntryOf: (specId) => paletteEntryBySpecId.get(specId),
    setPalette: (palette) => {
      paletteEntryBySpecId = new Map(palette.map((entry) => [entry.specId, entry]));
    },
  };
}
