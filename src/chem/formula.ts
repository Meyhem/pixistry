import type { Atom, ElementSymbol, MoleculeGraph } from './types';

/**
 * Formula strings use strict Hill notation: if carbon is present, C first,
 * H second (if present), then remaining elements alphabetically; otherwise
 * all elements (including H) alphabetically. This deliberately matches what
 * cheminformatics tools (e.g. PubChem) call the "Hill formula" rather than
 * common/traditional formula writing, so it looks unfamiliar for some
 * compounds: NaCl -> "ClNa", HCl -> "ClH", NH3 -> "H3N". That's expected;
 * this string exists as a stable, mechanically-derivable key (for override
 * lookups and interning), not as textbook-style display text.
 */

export function atomCounts(atoms: Atom[]): Map<ElementSymbol, number> {
  const counts = new Map<ElementSymbol, number>();
  for (const atom of atoms) {
    counts.set(atom.element, (counts.get(atom.element) ?? 0) + 1);
  }
  return counts;
}

export function netCharge(atoms: Atom[]): number {
  return atoms.reduce((sum, a) => sum + a.charge, 0);
}

function formatChargeSuffix(charge: number): string {
  if (charge === 0) return '';
  const sign = charge > 0 ? '+' : '-';
  const magnitude = Math.abs(charge);
  return magnitude === 1 ? sign : `${magnitude}${sign}`;
}

/** Hill-notation formula from an atom multiset, no charge suffix. */
export function hillFormula(atoms: Atom[]): string {
  const counts = atomCounts(atoms);
  const symbols = [...counts.keys()];
  let ordered: ElementSymbol[];
  if (counts.has('C')) {
    const rest = symbols.filter((s) => s !== 'C' && s !== 'H').sort();
    ordered = counts.has('H') ? ['C', 'H', ...rest] : ['C', ...rest];
  } else {
    ordered = symbols.sort();
  }
  return ordered
    .map((sym) => {
      const n = counts.get(sym) ?? 0;
      return n === 1 ? sym : `${sym}${n}`;
    })
    .join('');
}

/** Hill formula plus a trailing charge suffix (e.g. "Na+", "Ca2+", "ClNa"). */
export function moleculeToFormula(graph: MoleculeGraph): string {
  return hillFormula(graph.atoms) + formatChargeSuffix(netCharge(graph.atoms));
}

/**
 * Parses a simple formula (element symbols + optional counts, optional
 * trailing charge like "+", "2+", "-", "2-") into a flat atom multiset with
 * charge=0 on every atom except that any net charge is placed on the last
 * parsed atom. This does NOT infer bonding -- callers that need a real
 * MoleculeGraph must build bonds separately. It exists as a convenience for
 * tests and for constructing simple monatomic/ionic species.
 */
export function parseFormula(formula: string): Atom[] {
  let body = formula;
  let charge = 0;
  const chargeMatch = /^(.*?)(\d*)([+-])$/.exec(formula);
  if (chargeMatch && /[+-]$/.test(formula)) {
    const [, prefix, magStr, sign] = chargeMatch;
    body = prefix ?? '';
    const magnitude = magStr ? parseInt(magStr, 10) : 1;
    charge = sign === '+' ? magnitude : -magnitude;
  }

  const atoms: Atom[] = [];
  const tokenRe = /([A-Z][a-z]?)(\d*)/g;
  let match: RegExpExecArray | null;
  let id = 0;
  while ((match = tokenRe.exec(body)) !== null) {
    const [, sym, countStr] = match;
    if (!sym) continue;
    const count = countStr ? parseInt(countStr, 10) : 1;
    for (let i = 0; i < count; i++) {
      atoms.push({ id: id++, element: sym as ElementSymbol, charge: 0 });
    }
  }

  if (charge !== 0 && atoms.length > 0) {
    const last = atoms[atoms.length - 1];
    if (last) last.charge = charge;
  }

  return atoms;
}
