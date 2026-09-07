// HoneyBeeOS - Task Scheduler
// OS concept: Process scheduler / work queue
// Browser primitive: JS data structures + Bee Runtime
// Kernel state: task queue, swarms, metrics
// Failure: task timeout, bee failure → requeue if retryable
// UI observation: task pheromones

import { TaskState, TaskPriority, BeeType, MAX_TASK_TIMEOUT, MAX_RETRIES } from '../kernel/constants.js';
import { PheromoneType } from '../ipc/pheromones.js';
import { kernelLog } from '../kernel/logger.js';

let taskSeq = 0;

export class Task {
  constructor({ type, payload, priority = TaskPriority.NORMAL, timeout = 60000, retryPolicy = {}, metadata = {} }) {
    this.id = crypto.randomUUID();
    this.seq = ++taskSeq;
    this.type = type;
    this.payload = payload;
    this.priority = priority;
    this.createdAt = Date.now();
    this.timeout = Math.min(timeout, MAX_TASK_TIMEOUT);
    this.retryPolicy = { maxRetries: MAX_RETRIES, ...retryPolicy };
    this.retryCount = 0;
    this.state = TaskState.NECTAR;
    this.assignedBeeId = null;
    this.startedAt = null;
    this.completedAt = null;
    this.result = null;
    this.error = null;
    this.metadata = metadata;
  }

  toSnapshot() {
    return {
      id: this.id,
      seq: this.seq,
      type: this.type,
      priority: this.priority,
      state: this.state,
      createdAt: this.createdAt,
      startedAt: this.startedAt,
      completedAt: this.completedAt,
      retryCount: this.retryCount,
      retryPolicy: this.retryPolicy,
      assignedBeeId: this.assignedBeeId,
      error: this.error,
      metadata: this.metadata
    };
  }
}

export class TaskQueue {
  #queue = [];

  enqueue(task) {
    this.#queue.push(task);
    this.#queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
    task.state = TaskState.QUEUED;
  }

  dequeue() {
    return this.#queue.shift() || null;
  }

  peek() {
    return this.#queue[0] || null;
  }

  remove(taskId) {
    const idx = this.#queue.findIndex(t => t.id === taskId);
    if (idx === -1) return false;
    this.#queue.splice(idx, 1);
    return true;
  }

  get size() { return this.#queue.length; }

  toArray() { return [...this.#queue]; }
}

export class Swarm {
  #id;
  #name;
  #beeIds = new Set();
  #taskIds = new Set();
  #scheduler;

  constructor({ name, scheduler }) {
    this.#id = crypto.randomUUID();
    this.#name = name;
    this.#scheduler = scheduler;
  }

  get id() { return this.#id; }
  get name() { return this.#name; }

  async addBee(bee) { this.#beeIds.add(bee.id); }
  addTask(task) { this.#taskIds.add(task.id); }

  toSnapshot() {
    return {
      id: this.#id,
      name: this.#name,
      beeCount: this.#beeIds.size,
      taskCount: this.#taskIds.size,
      beeIds: [...this.#beeIds],
      taskIds: [...this.#taskIds]
    };
  }
}

export class Scheduler {
  #queue = new TaskQueue();
  #tasks = new Map();       // taskId → Task
  #swarms = new Map();
  #beeRuntime = null;
  #bus = null;
  #honeyStore = null;
  #running = false;
  #scheduleTimer = null;
  #metrics = {
    submitted: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    totalLatency: 0,
    // adaptive tracking
    typeStats: new Map()  // taskType → { count, failures, totalDuration }
  };
  #adaptiveConfig = {
    minBees: 2,
    maxBees: 20,
    targetQueueDepth: 5,
    highLoadThreshold: 10,
    lowLoadThreshold: 2
  };

  init(beeRuntime, bus, honeyStore) {
    this.#beeRuntime = beeRuntime;
    this.#bus = bus;
    this.#honeyStore = honeyStore;

    // Listen for bee failures to requeue tasks
    bus.on(PheromoneType.BEE_DIED, (event) => {
      this.#handleBeeFailure(event.payload);
    });
  }

  start() {
    this.#running = true;
    this.#scheduleLoop();
    kernelLog.info('Scheduler', 'Scheduler started');
  }

  stop() {
    this.#running = false;
    if (this.#scheduleTimer) { clearTimeout(this.#scheduleTimer); this.#scheduleTimer = null; }
  }

  #scheduleLoop() {
    if (!this.#running) return;
    this.#tick().catch(err => kernelLog.error('Scheduler', 'Schedule tick error', err.message));
    this.#scheduleTimer = setTimeout(() => this.#scheduleLoop(), 100);
  }

  async #tick() {
    await this.#adaptWorkerPool();
    while (this.#queue.size > 0) {
      const idleBees = this.#beeRuntime.getIdleBees();
      if (idleBees.length === 0) break;
      const task = this.#queue.dequeue();
      if (!task) break;
      const bee = idleBees[0];
      await this.#assignTask(task, bee);
    }
  }

  async #adaptWorkerPool() {
    const queueDepth = this.#queue.size;
    const metrics = this.#beeRuntime.getMetrics();
    const currentBees = metrics.total - metrics.failed - metrics.terminated;

    if (queueDepth > this.#adaptiveConfig.highLoadThreshold && currentBees < this.#adaptiveConfig.maxBees) {
      // Spawn a new bee to handle load
      try {
        await this.#beeRuntime.spawnBee({ type: BeeType.WORKER, metadata: { auto: true } });
        kernelLog.info('Scheduler', `Auto-spawned bee (queue depth: ${queueDepth})`);
      } catch (_) {}
    }
    // Adaptive: reduce bees when queue is empty
    // We don't kill bees here; bees are persistent
  }

  async #assignTask(task, bee) {
    task.state = TaskState.ASSIGNED;
    task.assignedBeeId = bee.id;
    task.startedAt = Date.now();

    this.#bus?.emit(PheromoneType.TASK_ASSIGNED, { task: task.toSnapshot(), beeId: bee.id }, 'scheduler');

    try {
      const result = await this.#beeRuntime.executeOnBee(
        bee.id,
        task.id,
        task.type,
        task.payload,
        task.timeout
      );
      await this.#handleTaskSuccess(task, result);
    } catch (err) {
      await this.#handleTaskFailure(task, err.message);
    }
  }

  async #handleTaskSuccess(task, result) {
    task.state = TaskState.COMPLETED;
    task.result = result;
    task.completedAt = Date.now();

    const latency = task.completedAt - task.createdAt;
    this.#metrics.completed++;
    this.#metrics.totalLatency += latency;
    this.#updateTypeStats(task.type, true, latency);

    // Store as Honey
    if (this.#honeyStore && result !== undefined && result !== null) {
      try {
        await this.#honeyStore.produceHoney({
          content: result,
          type: task.type,
          producerBeeId: task.assignedBeeId,
          originatingTaskId: task.id
        });
      } catch (_) {}
    }

    this.#bus?.emit(PheromoneType.TASK_COMPLETED, { task: task.toSnapshot(), result }, 'scheduler');
    kernelLog.info('Scheduler', `Task ${task.id} completed (${latency}ms)`);
  }

  async #handleTaskFailure(task, error) {
    task.error = error;
    this.#updateTypeStats(task.type, false, 0);

    const canRetry = task.retryCount < task.retryPolicy.maxRetries;
    if (canRetry) {
      task.retryCount++;
      task.state = TaskState.NECTAR;
      task.assignedBeeId = null;
      task.startedAt = null;
      this.#queue.enqueue(task);
      this.#bus?.emit(PheromoneType.TASK_RETRYING, { task: task.toSnapshot(), error }, 'scheduler');
      kernelLog.warn('Scheduler', `Task ${task.id} requeued (attempt ${task.retryCount})`);
    } else {
      task.state = TaskState.FAILED;
      task.completedAt = Date.now();
      this.#metrics.failed++;
      this.#bus?.emit(PheromoneType.TASK_FAILED, { task: task.toSnapshot(), error }, 'scheduler');
      kernelLog.error('Scheduler', `Task ${task.id} failed permanently: ${error}`);
    }
  }

