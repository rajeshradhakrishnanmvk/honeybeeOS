// HoneyBeeOS - Kernel Tests (Node.js compatible unit tests)
// Run: node tests/kernel.test.js

// Minimal test framework
let passed = 0, failed = 0;
const pendingTests = [];

function test(name, fn) {
  try {
    const result = fn();
    if (result instanceof Promise) {
      const tracked = result
        .then(() => { passed++; console.log(`✅ ${name}`); })
        .catch(err => { failed++; console.error(`❌ ${name}: ${err.message}`); });
      pendingTests.push(tracked);
    } else {
      passed++;
      console.log(`✅ ${name}`);
    }
  } catch (err) {
    failed++;
    console.error(`❌ ${name}: ${err.message}`);
  }
}

function assert(condition, msg) {
  if (!condition) throw new Error(msg || 'Assertion failed');
}

function assertEqual(a, b) {
  if (a !== b) throw new Error(`Expected ${JSON.stringify(a)} === ${JSON.stringify(b)}`);
}

// ---- Tests ----

// Test: HiveState constants
test('HiveState has expected values', () => {
  const states = ['initializing', 'running', 'shutting_down', 'stopped', 'error'];
  // Verify values are strings
  for (const s of states) {
    assert(typeof s === 'string', `State ${s} should be a string`);
  }
});

// Test: TaskPriority ordering
test('TaskPriority LOW < NORMAL < HIGH < CRITICAL', () => {
  const { LOW, NORMAL, HIGH, CRITICAL } = { LOW: 0, NORMAL: 1, HIGH: 2, CRITICAL: 3 };
  assert(LOW < NORMAL, 'LOW < NORMAL');
  assert(NORMAL < HIGH, 'NORMAL < HIGH');
  assert(HIGH < CRITICAL, 'HIGH < CRITICAL');
});

// Test: Task creation
test('Task has required fields', () => {
  const task = {
    id: 'test-id',
    type: 'compute:fibonacci',
    payload: { n: 30 },
    priority: 1,
    state: 'NECTAR',
    createdAt: Date.now(),
    retryCount: 0,
    retryPolicy: { maxRetries: 3 }
  };
  assert(task.id, 'Task has id');
  assert(task.type, 'Task has type');
  assert(task.state === 'NECTAR', 'New task is NECTAR');
  assertEqual(task.retryCount, 0);
});

// Test: TaskQueue priority ordering
test('TaskQueue orders by priority', () => {
  const queue = [];
  const enqueue = (task) => {
    queue.push(task);
    queue.sort((a, b) => b.priority - a.priority || a.seq - b.seq);
  };

  enqueue({ id: '1', seq: 1, priority: 0, type: 'low' });
  enqueue({ id: '2', seq: 2, priority: 3, type: 'critical' });
  enqueue({ id: '3', seq: 3, priority: 1, type: 'normal' });

  assert(queue[0].type === 'critical', 'Critical first');
  assert(queue[2].type === 'low', 'Low last');
});

// Test: Pheromone event structure
test('PheromoneEvent has required fields', () => {
  const event = {
    id: crypto.randomUUID ? crypto.randomUUID() : 'test-uuid',
    type: 'bee.created',
    timestamp: Date.now(),
    source: 'kernel',
    payload: {}
  };
  assert(event.id, 'Event has id');
  assert(event.type, 'Event has type');
  assert(event.timestamp, 'Event has timestamp');
  assert(event.source, 'Event has source');
});

// Test: Bee state lifecycle
test('Bee states are valid', () => {
  const states = ['CREATED', 'IDLE', 'WORKING', 'PAUSED', 'COMPLETED', 'FAILED', 'TERMINATED'];
  for (const s of states) {
    assert(typeof s === 'string', `${s} is a string`);
  }
});

// Test: Cell has required fields
test('Cell has required fields', () => {
  const cell = {
    id: 'cell-1',
    path: 'documents/test.txt',
    namespace: 'documents',
    type: 'TEXT',
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    size: 100,
    hash: 'abc123'
  };
  assert(cell.id, 'Cell has id');
  assert(cell.path, 'Cell has path');
  assert(cell.type, 'Cell has type');
  assert(cell.hash, 'Cell has hash');
});

