// HoneyBeeOS - Hive Kernel
// The central operating system coordinator.
// OS concept: Kernel / OS lifecycle manager
// Browser primitive: ES modules, orchestrates all subsystems
// Kernel state: hive state, uptime, services, bees, tasks
// Failure: caught and structured as kernel events
// UI observation: reads hive.status(), subscribes to pheromones

import { HiveState, HIVE_VERSION, BeeType, TaskPriority } from './constants.js';
import { kernelLog } from './logger.js';
import { PheromoneBus, PheromoneType } from '../ipc/pheromones.js';
import { BeeRuntime } from '../bees/bee-runtime.js';
import { Scheduler } from '../bees/scheduler.js';
import { ScoutManager } from '../bees/scout.js';
import { Comb } from '../storage/honeycomb.js';
import { HoneyStore } from '../storage/honey.js';
import { Guard } from '../security/guard.js';
import { AppRuntime } from '../apps/app-runtime.js';
import { HiveApp } from '../apps/app-sdk.js';

export class Hive {
  #state = HiveState.STOPPED;
  #startTime = null;
  #errors = [];
  #services = new Map();

  // Subsystems
  bus = null;
  beeRuntime = null;
  scheduler = null;
  scoutManager = null;
  comb = null;
  honeyStore = null;
  guard = null;
  appRuntime = null;

  // Adaptive / chaos config
  #chaosMode = false;

