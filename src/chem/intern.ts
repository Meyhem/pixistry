import { canonicalize } from './canonical';
import { computeProperties } from './properties';
import type { MoleculeGraph, MoleculeSpec } from './types';

export class InternedPool {
  private byKey = new Map<string, number>();
  private specs: MoleculeSpec[] = [];

  intern(graph: MoleculeGraph): MoleculeSpec {
    const { key, graph: canonGraph } = canonicalize(graph);
    const existingId = this.byKey.get(key);
    if (existingId !== undefined) {
      const existing = this.specs[existingId];
      if (existing) return existing;
    }

    const specId = this.specs.length;
    const properties = computeProperties(canonGraph);
    const spec: MoleculeSpec = { specId, graph: canonGraph, canonicalKey: key, properties };
    this.specs.push(spec);
    this.byKey.set(key, specId);
    return spec;
  }

  get(specId: number): MoleculeSpec {
    const spec = this.specs[specId];
    if (!spec) throw new Error(`InternedPool: no spec with id ${specId}`);
    return spec;
  }

  getByKey(key: string): MoleculeSpec | undefined {
    const id = this.byKey.get(key);
    return id === undefined ? undefined : this.specs[id];
  }

  get size(): number {
    return this.specs.length;
  }
}
