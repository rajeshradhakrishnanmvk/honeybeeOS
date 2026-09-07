// HoneyBeeOS - Kernel Constants
// All system-wide enumerations and constants

export const HIVE_VERSION = '1.0.0';

export const HiveState = Object.freeze({
  INITIALIZING: 'initializing',
  RUNNING: 'running',
  SHUTTING_DOWN: 'shutting_down',
  STOPPED: 'stopped',
  ERROR: 'error'
});

export const BeeState = Object.freeze({
  CREATED: 'CREATED',
  IDLE: 'IDLE',
  WORKING: 'WORKING',
  PAUSED: 'PAUSED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TERMINATED: 'TERMINATED'
});

export const TaskState = Object.freeze({
  NECTAR: 'NECTAR',
  QUEUED: 'QUEUED',
  ASSIGNED: 'ASSIGNED',
  WORKING: 'WORKING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED'
});

export const TaskPriority = Object.freeze({
  LOW: 0,
  NORMAL: 1,
  HIGH: 2,
  CRITICAL: 3
});

export const BeeType = Object.freeze({
  WORKER: 'WORKER',
  SCOUT: 'SCOUT',
  GUARD: 'GUARD'
});

// Worker protocol: MAIN → BEE
export const WorkerCommand = Object.freeze({
  INIT: 'INIT',
  EXECUTE: 'EXECUTE',
  PAUSE: 'PAUSE',
  RESUME: 'RESUME',
  TERMINATE: 'TERMINATE',
  PING: 'PING'
});

// Worker protocol: BEE → MAIN
export const WorkerMessage = Object.freeze({
  READY: 'READY',
  STARTED: 'STARTED',
  PROGRESS: 'PROGRESS',
  RESULT: 'RESULT',
  ERROR: 'ERROR',
  PONG: 'PONG',
  EXITED: 'EXITED'
});

export const Capability = Object.freeze({
  STORAGE_READ: 'storage.read',
  STORAGE_WRITE: 'storage.write',
  STORAGE_DELETE: 'storage.delete',
  TASK_CREATE: 'task.create',
  TASK_CANCEL: 'task.cancel',
  BEE_SPAWN: 'bee.spawn',
  NETWORK_ACCESS: 'network.access',
  FILESYSTEM_IMPORT: 'filesystem.import',
  FILESYSTEM_EXPORT: 'filesystem.export'
});

export const CellType = Object.freeze({
  TEXT: 'TEXT',
  JSON: 'JSON',
  BINARY: 'BINARY',
  APPLICATION: 'APPLICATION',
  SYSTEM: 'SYSTEM'
});

export const Namespaces = Object.freeze({
  SYSTEM: 'system',
  APPS: 'apps',
  USERS: 'users',
  DOCUMENTS: 'documents',
  CACHE: 'cache',
  TASKS: 'tasks'
});

export const HEARTBEAT_INTERVAL = 5000;
export const HEARTBEAT_TIMEOUT = 15000;
export const MAX_BEES = 50;
export const MAX_TASKS_PER_BEE = 1;
export const MAX_PAYLOAD_SIZE = 10 * 1024 * 1024; // 10MB
export const MAX_TASK_TIMEOUT = 300000; // 5 minutes
export const EVENT_HISTORY_LIMIT = 1000;
export const MAX_RETRIES = 3;
