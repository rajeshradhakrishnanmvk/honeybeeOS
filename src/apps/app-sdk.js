// HoneyBeeOS - Application SDK
// OS concept: Application Runtime / developer-facing process API
// Browser primitive: Wraps scheduler, beeFactory, honeyStore
//
// Developer-facing API:
//
//   const app = hive.app({ id: "calculator", name: "Calculator" });
//
//   app.work("calculate", ({ a, operator, b }) => { ... });
//
//   const result = await app.run("calculate", { a: 10, operator: "+", b: 5 });
//
//   const results = await app.map("calculate", [{ a: 1, operator: "+", b: 2 }, ...]);
//
// The developer never creates Workers, submits tasks, or manages Bee lifecycle.

import { beeFactory } from './bee-factory.js';
import { TaskPriority } from '../kernel/constants.js';
import { kernelLog } from '../kernel/logger.js';

const DEFAULT_WORK_OPTIONS = {
  concurrency: 1,
  timeout: 30000,
  retries: 1,
  priority: TaskPriority.NORMAL
};

const PRIORITY_MAP = {
  low: TaskPriority.LOW,
  normal: TaskPriority.NORMAL,
  high: TaskPriority.HIGH,
  critical: TaskPriority.CRITICAL
};

export class HiveApp {
  #id;
  #name;
  #version;
  #scheduler;
  #honeyStore;
  #bus;
  #workOptions = new Map();  // workName → options
  #started = false;

  constructor({ id, name, version = '1.0.0' }, scheduler, honeyStore, bus) {
    if (!id) throw new Error('App id is required');
    if (!name) throw new Error('App name is required');
    this.#id = id;
    this.#name = name;
    this.#version = version;
    this.#scheduler = scheduler;
    this.#honeyStore = honeyStore;
    this.#bus = bus;
  }

  get id() { return this.#id; }
  get name() { return this.#name; }
  get version() { return this.#version; }

  /**
   * Level 1 — Beginner
   *   app.work("calculate", fn)
   *
   * Level 2 — Advanced
   *   app.work("calculate", fn, { concurrency: 4, timeout: 5000, retries: 2, priority: "high" })
   */
  work(workName, fn, options = {}) {
    if (typeof workName !== 'string' || !workName) throw new Error('workName must be a non-empty string');
    if (typeof fn !== 'function') throw new Error('work handler must be a function');

    const resolvedOptions = {
      ...DEFAULT_WORK_OPTIONS,
      ...options,
      priority: typeof options.priority === 'string'
        ? (PRIORITY_MAP[options.priority] ?? TaskPriority.NORMAL)
        : (options.priority ?? TaskPriority.NORMAL)
    };

    beeFactory.register(this.#id, workName, fn);
    this.#workOptions.set(workName, resolvedOptions);

    kernelLog.info('HiveApp', `[${this.#id}] work registered: ${workName}`);
    return this;
  }

  /**
   * Run a single work item and return the result.
   * Returns a Promise that resolves with the computed result.
   */
  async run(workName, input = {}) {
    this.#assertStarted();
    this.#assertWork(workName);

    const opts = this.#workOptions.get(workName);
    const taskType = beeFactory.taskType(this.#id, workName);

    return new Promise((resolve, reject) => {
      const task = this.#scheduler.submit({
        type: taskType,
        payload: { appId: this.#id, workName, input },
        priority: opts.priority,
        timeout: opts.timeout,
        retryPolicy: { maxRetries: opts.retries },
        metadata: { appId: this.#id, workName }
      });

      // Poll for completion
      const interval = setInterval(() => {
        const current = this.#scheduler.getTask(task.id);
        if (!current) {
          clearInterval(interval);
          reject(new Error(`Task ${task.id} not found or expired`));
          return;
        }
        if (current.state === 'COMPLETED') {
          clearInterval(interval);
          resolve(current.result);
        } else if (current.state === 'FAILED' || current.state === 'CANCELLED') {
          clearInterval(interval);
          reject(new Error(current.error || `Task ${current.state}`));
        }
      }, 50);
    });
  }

  /**
   * Map a work function over an array of inputs.
   * Returns a Promise that resolves with an array of results in order.
   * HoneyBeeOS will use available bees in parallel automatically.
   */
  async map(workName, inputs = []) {
    this.#assertStarted();
    this.#assertWork(workName);
    return Promise.all(inputs.map(input => this.run(workName, input)));
  }

  /**
   * Store data in the Honey store, scoped to this app.
   */
  async store(key, value) {
    return this.#honeyStore?.produceHoney({
      content: value,
      type: `app:${this.#id}:store`,
      producerBeeId: null,
      originatingTaskId: null,
      metadata: { appId: this.#id, key }
    });
  }

  /**
   * Start the application.
   */
  start() {
    this.#started = true;
    kernelLog.info('HiveApp', `[${this.#id}] started`);
    return this;
  }

  /**
   * Stop the application.
   */
  stop() {
    this.#started = false;
    kernelLog.info('HiveApp', `[${this.#id}] stopped`);
    return this;
  }

  isStarted() { return this.#started; }

  listWork() { return beeFactory.listWork(this.#id); }

  toManifest() {
    return {
      id: this.#id,
      name: this.#name,
      version: this.#version,
      work: this.listWork(),
      started: this.#started
    };
  }

  #assertStarted() {
    if (!this.#started) throw new Error(`App "${this.#id}" is not started. Call app.start() first.`);
  }

  #assertWork(workName) {
    if (!beeFactory.has(this.#id, workName)) {
      throw new Error(`No work named "${workName}" registered on app "${this.#id}"`);
    }
  }
}
