// HoneyBeeOS - Honey Artifact Model
// OS concept: Immutable derived results / build artifacts
// Browser primitive: IndexedDB (via Honeycomb)
// Kernel state: honey registry
// Failure: deduplication hash check, missing cells handled gracefully
// UI observation: honey.produced pheromone

import { CellType, Namespaces } from '../kernel/constants.js';
import { PheromoneType } from '../ipc/pheromones.js';

export class HoneyArtifact {
  constructor(data) {
    this.id = data.id || crypto.randomUUID();
    this.hash = data.hash;
    this.producerBeeId = data.producerBeeId;
    this.originatingTaskId = data.originatingTaskId;
    this.createdAt = data.createdAt || Date.now();
    this.size = data.size || 0;
    this.type = data.type || 'RESULT';
    this.metadata = data.metadata || {};
    this.cellPath = data.cellPath || null; // path in Honeycomb
  }
}

export class HoneyStore {
  #comb = null;
  #bus = null;
  #index = new Map(); // hash → artifact

  init(comb, bus) {
    this.#comb = comb;
    this.#bus = bus;
  }

  async produceHoney({ content, type = 'RESULT', producerBeeId, originatingTaskId, metadata = {} }) {
    if (!content) throw new Error('Honey requires content');

    // Compute hash
    let bytes;
    if (typeof content === 'string') {
      bytes = new TextEncoder().encode(content);
    } else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) {
      bytes = content;
    } else {
      bytes = new TextEncoder().encode(JSON.stringify(content));
    }
    const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');

    // Deduplication: check if we already have an artifact with this hash
    if (this.#index.has(hash)) {
      const existing = this.#index.get(hash);
      return existing;
    }

    // Also check via Honeycomb
    const existing = await this.#comb.findByHash(hash);
    if (existing.length > 0) {
      const artifact = new HoneyArtifact({
        id: crypto.randomUUID(),
        hash,
        producerBeeId,
        originatingTaskId,
        size: existing[0].size,
        type,
        metadata,
        cellPath: existing[0].path
      });
      this.#index.set(hash, artifact);
      return artifact;
    }

    // Store in Honeycomb
    const cellPath = `${Namespaces.TASKS}/honey/${hash}`;
    const size = bytes instanceof ArrayBuffer ? bytes.byteLength : (ArrayBuffer.isView(bytes) ? bytes.byteLength : bytes.length);

    let cellType = CellType.JSON;
    if (typeof content === 'string') cellType = CellType.TEXT;
    else if (content instanceof ArrayBuffer || ArrayBuffer.isView(content)) cellType = CellType.BINARY;

    const cell = await this.#comb.createCell(cellPath, cellType, content, {
      honeyType: type,
      producerBeeId,
      originatingTaskId,
      ...metadata
    });

    const artifact = new HoneyArtifact({
      hash,
      producerBeeId,
      originatingTaskId,
      size: cell.size,
      type,
      metadata,
      cellPath
    });
    this.#index.set(hash, artifact);

    this.#bus?.emit(PheromoneType.HONEY_PRODUCED, { artifact }, 'honey-store');
    return artifact;
  }

  async getHoney(id) {
    for (const a of this.#index.values()) {
      if (a.id === id) {
        const result = await this.#comb.readCell(a.cellPath);
        return { artifact: a, content: result?.content ?? null };
      }
    }
    return null;
  }

  async findHoney(predicate) {
    const all = [...this.#index.values()];
    return all.filter(predicate);
  }

  listAll() {
    return [...this.#index.values()];
  }
}
