# HoneyBeeOS

A browser-native operating system inspired by the architecture and behavior of a real bee colony. Every metaphor corresponds to actual system behavior implemented using browser-native APIs.

---

## Architecture

```
Browser
↓
HoneyBeeOS Kernel (Hive)
↓
Kernel Services (PheromoneBus, Honeycomb, Guard, Scheduler)
↓
Bee Runtime (Web Workers)
↓
Applications (Explorer, Task Manager, Text Editor, Shell, Observatory, Mission Control)
↓
Hive UI (Desktop, Windows, Canvas)
```

The kernel never depends on the UI. The UI reads kernel state through public APIs and pheromone subscriptions.

---

## Metaphor → System Mapping

| Metaphor | System Concept | Browser Primitive |
|----------|---------------|-------------------|
| **Bee** | Computational worker | Web Worker |
| **Queen** | Kernel coordinator | Hive class |
| **Hive** | Operating system | Top-level kernel |
| **Honeycomb** | Persistent filesystem | IndexedDB |
| **Cell** | Storage unit / object | IndexedDB record |
| **Nectar** | Input / queued work | TaskQueue (NECTAR state) |
| **Honey** | Completed result artifact | HoneyStore + Honeycomb |
| **Pheromone** | Event / signal / IPC | Custom event bus + BroadcastChannel |
| **Scout Bee** | Discovery worker | Scout Web Worker |
| **Guard Bee** | Security / permissions | Guard capability system |
| **Swarm** | Group of related workers | Swarm abstraction |
| **Bee death** | Worker failure | Worker onerror / heartbeat timeout |
| **New Bee** | Worker replacement | BeeRuntime.spawnBee() |

---

## Project Structure

```
honeybeeos/
├── index.html                 # Boot entry point
├── sw.js                      # Service Worker (offline-first)
├── README.md
├── src/
│   ├── boot.js                # Kernel boot + UI init
│   ├── kernel/
│   │   ├── hive.js            # Hive kernel (main OS class)
│   │   ├── constants.js       # System-wide enumerations
│   │   └── logger.js          # Structured kernel logger
│   ├── ipc/
│   │   └── pheromones.js      # Pheromone event bus (IPC)
│   ├── bees/
│   │   ├── bee-runtime.js     # Web Worker lifecycle management
│   │   ├── scheduler.js       # Task scheduler + swarm
│   │   └── scout.js           # Scout bee manager
│   ├── storage/
│   │   ├── honeycomb.js       # IndexedDB filesystem abstraction (Comb/Cell)
│   │   └── honey.js           # Honey artifact model + deduplication
│   ├── security/
│   │   └── guard.js           # Capability-based access control
│   ├── apps/
│   │   ├── app-runtime.js     # Application lifecycle management
│   │   ├── honeycomb-explorer.js
│   │   ├── task-manager.js
│   │   ├── text-editor.js
│   │   ├── shell.js           # Command shell
│   │   └── observatory.js     # Real-time OS monitor
│   ├── ui/
│   │   └── desktop.js         # Desktop window manager
│   └── sdk/
│       └── index.js           # Public developer API
├── workers/
│   ├── bee.worker.js          # Standard computational bee worker
│   └── scout.worker.js        # Scout discovery bee worker
├── assets/
│   └── style.css
└── tests/
    └── kernel.test.js
```

---

## Technical Constraints

1. **No third-party dependencies** — pure browser APIs only
2. **No frameworks** — no React, Vue, Angular, Svelte, etc.
3. **ES modules** throughout
4. **Web Workers** for all computational work
5. **IndexedDB** for persistent structured storage
6. **Service Worker** for offline-first operation
7. **Web Crypto** for content hashing (SHA-256)
8. **BroadcastChannel + postMessage** for IPC
9. **File System Access API** with graceful fallback

---

## Kernel Subsystems

### Hive (Kernel)
The central coordinator. Manages lifecycle: `start()`, `shutdown()`, `status()`, `getMetrics()`.