  #handleBeeFailure({ bee, reason }) {
    // Find tasks assigned to this bee and requeue them
    for (const task of this.#tasks.values()) {
      if (task.assignedBeeId === bee.id && task.state === TaskState.WORKING) {
        this.#handleTaskFailure(task, `Bee died: ${reason}`);
      }
    }
  }

  #updateTypeStats(type, success, duration) {
    if (!this.#metrics.typeStats.has(type)) {
      this.#metrics.typeStats.set(type, { count: 0, failures: 0, totalDuration: 0 });
    }
    const stats = this.#metrics.typeStats.get(type);
    stats.count++;
    if (!success) stats.failures++;
    stats.totalDuration += duration;
  }

  submit(taskOptions) {
    // Validate payload size
    const task = new Task(taskOptions);
    this.#tasks.set(task.id, task);
    this.#metrics.submitted++;
    this.#queue.enqueue(task);
    this.#bus?.emit(PheromoneType.TASK_CREATED, { task: task.toSnapshot() }, 'scheduler');
    kernelLog.debug('Scheduler', `Task ${task.id} submitted (${task.type})`);
    return task;
  }

  cancelTask(taskId) {
    const task = this.#tasks.get(taskId);
    if (!task) return false;
    if (task.state === TaskState.QUEUED) {
      this.#queue.remove(taskId);
      task.state = TaskState.CANCELLED;
      task.completedAt = Date.now();
      this.#metrics.cancelled++;
      this.#bus?.emit(PheromoneType.TASK_CANCELLED, { task: task.toSnapshot() }, 'scheduler');
      return true;
    }
    return false;
  }

  getTask(id) {
    return this.#tasks.get(id) || null;
  }

  listTasks(filter = null) {
    const tasks = [...this.#tasks.values()];
    if (!filter) return tasks.map(t => t.toSnapshot());
    return tasks.filter(t => t.state === filter).map(t => t.toSnapshot());
  }

  getQueueSnapshot() {
    return this.#queue.toArray().map(t => t.toSnapshot());
  }

  getMetrics() {
    const avgLatency = this.#metrics.completed > 0
      ? this.#metrics.totalLatency / this.#metrics.completed
      : 0;
    return {
      submitted: this.#metrics.submitted,
      completed: this.#metrics.completed,
      failed: this.#metrics.failed,
      cancelled: this.#metrics.cancelled,
      queueDepth: this.#queue.size,
      avgLatencyMs: Math.round(avgLatency),
      typeStats: Object.fromEntries(this.#metrics.typeStats)
    };
  }

  createSwarm(options) {
    const swarm = new Swarm({ ...options, scheduler: this });
    this.#swarms.set(swarm.id, swarm);
    return swarm;
  }

  getSwarm(id) {
    return this.#swarms.get(id) || null;
  }

  listSwarms() {
    return [...this.#swarms.values()].map(s => s.toSnapshot());
  }

  getAdaptiveConfig() { return { ...this.#adaptiveConfig }; }
  setAdaptiveConfig(config) { Object.assign(this.#adaptiveConfig, config); }
}