  async start() {
    if (this.#state === HiveState.RUNNING) {
      kernelLog.warn('Hive', 'start() called but already running');
      return;
    }
    if (this.#state === HiveState.INITIALIZING) {
      kernelLog.warn('Hive', 'start() called but already initializing');
      return;
    }

    this.#state = HiveState.INITIALIZING;
    this.#startTime = Date.now();

    console.log('\nHONEYBEEOS');
    console.log('Hive initializing...');
    kernelLog.info('Hive', 'Hive initializing...', { version: HIVE_VERSION });

    try {
      // 1. Pheromone bus first (needed by all)
      this.bus = new PheromoneBus();

      // 2. Honeycomb storage
      this.comb = new Comb();
      await this.comb.init(this.bus);
      kernelLog.info('Hive', 'Honeycomb storage ready');

      // 3. Honey store
      this.honeyStore = new HoneyStore();
      this.honeyStore.init(this.comb, this.bus);
      kernelLog.info('Hive', 'Honey store ready');

      // 4. Guard (security)
      this.guard = new Guard();
      await this.guard.init(this.bus);
      kernelLog.info('Hive', 'Guard security ready');

      // 5. Bee runtime
      this.beeRuntime = new BeeRuntime();
      this.beeRuntime.init(this.bus);
      this.beeRuntime.setWorkerBaseUrl(this.#resolveWorkerBase());
      kernelLog.info('Hive', 'Bee runtime ready');

      // 6. Scheduler
      this.scheduler = new Scheduler();
      this.scheduler.init(this.beeRuntime, this.bus, this.honeyStore);
      this.scheduler.start();
      kernelLog.info('Hive', 'Scheduler ready');

      // 7. Scout manager
      this.scoutManager = new ScoutManager();
      this.scoutManager.init(this.beeRuntime, this.comb);
      kernelLog.info('Hive', 'Scout manager ready');

      // 8. App runtime
      this.appRuntime = new AppRuntime();
      await this.appRuntime.init(this.bus, this.guard);
      kernelLog.info('Hive', 'App runtime ready');

      // 9. Seed initial worker bees
      await this.#seedWorkers(3);

      // 10. Mark running
      this.#state = HiveState.RUNNING;
      console.log('Queen initializing...');
      kernelLog.info('Hive', 'Queen initializing...');

      // Register services
      this.#registerService('honeycomb', 'running');
      this.#registerService('scheduler', 'running');
      this.#registerService('guard', 'running');
      this.#registerService('app-runtime', 'running');

      this.bus.emit(PheromoneType.HIVE_STARTED, { version: HIVE_VERSION }, 'hive');

      console.log('Hive ready.');
      kernelLog.info('Hive', 'Hive ready.', { version: HIVE_VERSION, startTime: this.#startTime });

    } catch (err) {
      this.#state = HiveState.ERROR;
      this.#recordError(err);
      kernelLog.error('Hive', 'Hive failed to start', err.message);
      console.error('Hive startup failed:', err);
      throw err;
    }
  }

  async #seedWorkers(count) {
    const spawns = [];
    for (let i = 0; i < count; i++) {
      spawns.push(this.beeRuntime.spawnBee({ type: BeeType.WORKER, metadata: { seeded: true } }).catch(e => {
        kernelLog.warn('Hive', `Failed to seed worker bee: ${e.message}`);
      }));
    }
    await Promise.allSettled(spawns);
    kernelLog.info('Hive', `Seeded ${count} worker bees`);
  }

  #resolveWorkerBase() {
    try {
      // hive.js lives in src/kernel; workers are at project root /workers
      const url = new URL('../../workers/', import.meta.url);
      return url.href;
    } catch (_) {
      return './workers/';
    }
  }

  async shutdown() {
    if (this.#state !== HiveState.RUNNING) return;
    this.#state = HiveState.SHUTTING_DOWN;
    kernelLog.info('Hive', 'Hive shutting down...');

    this.bus?.emit(PheromoneType.HIVE_SHUTDOWN, {}, 'hive');
    this.scheduler?.stop();
    await this.beeRuntime?.terminateAll();

    this.#state = HiveState.STOPPED;
    kernelLog.info('Hive', 'Hive stopped');
    this.bus?.destroy();
  }

  status() {
    return {
      state: this.#state,
      version: HIVE_VERSION,
      uptime: this.#startTime ? Date.now() - this.#startTime : 0,
      bees: this.beeRuntime?.getMetrics() || {},
      tasks: this.scheduler?.getMetrics() || {},
      services: Object.fromEntries(this.#services),
      errorCount: this.#errors.length
    };
  }

  getMetrics() {
    return {
      hive: this.status(),
      bees: this.beeRuntime?.listBees() || [],
      queue: this.scheduler?.getQueueSnapshot() || [],
      tasks: this.scheduler?.listTasks() || [],
      recentEvents: this.bus?.getHistory({ limit: 50 }) || [],
      honey: this.honeyStore?.listAll() || [],
      storage: null // populated async by callers
    };
  }

  colonyHealth() {
    const beeMetrics = this.beeRuntime?.getMetrics() || {};
    const schedulerMetrics = this.scheduler?.getMetrics() || {};
    const failureRate = schedulerMetrics.submitted > 0
      ? schedulerMetrics.failed / schedulerMetrics.submitted
      : 0;
    return {
      healthy: this.#state === HiveState.RUNNING,
      failureRate,
      workerUtilization: beeMetrics.total > 0 ? beeMetrics.working / beeMetrics.total : 0,
      queueDepth: schedulerMetrics.queueDepth || 0,
      beeCount: beeMetrics.total || 0,
      idleBees: beeMetrics.idle || 0
    };
  }

  colonyMetrics() { return this.beeRuntime?.getMetrics() || {}; }
  schedulerMetrics() { return this.scheduler?.getMetrics() || {}; }

  // High-level APIs
  async spawnBee(task) { return this.beeRuntime?.spawnBee(task); }
  async killBee(id) { return this.beeRuntime?.killBee(id); }
  async pauseBee(id) { return this.beeRuntime?.pauseBee(id); }
  async resumeBee(id) { return this.beeRuntime?.resumeBee(id); }
  getBee(id) { return this.beeRuntime?.getBee(id)?.toSnapshot() || null; }
  listBees() { return this.beeRuntime?.listBees() || []; }

  submitTask(options) { return this.scheduler?.submit(options); }
  cancelTask(id) { return this.scheduler?.cancelTask(id); }
  getTask(id) { return this.scheduler?.getTask(id)?.toSnapshot() || null; }
  listTasks(filter) { return this.scheduler?.listTasks(filter) || []; }

  createSwarm(options) { return this.scheduler?.createSwarm(options); }

  async scout(query, options) { return this.scoutManager?.scout(query, options); }

  async requestCapability(req) { return this.guard?.requestCapability(req); }
  async grantCapability(req) { return this.guard?.grantCapability(req); }

  async produceHoney(options) { return this.honeyStore?.produceHoney(options); }
  async getHoney(id) { return this.honeyStore?.getHoney(id); }
  async findHoney(predicate) { return this.honeyStore?.findHoney(predicate); }

  emit(type, payload, source) { return this.bus?.emit(type, payload, source); }
  on(type, handler) { this.bus?.on(type, handler); }
  once(type, handler) { this.bus?.once(type, handler); }
  off(type, handler) { this.bus?.off(type, handler); }

  // App runtime
  async installApp(manifest) { return this.appRuntime?.install(manifest); }
  async uninstallApp(id) { return this.appRuntime?.uninstall(id); }
  async startApp(id, mountPoint, hiveAPI) { return this.appRuntime?.start(id, mountPoint, hiveAPI); }
  async stopApp(id) { return this.appRuntime?.stop(id); }
  listApps() { return this.appRuntime?.list() || []; }
  getAppManifest(id) { return this.appRuntime?.getManifest(id); }

  /**
   * Application SDK — primary developer-facing API.
   *
   *   const calculator = hive.app({ id: "calculator", name: "Calculator" });
   *   calculator.work("calculate", ({ a, operator, b }) => { ... });
   *   const result = await calculator.run("calculate", { a: 10, operator: "+", b: 5 });
   */
  app(options) {
    return new HiveApp(options, this.scheduler, this.honeyStore, this.bus);
  }

  // File access
  async importFile() {
    const hasAPI = 'showOpenFilePicker' in window;
    if (!hasAPI) return this.#importFileFallback();
    try {
      const [fileHandle] = await window.showOpenFilePicker();
      const file = await fileHandle.getFile();
      return this.#processImportedFile(file);
    } catch (err) {
      if (err.name === 'AbortError') return null;
      throw err;
    }
  }

  async #importFileFallback() {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.onchange = async () => {
        const file = input.files[0];
        if (file) resolve(await this.#processImportedFile(file));
        else resolve(null);
      };
      input.click();
    });
  }