- Deterministic lifecycle with state guards
- Multiple `start()` calls are idempotent
- `shutdown()` terminates all workers and releases resources
- Kernel state is read-only via `status()`

### PheromoneBus (IPC)
Event-driven IPC system. Every system event has `{ id, type, timestamp, source, payload }`.

```js
hive.on('bee.died', (event) => { /* handle */ });
hive.emit('task.created', { taskId });
hive.bus.getHistory({ limit: 50 });
```

### Bee Runtime
Each bee is a real `Web Worker`. States: `CREATED → IDLE → WORKING → COMPLETED/FAILED → TERMINATED`.

Heartbeat monitoring detects unresponsive workers. Failed bees emit `bee.died` pheromones. Pending tasks are requeued.

Worker protocol:
- Main → Worker: `INIT, EXECUTE, PAUSE, RESUME, TERMINATE, PING`
- Worker → Main: `READY, STARTED, PROGRESS, RESULT, ERROR, PONG, EXITED`

### Scheduler
Priority queue with adaptive worker pool management.

- Task priorities: `LOW(0), NORMAL(1), HIGH(2), CRITICAL(3)`
- Task states: `NECTAR → QUEUED → ASSIGNED → WORKING → COMPLETED/FAILED/CANCELLED`
- Retryable tasks are automatically requeued up to `maxRetries`
- Successful results are automatically stored as Honey artifacts

### Honeycomb (Filesystem)
Applications never interact with IndexedDB directly. All storage goes through `Comb` APIs.

```js
const cell = await hive.comb.createCell('documents/note.txt', 'TEXT', 'Hello world');
const { cell, content } = await hive.comb.readCell('documents/note.txt');
await hive.comb.updateCell('documents/note.txt', 'Updated content');
await hive.comb.deleteCell('documents/note.txt');
```

Content is hashed with SHA-256 for integrity verification.

Namespaces: `system/`, `apps/`, `users/`, `documents/`, `cache/`, `tasks/`

### Honey Artifacts
Immutable, content-addressed results of successful computation.

```js
const artifact = await hive.produceHoney({
  content: result,
  type: 'compute:fibonacci',
  producerBeeId: bee.id,
  originatingTaskId: task.id
});
```

Deduplication: identical content hashes → same artifact (no duplicate storage).

Flow: **NECTAR → BEE → TASK → HONEY**

### Guard (Security)
Capability-based access control. Applications declare permissions in their manifest. The Guard persists grants in IndexedDB.

```js
const result = await hive.requestCapability({
  app: 'text-editor',
  permission: 'storage.write',
  resource: 'documents/*'
});
// → { granted: true/false, ... }
```

Every access decision emits `access.requested`, `access.granted`, or `access.denied`.

### Scout Bees
Disposable search workers. Each scout is a real Web Worker that searches Honeycomb cells.

```js
const results = await hive.scout('kubernetes', { namespace: 'documents' });
// → { query, results: [...], count: N }
```

### Application Runtime
Applications are declared via manifest:

```json
{
  "id": "text-editor",
  "name": "Text Editor",
  "version": "1.0.0",
  "permissions": ["storage.read", "storage.write"]
}
```

Apps are isolated from kernel internals. They communicate only through public Hive APIs.

---

## Native Applications

| App | ID | Capabilities |
|-----|-----|-------------|
| Honeycomb Explorer | `honeycomb-explorer` | Browse cells, search, view honey |
| Hive Task Manager | `task-manager` | Submit/cancel tasks, monitor bees |
| Text Editor | `text-editor` | Create/edit/save documents |
| Hive Shell | `hive-shell` | Command-line kernel access |
| Observatory | `observatory` | Real-time OS monitor + canvas visualization |
| Mission Control | `mission-control` | Launch and operate a simulated satellite mission |

---

## Space Runtime (Mission Simulation Layer)

