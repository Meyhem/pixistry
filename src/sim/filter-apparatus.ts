// The Filter apparatus: a painted overlay (grid.filterMask) that only lets
// species in the current global allow-list (see worker.ts's
// filterAllowSpecies) move into a marked cell -- every other species is
// blocked exactly like a wall (see movement.ts's canEnterFiltered). Unlike
// the stirrer/tube apparatus, there's no per-tick step function here: the
// gating happens inline in movement.ts, so this module is just the
// toolbar/side-panel display constants, mirroring stirrer.ts's
// STIRRER_LABEL/STIRRER_COLOR pattern.
export const FILTER_LABEL = 'Filter';
export const FILTER_COLOR = '#8ce096';
