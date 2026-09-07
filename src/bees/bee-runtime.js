// HoneyBeeOS - Bee Runtime
// OS concept: Process management / worker lifecycle
// Browser primitive: Web Workers
// Kernel state: bee registry, heartbeat timers
// Failure: heartbeat timeout marks bee failed, emits pheromone
// UI observation: bee pheromones

import { BeeState, BeeType, WorkerCommand, WorkerMessage, HEARTBEAT_INTERVAL, HEARTBEAT_TIMEOUT, MAX_BEES } from '../kernel/constants.js';
import { PheromoneType } from '../ipc/pheromones.js';
import { kernelLog } from '../kernel/logger.js';

export class Bee {
  constructor({ id, type = BeeType.WORKER, workerUrl, metadata = {} }) {
    this.id = id || crypto.randomUUID();
    this.type = type;
    this.state = BeeState.CREATED;
    this.createdAt = Date.now();
    this.startedAt = null;
    this.completedTasks = 0;
    this.failureCount = 0;
    this.heartbeat = null;
    this.currentTask = null;
    this.metadata = metadata;
    this.workerUrl = workerUrl;
    this._worker = null;
    this._readyResolver = null;
    this._pendingTasks = new Map(); // taskId → { resolve, reject }
  }

  toSnapshot() {
    return {
      id: this.id,
      type: this.type,
      state: this.state,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedTasks: this.completedTasks,
      failureCount: this.failureCount,
      heartbeat: this.heartbeat,
      currentTask: this.currentTask,
      metadata: this.metadata
    };
  }
}

export class BeeRuntime {
  #bees = new Map();
  #bus = null;
  #heartbeatTimers = new Map();
  #workerBaseUrl = './workers/';

  init(bus) {
    this.#bus = bus;
  }

  setWorkerBaseUrl(url) {
    this.#workerBaseUrl = url;
  }

  async spawnBee({ type = BeeType.WORKER, metadata = {}, workerScript = null } = {}) {
    if (this.#bees.size >= MAX_BEES) {
      throw new Error(`Maximum bee count (${MAX_BEES}) reached`);
    }

    const id = crypto.randomUUID();
    let workerUrl;
    if (type === BeeType.SCOUT) {
      workerUrl = this.#workerBaseUrl + 'scout.worker.js';
    } else {
      workerUrl = workerScript || this.#workerBaseUrl + 'bee.worker.js';
    }

    const bee = new Bee({ id, type, workerUrl, metadata });
    this.#bees.set(id, bee);

    kernelLog.info('BeeRuntime', `Spawning bee ${id} (${type})`);

    try {
      await this.#startWorker(bee);
    } catch (err) {
      bee.state = BeeState.FAILED;
      bee.failureCount++;
      this.#bus?.emit(PheromoneType.BEE_FAILED, { bee: bee.toSnapshot(), error: err.message }, 'bee-runtime');
      throw err;
    }

    this.#bus?.emit(PheromoneType.BEE_CREATED, { bee: bee.toSnapshot() }, 'bee-runtime');
    return bee;
  }