  async #processImportedFile(file) {
    const content = await file.text();
    const path = `${import.meta?.url ? 'documents' : 'documents'}/${file.name}`;
    const cell = await this.comb.createCell(path, 'TEXT', content, {
      fileName: file.name, fileSize: file.size, importedAt: Date.now()
    });
    return { cell, content };
  }

  async exportFile(path, filename) {
    const result = await this.comb.readCell(path);
    if (!result) throw new Error(`Cell not found: ${path}`);
    const content = typeof result.content === 'string'
      ? result.content
      : JSON.stringify(result.content, null, 2);
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename || path.split('/').pop();
    a.click();
    URL.revokeObjectURL(url);
  }

  // Chaos mode (dev only)
  enableChaosMode() {
    if (location.hostname !== 'localhost' && !location.hostname.includes('127.0.0.1')) {
      console.warn('Chaos mode is only available in development');
      return false;
    }
    this.#chaosMode = true;
    kernelLog.warn('Hive', 'CHAOS MODE ENABLED');
    return true;
  }

  disableChaosMode() { this.#chaosMode = false; }
  isChaosMode() { return this.#chaosMode; }

  async chaosKillBee(beeId) {
    if (!this.#chaosMode) throw new Error('Chaos mode not enabled');
    await this.killBee(beeId);
    this.bus?.emit(PheromoneType.CHAOS_BEE_KILLED, { beeId }, 'chaos');
    kernelLog.warn('Hive', `Chaos: killed bee ${beeId}`);
  }

  async chaosKillRandomBees(fraction = 0.2) {
    if (!this.#chaosMode) throw new Error('Chaos mode not enabled');
    const bees = this.listBees().filter(b => b.state !== 'TERMINATED' && b.state !== 'FAILED');
    const count = Math.max(1, Math.floor(bees.length * fraction));
    for (let i = 0; i < count && i < bees.length; i++) {
      await this.chaosKillBee(bees[i].id).catch(() => {});
    }
  }

  #registerService(name, state) {
    this.#services.set(name, { name, state, startedAt: Date.now() });
    this.bus?.emit(PheromoneType.SERVICE_STARTED, { name, state }, 'hive');
  }

  #recordError(err) {
    this.#errors.push({
      id: crypto.randomUUID(),
      message: err.message,
      stack: err.stack,
      timestamp: Date.now()
    });
    this.bus?.emit(PheromoneType.HIVE_ERROR, { error: err.message }, 'hive');
  }

  getErrors() { return [...this.#errors]; }
  getLogs(options) { return kernelLog.getLogs(options); }
}

// Singleton hive instance
export const hive = new Hive();
