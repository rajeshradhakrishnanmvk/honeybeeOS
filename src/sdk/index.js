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

// Application SDK — developer-facing API
// Usage:
//   const app = hive.app({ id: "myapp", name: "My App" });
//   app.work("doThing", (input) => { ... });
//   const result = await app.run("doThing", input);
export { HiveApp } from '../apps/app-sdk.js';
export { beeFactory } from '../apps/bee-factory.js';
export { SpaceRuntime } from '../space/space-runtime.js';
export { SpaceMission, MissionPhase } from '../space/mission.js';
export { MU_EARTH, EARTH_RADIUS, propagateOrbitStep, telemetryFromState } from '../space/physics.js';