  async #startWorker(bee) {
    return new Promise((resolve, reject) => {
      try {
        const worker = new Worker(bee.workerUrl, { type: 'classic' });
        bee._worker = worker;

        const readyTimeout = setTimeout(() => {
          reject(new Error(`Bee ${bee.id} did not become ready in time`));
        }, 10000);

        worker.onmessage = (event) => {
          this.#handleWorkerMessage(bee, event.data);
          if (event.data.type === WorkerMessage.READY) {
            clearTimeout(readyTimeout);
            bee.state = BeeState.IDLE;
            bee.startedAt = Date.now();
            bee.heartbeat = Date.now();
            this.#startHeartbeat(bee);
            this.#bus?.emit(PheromoneType.BEE_READY, { bee: bee.toSnapshot() }, 'bee-runtime');
            resolve(bee);
          }
        };

        worker.onerror = (err) => {
          clearTimeout(readyTimeout);
          kernelLog.error('BeeRuntime', `Worker error in bee ${bee.id}`, err.message);
          this.#handleBeeFailure(bee, err.message || 'Worker error');
          if (bee.state === BeeState.CREATED) reject(err);
        };

        worker.postMessage({ type: WorkerCommand.INIT, payload: { beeId: bee.id } });
      } catch (err) {
        reject(err);
      }
    });
  }

  #handleWorkerMessage(bee, data) {
    const { type, payload } = data;

    switch (type) {
      case WorkerMessage.PONG:
        bee.heartbeat = Date.now();
        break;

      case WorkerMessage.STARTED:
        bee.state = BeeState.WORKING;
        bee.currentTask = payload?.taskId || null;
        this.#bus?.emit(PheromoneType.BEE_STARTED, { bee: bee.toSnapshot(), taskId: payload?.taskId }, 'bee-runtime');
        break;

      case WorkerMessage.PROGRESS:
        this.#bus?.emit(PheromoneType.BEE_PROGRESS, {
          beeId: bee.id,
          taskId: payload?.taskId,
          progress: payload?.progress,
          message: payload?.message
        }, 'bee-runtime');
        break;

      case WorkerMessage.RESULT: {
        const { taskId, result } = payload;
        const pending = bee._pendingTasks.get(taskId);
        if (pending) {
          pending.resolve(result);
          bee._pendingTasks.delete(taskId);
        }
        bee.completedTasks++;
        bee.currentTask = null;
        bee.state = BeeState.IDLE;
        this.#bus?.emit(PheromoneType.BEE_COMPLETED, { bee: bee.toSnapshot(), taskId, result }, 'bee-runtime');
        break;
      }

      case WorkerMessage.ERROR: {
        const { taskId, error } = payload;
        const pending = bee._pendingTasks.get(taskId);
        if (pending) {
          pending.reject(new Error(error));
          bee._pendingTasks.delete(taskId);
        }
        bee.failureCount++;
        bee.currentTask = null;
        bee.state = BeeState.IDLE;
        this.#bus?.emit(PheromoneType.BEE_FAILED, { bee: bee.toSnapshot(), taskId, error }, 'bee-runtime');
        break;
      }

      case WorkerMessage.EXITED:
        bee.state = BeeState.TERMINATED;
        this.#cleanupBee(bee);
        this.#bus?.emit(PheromoneType.BEE_TERMINATED, { bee: bee.toSnapshot() }, 'bee-runtime');
        break;
    }
  }

  #startHeartbeat(bee) {
    const timer = setInterval(() => {
      if (!this.#bees.has(bee.id)) {
        clearInterval(timer);
        return;
      }
      const timeSinceHeartbeat = Date.now() - (bee.heartbeat || 0);
      if (timeSinceHeartbeat > HEARTBEAT_TIMEOUT) {
        kernelLog.warn('BeeRuntime', `Bee ${bee.id} heartbeat timeout`);
        this.#handleBeeFailure(bee, 'Heartbeat timeout');
      } else {
        try { bee._worker?.postMessage({ type: WorkerCommand.PING }); } catch (_) {}
      }
    }, HEARTBEAT_INTERVAL);
    this.#heartbeatTimers.set(bee.id, timer);
  }

  #handleBeeFailure(bee, reason) {
    if (bee.state === BeeState.FAILED || bee.state === BeeState.TERMINATED) return;
    bee.state = BeeState.FAILED;
    bee.failureCount++;
    kernelLog.error('BeeRuntime', `Bee ${bee.id} failed: ${reason}`);

    // Reject pending tasks
    for (const [taskId, pending] of bee._pendingTasks) {
      pending.reject(new Error(`Bee failed: ${reason}`));
    }
    bee._pendingTasks.clear();

    this.#cleanupBee(bee);
    this.#bus?.emit(PheromoneType.BEE_DIED, { bee: bee.toSnapshot(), reason }, 'bee-runtime');
  }

  #cleanupBee(bee) {
    const timer = this.#heartbeatTimers.get(bee.id);
    if (timer) { clearInterval(timer); this.#heartbeatTimers.delete(bee.id); }
    try { bee._worker?.terminate(); } catch (_) {}
  }

  async executeOnBee(beeId, taskId, taskType, taskPayload, timeout = 60000) {
    const bee = this.#bees.get(beeId);
    if (!bee) throw new Error(`Bee ${beeId} not found`);
    if (bee.state !== BeeState.IDLE) throw new Error(`Bee ${beeId} is not idle (state: ${bee.state})`);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        bee._pendingTasks.delete(taskId);
        bee.state = BeeState.IDLE;
        bee.currentTask = null;
        reject(new Error(`Task ${taskId} timed out`));
      }, timeout);

      bee._pendingTasks.set(taskId, {
        resolve: (result) => { clearTimeout(timer); resolve(result); },
        reject: (err) => { clearTimeout(timer); reject(err); }
      });

      bee._worker.postMessage({
        type: WorkerCommand.EXECUTE,
        payload: { taskId, taskType, taskPayload }
      });
    });
  }

  async killBee(id) {
    const bee = this.#bees.get(id);
    if (!bee) throw new Error(`Bee ${id} not found`);
    this.#cleanupBee(bee);
    bee.state = BeeState.TERMINATED;
    this.#bees.delete(id);
    this.#bus?.emit(PheromoneType.BEE_TERMINATED, { bee: bee.toSnapshot() }, 'bee-runtime');
  }

  async pauseBee(id) {
    const bee = this.#bees.get(id);
    if (!bee || !bee._worker) throw new Error(`Bee ${id} not found`);
    bee._worker.postMessage({ type: WorkerCommand.PAUSE });
    bee.state = BeeState.PAUSED;
    this.#bus?.emit(PheromoneType.BEE_PAUSED, { bee: bee.toSnapshot() }, 'bee-runtime');
  }

  async resumeBee(id) {
    const bee = this.#bees.get(id);
    if (!bee || !bee._worker) throw new Error(`Bee ${id} not found`);
    bee._worker.postMessage({ type: WorkerCommand.RESUME });
    bee.state = BeeState.IDLE;
    this.#bus?.emit(PheromoneType.BEE_RESUMED, { bee: bee.toSnapshot() }, 'bee-runtime');
  }

  getBee(id) {
    return this.#bees.get(id) || null;
  }

  listBees() {
    return [...this.#bees.values()].map(b => b.toSnapshot());
  }

  getIdleBees() {
    return [...this.#bees.values()].filter(b => b.state === BeeState.IDLE);
  }

  getBeeCount() {
    return this.#bees.size;
  }

  getMetrics() {
    const bees = [...this.#bees.values()];
    return {
      total: bees.length,
      idle: bees.filter(b => b.state === BeeState.IDLE).length,
      working: bees.filter(b => b.state === BeeState.WORKING).length,
      failed: bees.filter(b => b.state === BeeState.FAILED).length,
      terminated: bees.filter(b => b.state === BeeState.TERMINATED).length,
      paused: bees.filter(b => b.state === BeeState.PAUSED).length
    };
  }

  async terminateAll() {
    for (const bee of this.#bees.values()) {
      try { this.#cleanupBee(bee); } catch (_) {}
    }
    this.#bees.clear();
  }
}
