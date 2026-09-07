// HoneyBeeOS Public SDK
// This is the stable public API surface for application developers.
// Internal implementation details are hidden behind this module.

export { hive } from '../kernel/hive.js';
export { PheromoneType } from '../ipc/pheromones.js';
export { BeeState, TaskState, TaskPriority, BeeType, Capability, CellType, Namespaces } from '../kernel/constants.js';
export { HIVE_VERSION } from '../kernel/constants.js';

// Re-export useful types for documentation / type inference
export { Task } from '../bees/scheduler.js';
export { Cell } from '../storage/honeycomb.js';
export { HoneyArtifact } from '../storage/honey.js';
