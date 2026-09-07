// HoneyBeeOS - Pheromone Bus (IPC Event System)
// OS concept: Inter-process communication / event bus
// Browser primitive: Custom event system (BroadcastChannel for cross-context)
// Kernel state: event history, subscriptions
// Failure: malformed events are rejected; subscriptions cleaned up on unsubscribe
// UI observation: UI subscribes to pheromone types

import { EVENT_HISTORY_LIMIT } from '../kernel/constants.js';
import { kernelLog } from '../kernel/logger.js';

export const PheromoneType = Object.freeze({
  // Bee events
  BEE_CREATED:    'bee.created',
  BEE_READY:      'bee.ready',
  BEE_STARTED:    'bee.started',
  BEE_PROGRESS:   'bee.progress',
  BEE_COMPLETED:  'bee.completed',
  BEE_FAILED:     'bee.failed',
  BEE_DIED:       'bee.died',
  BEE_REPLACED:   'bee.replaced',
  BEE_PAUSED:     'bee.paused',
  BEE_RESUMED:    'bee.resumed',
  BEE_TERMINATED: 'bee.terminated',
  // Task events
  TASK_CREATED:   'task.created',
  TASK_ASSIGNED:  'task.assigned',
  TASK_STARTED:   'task.started',
  TASK_PROGRESS:  'task.progress',
  TASK_COMPLETED: 'task.completed',
  TASK_FAILED:    'task.failed',
  TASK_CANCELLED: 'task.cancelled',
  TASK_RETRYING:  'task.retrying',
  // Cell/Storage events
  CELL_CREATED:   'cell.created',
  CELL_UPDATED:   'cell.updated',
  CELL_DELETED:   'cell.deleted',
  // Service events
  SERVICE_STARTED: 'service.started',
  SERVICE_STOPPED: 'service.stopped',
  // Resource events
  RESOURCE_WARNING:  'resource.warning',
  RESOURCE_CRITICAL: 'resource.critical',
  // Security events
  ACCESS_REQUESTED: 'access.requested',
  ACCESS_GRANTED:   'access.granted',
  ACCESS_DENIED:    'access.denied',
  // Network events
  NETWORK_ONLINE:   'network.online',
  NETWORK_OFFLINE:  'network.offline',
  NETWORK_RESTORED: 'network.restored',
  // Hive events
  HIVE_STARTED:    'hive.started',
  HIVE_SHUTDOWN:   'hive.shutdown',
  HIVE_ERROR:      'hive.error',
  // Honey events
  HONEY_PRODUCED:  'honey.produced',
  HONEY_RETRIEVED: 'honey.retrieved',
  // App events
  APP_INSTALLED:   'app.installed',
  APP_UNINSTALLED: 'app.uninstalled',
  APP_STARTED:     'app.started',
  APP_STOPPED:     'app.stopped',
  // Chaos events
  CHAOS_BEE_KILLED: 'chaos.bee.killed',
  CHAOS_TASK_FAILED: 'chaos.task.failed',
  CHAOS_STORAGE_FAIL: 'chaos.storage.fail'
});

export class PheromoneEvent {
  constructor(type, payload, source = 'kernel') {
    this.id = crypto.randomUUID();
    this.type = type;
    this.timestamp = Date.now();
    this.source = source;
    this.payload = payload;
  }
}

export class PheromoneBus {
  #handlers = new Map();   // type → Set<handler>
  #history = [];
  #broadcastChannel = null;

  constructor() {
    try {
      this.#broadcastChannel = new BroadcastChannel('honeybeeos-pheromones');
      this.#broadcastChannel.onmessage = (ev) => {
        this.#dispatchLocal(ev.data);
      };
    } catch (_) {
      // BroadcastChannel may not be available in all contexts
    }
  }

  emit(type, payload, source = 'kernel') {
    if (!type || typeof type !== 'string') {
      kernelLog.warn('PheromonesBus', 'Rejected malformed pheromone: missing type');
      return null;
    }
    const event = new PheromoneEvent(type, payload, source);
    this.#storeHistory(event);
    this.#dispatchLocal(event);
    try {
      this.#broadcastChannel?.postMessage(event);
    } catch (_) {}
    return event;
  }

  #dispatchLocal(event) {
    const handlers = this.#handlers.get(event.type);
    if (handlers) {
      for (const h of handlers) {
        try { h(event); } catch (err) {
          kernelLog.error('PheromoneBus', `Handler error for ${event.type}`, err.message);
        }
      }
    }
    // wildcard
    const wildcards = this.#handlers.get('*');
    if (wildcards) {
      for (const h of wildcards) {
        try { h(event); } catch (_) {}
      }
    }
  }

  on(type, handler) {
    if (!this.#handlers.has(type)) this.#handlers.set(type, new Set());
    this.#handlers.get(type).add(handler);
  }

  once(type, handler) {
    const wrapper = (event) => {
      handler(event);
      this.off(type, wrapper);
    };
    this.on(type, wrapper);
  }

  off(type, handler) {
    this.#handlers.get(type)?.delete(handler);
  }

  #storeHistory(event) {
    this.#history.push(event);
    if (this.#history.length > EVENT_HISTORY_LIMIT) {
      this.#history.shift();
    }
  }

  getHistory(options = {}) {
    let h = [...this.#history];
    if (options.type)  h = h.filter(e => e.type === options.type);
    if (options.since) h = h.filter(e => e.timestamp >= options.since);
    if (options.limit) h = h.slice(-options.limit);
    return h;
  }

  getHandlerCount(type) {
    return this.#handlers.get(type)?.size || 0;
  }

  destroy() {
    this.#handlers.clear();
    this.#history = [];
    try { this.#broadcastChannel?.close(); } catch (_) {}
  }
}
