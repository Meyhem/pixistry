// Splits paintable species into ELEMENT vs COMPOUND for the side panel's
// category chip. species-data.ts has no category field of its own (it's a
// physical-constants table, not a UI taxonomy), so this is derived from
// periodic-data.ts's element->pure-species mapping, the same source of
// truth the periodic-table modal uses.
import { PURE_FOR_ELEMENT } from './periodic-data';

const ELEMENT_LABELS = new Set(Object.values(PURE_FOR_ELEMENT));

export function isElementLabel(label: string): boolean {
  return ELEMENT_LABELS.has(label);
}
