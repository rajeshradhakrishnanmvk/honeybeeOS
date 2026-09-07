// HoneyBeeOS - Bee Factory
// OS concept: Process factory / code generation layer
// Turns developer-defined work functions into schedulable Bee tasks.
// The developer never sees postMessage, Worker, or the bee protocol.
//
// Architecture:
//   work("calculate", fn)
//       ↓
//   BeeFactory.register(appId, workName, fn)
//       ↓
//   scheduler.submit({ type: "app:<appId>:<workName>", payload })
//       ↓
//   bee.worker.js executes fn via serialized work registry
//
// Work functions are kept in the main thread registry.
// The bee.worker.js asks the main thread to execute them via a
// "WORK_EXECUTE" message, keeping functions out of the worker and
// avoiding serialization of closures.

import { kernelLog } from '../kernel/logger.js';

export class BeeFactory {
  // appId:workName → fn
  #registry = new Map();

  /**
   * Register a work function for an application.
   * @param {string} appId
   * @param {string} workName
   * @param {Function} fn  async (input, context) => result
   */
  register(appId, workName, fn) {
    if (typeof fn !== 'function') throw new Error(`Work handler must be a function`);
    const key = `${appId}:${workName}`;
    this.#registry.set(key, fn);
    kernelLog.info('BeeFactory', `Registered work: ${key}`);
  }

  /**
   * Returns the task type string for a given app/work pair.
   * This is what gets submitted to the scheduler.
   */
  taskType(appId, workName) {
    return `app:${appId}:${workName}`;
  }

  /**
   * Execute registered work directly in the main thread.
   * Called by the bee runtime when it receives an app:* task type.
   */
  async execute(appId, workName, input, context = {}) {
    const key = `${appId}:${workName}`;
    const fn = this.#registry.get(key);
    if (!fn) throw new Error(`No work registered for: ${key}`);
    return fn(input, context);
  }

  has(appId, workName) {
    return this.#registry.has(`${appId}:${workName}`);
  }

  listWork(appId) {
    return [...this.#registry.keys()]
      .filter(k => k.startsWith(`${appId}:`))
      .map(k => k.slice(appId.length + 1));
  }
}

// Singleton factory shared across all apps
export const beeFactory = new BeeFactory();
