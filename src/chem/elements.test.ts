import { describe, expect, it } from 'vitest';
import { ELEMENT_SYMBOLS, ELEMENTS, getElement } from './elements';

describe('elements table', () => {
  it('contains exactly the 15 v1 elements', () => {
    expect(ELEMENT_SYMBOLS).toHaveLength(15);
    expect(new Set(ELEMENT_SYMBOLS).size).toBe(15);
  });

  it('has plausible field values for every element', () => {
    for (const symbol of ELEMENT_SYMBOLS) {
      const el = ELEMENTS[symbol];
      expect(el.symbol).toBe(symbol);
      expect(el.Z).toBeGreaterThan(0);
      expect(el.molarMass).toBeGreaterThan(0);
      expect(el.electronegativity).toBeGreaterThan(0);
      expect(el.electronegativity).toBeLessThan(4.5);
      expect(el.covalentRadius).toBeGreaterThan(0);
      expect(el.standardValences.length).toBeGreaterThan(0);
      expect(el.atomizationEnthalpy).toBeGreaterThan(0);
      if (el.ionicRadius !== undefined) {
        expect(el.ionicRadius).toBeGreaterThan(0);
      }
    }
  });

  it('flags metals correctly for the alkali/alkaline-earth/transition set', () => {
    for (const sym of ['Na', 'Mg', 'Al', 'K', 'Ca', 'Fe', 'Cu', 'Zn', 'Ag'] as const) {
      expect(ELEMENTS[sym].isMetal).toBe(true);
    }
    for (const sym of ['H', 'C', 'N', 'O', 'S', 'Cl'] as const) {
      expect(ELEMENTS[sym].isMetal).toBe(false);
    }
  });

  it('getElement returns the same object as ELEMENTS lookup', () => {
    expect(getElement('O')).toBe(ELEMENTS.O);
  });

  it('getElement throws on unknown symbol', () => {
    // @ts-expect-error intentionally invalid symbol for the runtime guard test
    expect(() => getElement('Xx')).toThrow();
  });
});
