// HoneyBeeOS - Scout Bee Manager
// OS concept: Discovery/search workers
// Browser primitive: Web Workers (via Bee Runtime)
// Kernel state: scout results
// Failure: scout terminated after search; failures reported

import { BeeType } from '../kernel/constants.js';
import { kernelLog } from '../kernel/logger.js';

export class ScoutManager {
  #beeRuntime = null;
  #comb = null;

  init(beeRuntime, comb) {
    this.#beeRuntime = beeRuntime;
    this.#comb = comb;
  }

  async scout(query, options = {}) {
    kernelLog.info('ScoutManager', `Scout query: ${JSON.stringify(query)}`);

    // Load cells to search
    const cells = await this.#comb.listCells(options.namespace || null);

    // Spawn a scout bee
    const bee = await this.#beeRuntime.spawnBee({ type: BeeType.SCOUT });

    try {
      const taskId = crypto.randomUUID();
      const result = await this.#beeRuntime.executeOnBee(
        bee.id,
        taskId,
        'scout:search',
        { cells: cells.map(c => c.toRecord ? c.toRecord() : c), query, options },
        30000
      );
      return result;
    } finally {
      // Scouts are disposable
      try { await this.#beeRuntime.killBee(bee.id); } catch (_) {}
    }
  }

  async scoutConcurrent(queries) {
    return Promise.allSettled(queries.map(q => this.scout(q.query, q.options || {})));
  }
}