HoneyBeeOS now includes an optional **Space Runtime** that sits on top of the core kernel.

- Mission lifecycle state machine: `VEHICLE_READY → COUNTDOWN → IGNITION → LIFTOFF → ASCENT → ORBIT_INSERTION → ORBITAL_OPERATIONS`
- Two-body orbital propagation for first-pass simulation
- Mission telemetry persisted in Honeycomb under `space/missions/*` and `space/telemetry/*`
- Mission launch spawns subsystem bees (flight computer, guidance, navigation, propulsion, power, thermal, communications, payload)

---

## Shell Commands

```
hive status          Show hive status
hive metrics         Full metrics snapshot
hive health          Colony health summary
bee list             List all worker bees
bee inspect <id>     Inspect a bee
bee spawn            Spawn a new bee
bee kill <id>        Kill a bee
task list            List tasks
task submit <type>   Submit a task
task cancel <id>     Cancel a queued task
comb list            List all cells
comb read <path>     Read a cell's content
honey list           List honey artifacts
scout <query>        Search cells
pheromone list       Recent pheromone events
app list             List installed apps
app start <id>       Start an app
app stop <id>        Stop an app
clear                Clear the terminal
```

---

## Running

Open `index.html` in a modern browser via a local HTTP server (required for ES modules and Service Worker):

```bash
# Python
python3 -m http.server 8080

# Node.js (npx)
npx serve .

# Then open: http://localhost:8080
```

The console will show:
```
HONEYBEEOS
Hive initializing...
Queen initializing...
Hive ready.
```

---

## Running Tests

```bash
node tests/kernel.test.js
```

All tests run in Node.js without a browser (no DOM dependencies in tests).

---

## Offline-First

After the first load, HoneyBeeOS caches all application shell files via Service Worker. Reloading without a network connection will still boot the OS. Existing Honeycomb data remains available via IndexedDB.

---

## Developer SDK

```js
import { hive, PheromoneType, TaskPriority, Capability } from './src/sdk/index.js';

// Boot
await hive.start();

// Submit work
const task = hive.submitTask({
  type: 'compute:fibonacci',
  payload: { n: 40 },
  priority: TaskPriority.HIGH
});

// Listen for results
hive.on(PheromoneType.TASK_COMPLETED, (event) => {
  console.log('Result:', event.payload.result);
});

// Persistent storage
const cell = await hive.comb.createCell('documents/note.txt', 'TEXT', 'Hello!');

// Search
const results = await hive.scout('note');

// Security
await hive.requestCapability({ app: 'my-app', permission: Capability.STORAGE_READ });
```

---

## Security Model

- Applications cannot access IndexedDB directly
- All storage goes through `Comb` APIs with Guard enforcement
- All file access requires `filesystem.import`/`filesystem.export` capability
- Worker messages are validated before dispatch
- Worker count is bounded (`MAX_BEES = 50`)
- Task timeouts prevent hung workers
- Payload sizes are bounded (`MAX_PAYLOAD_SIZE = 10MB`)
- Chaos mode is restricted to `localhost`

### Known Browser Limitations

- Web Workers share the same origin security context (cannot provide process-level isolation)
- IndexedDB is accessible to any same-origin JavaScript (kernel boundary is logical, not hardware)
- Service Worker cannot intercept non-HTTP protocols
- File System Access API requires user gesture and is not available in all browsers

---

## Chaos Mode (Development Only)

Available only on `localhost`:

```js
hive.enableChaosMode();
await hive.chaosKillBee(beeId);
await hive.chaosKillRandomBees(0.2); // Kill 20% of bees
```

---

## Architecture Invariants

1. **Kernel never imports UI code**
2. **UI never imports kernel internals** — only public API via `hive.*`
3. **Storage never accessed directly** — always through Comb
4. **Workers never access DOM** — only compute
5. **All events carry provenance** — `{ id, type, timestamp, source, payload }`
6. **Honey artifacts are content-addressed** — identical content deduplicates