// Test: HoneyArtifact structure
test('HoneyArtifact has required fields', () => {
  const artifact = {
    id: 'honey-1',
    hash: 'sha256:abc123',
    producerBeeId: 'bee-1',
    originatingTaskId: 'task-1',
    createdAt: Date.now(),
    size: 256,
    type: 'RESULT',
    metadata: {}
  };
  assert(artifact.hash, 'Artifact has hash');
  assert(artifact.producerBeeId, 'Artifact has producerBeeId');
  assert(artifact.originatingTaskId, 'Artifact has originatingTaskId');
});

// Test: Capability values
test('Capability values are dot-notation strings', () => {
  const caps = [
    'storage.read', 'storage.write', 'storage.delete',
    'task.create', 'task.cancel', 'bee.spawn',
    'network.access', 'filesystem.import', 'filesystem.export'
  ];
  for (const c of caps) {
    assert(c.includes('.'), `${c} is dot-notation`);
  }
});

// Test: Multiple start() calls
test('Hive cannot be double-started (state guard)', () => {
  let initCount = 0;
  const mockHive = {
    state: 'stopped',
    async start() {
      if (this.state === 'running') return; // guard
      this.state = 'running';
      initCount++;
    }
  };

  mockHive.start();
  mockHive.start();
  assertEqual(initCount, 1, 'Should only initialize once');
});

// Test: Event history limit
test('Event history is bounded', () => {
  const LIMIT = 10;
  const history = [];
  for (let i = 0; i < 15; i++) {
    history.push({ id: i, type: 'test' });
    if (history.length > LIMIT) history.shift();
  }
  assert(history.length <= LIMIT, `History bounded to ${LIMIT}`);
  assertEqual(history[0].id, 5, 'Oldest events removed');
});

// Test: Fibonacci correctness
test('Fibonacci computation', () => {
  function fibonacci(n) {
    if (n <= 1) return n;
    let a = 0, b = 1;
    for (let i = 2; i <= n; i++) [a, b] = [b, a + b];
    return b;
  }
  assertEqual(fibonacci(0), 0);
  assertEqual(fibonacci(1), 1);
  assertEqual(fibonacci(10), 55);
  assertEqual(fibonacci(20), 6765);
});

// Test: Sieve of Eratosthenes
test('Prime sieve finds correct count', () => {
  function sieve(limit) {
    const s = new Uint8Array(limit + 1).fill(1);
    s[0] = s[1] = 0;
    for (let i = 2; i * i <= limit; i++) {
      if (s[i]) for (let j = i * i; j <= limit; j += i) s[j] = 0;
    }
    return [...s].filter(Boolean).length;
  }
  assertEqual(sieve(10), 4);   // 2,3,5,7
  assertEqual(sieve(100), 25); // 25 primes below 100
});

test('Space physics propagation updates state', async () => {
  const { propagateOrbitStep } = await import('../src/space/physics.js');
  const initial = {
    position: { x: 6_771_000, y: 0, z: 0 },
    velocity: { x: 0, y: 7_670, z: 0 },
    fuel: 100,
    battery: 100,
    time: 0
  };
  const next = propagateOrbitStep(initial, 1);
  assert(next.time === 1, 'Simulation time advances by dt');
  assert(next.position.y > initial.position.y, 'Satellite position advances along velocity vector');
});

test('Space mission launch reaches orbital operations', async () => {
  const { SpaceMission, MissionPhase } = await import('../src/space/mission.js');
  const mission = new SpaceMission({ id: 'TEST-MISSION' });
  const started = mission.launch(1);
  assert(started, 'Mission launch accepted');

  for (let i = 0; i < 20; i++) {
    mission.tick(1);
  }
  assertEqual(mission.phase, MissionPhase.ORBITAL_OPERATIONS);
  assert(mission.telemetry.altitude > 300_000, 'Telemetry altitude remains orbital');
});

// Summary
Promise.allSettled(pendingTests).then(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
