// HoneyBeeOS - Standard Bee Worker
// This script runs inside a Web Worker.
// It implements the standard bee worker protocol.
//
// For app:* task types (Application SDK), work functions live in the main
// thread and cannot be serialized into the worker. The worker sends a
// WORK_REQUEST message; the BeeRuntime resolves it via beeFactory.execute()
// and returns a WORK_RESPONSE so the worker can complete the task.

let beeId = null;
let isPaused = false;
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 5000;

// Pending WORK_REQUEST callbacks: requestId → { resolve, reject }
const pendingWorkRequests = new Map();

function sendMessage(type, payload) {
  self.postMessage({ type, beeId, payload, timestamp: Date.now() });
}

self.onmessage = async function(event) {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT': {
      beeId = payload.beeId;
      // Start heartbeat
      heartbeatInterval = setInterval(() => {
        sendMessage('PONG', { alive: true });
      }, HEARTBEAT_INTERVAL);
      sendMessage('READY', { beeId });
      break;
    }

    case 'PING': {
      sendMessage('PONG', { alive: true });
      break;
    }

    case 'WORK_RESPONSE': {
      // Main thread resolved a WORK_REQUEST for an app:* task
      const { requestId, result, error } = payload;
      const pending = pendingWorkRequests.get(requestId);
      if (pending) {
        pendingWorkRequests.delete(requestId);
        if (error) pending.reject(new Error(error));
        else pending.resolve(result);
      }
      break;
    }

    case 'EXECUTE': {
      if (isPaused) {
        sendMessage('ERROR', { error: 'Bee is paused', taskId: payload.taskId });
        return;
      }
      sendMessage('STARTED', { taskId: payload.taskId });
      try {
        const result = await executeTask(payload);
        sendMessage('RESULT', { taskId: payload.taskId, result });
      } catch (err) {
        sendMessage('ERROR', { taskId: payload.taskId, error: err.message, stack: err.stack });
      }
      break;
    }

    case 'PAUSE': {
      isPaused = true;
      break;
    }

    case 'RESUME': {
      isPaused = false;
      break;
    }

    case 'TERMINATE': {
      clearInterval(heartbeatInterval);
      sendMessage('EXITED', { beeId });
      self.close();
      break;
    }

    default:
      sendMessage('ERROR', { error: `Unknown command: ${type}` });
  }
};

async function executeTask(payload) {
  const { taskId, taskType, taskPayload } = payload;

  // Report progress helper
  const reportProgress = (progress, message) => {
    sendMessage('PROGRESS', { taskId, progress, message });
  };

  switch (taskType) {
    case 'compute:fibonacci': {
      const n = taskPayload?.n || 30;
      reportProgress(0, `Computing fibonacci(${n})`);
      const result = fibonacci(n);
      reportProgress(100, 'Done');
      return { fibonacci: result, n };
    }

    case 'compute:prime': {
      const limit = taskPayload?.limit || 10000;
      reportProgress(0, `Finding primes up to ${limit}`);
      const primes = sieveOfEratosthenes(limit);
      reportProgress(100, `Found ${primes.length} primes`);
      return { count: primes.length, primes: primes.slice(0, 100) };
    }

    case 'compute:sort': {
      const arr = taskPayload?.array || Array.from({ length: 10000 }, () => Math.random());
      reportProgress(0, 'Sorting array');
      const sorted = [...arr].sort((a, b) => a - b);
      reportProgress(100, 'Done');
      return { sorted: sorted.slice(0, 10), length: sorted.length };
    }

    case 'compute:hash': {
      const data = taskPayload?.data || 'default data';
      const encoded = new TextEncoder().encode(data);
      const hashBuffer = await crypto.subtle.digest('SHA-256', encoded);
      const hashHex = Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
      return { hash: hashHex, input: data };
    }

    case 'scout:search': {
      // Scout tasks are handled via the scout worker
      const query = taskPayload?.query || '';
      reportProgress(10, `Searching for: ${query}`);
      // Signal back - actual search data comes from the host context
      return { query, status: 'search_request', timestamp: Date.now() };
    }

    case 'generic': {
      // Generic task: just execute a safe computation
      const delay = taskPayload?.delay || 0;
      if (delay > 0) {
        await sleep(delay);
      }
      return { done: true, payload: taskPayload };
    }

    default: {
      // app:* task types — delegate execution to the main thread via WORK_REQUEST/WORK_RESPONSE
      if (taskType.startsWith('app:')) {
        const requestId = crypto.randomUUID();
        return new Promise((resolve, reject) => {
          pendingWorkRequests.set(requestId, { resolve, reject });
          reportProgress(10, `Delegating ${taskType} to application runtime`);
          sendMessage('WORK_REQUEST', {
            requestId,
            taskId,
            taskType,
            taskPayload
          });
        });
      }
      // Unknown task type - return as-is
      reportProgress(50, `Executing unknown task type: ${taskType}`);
      return { taskType, taskPayload, executed: true };
    }
  }
}

function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    [a, b] = [b, a + b];
  }
  return b;
}

function sieveOfEratosthenes(limit) {
  const sieve = new Uint8Array(limit + 1).fill(1);
  sieve[0] = sieve[1] = 0;
  for (let i = 2; i * i <= limit; i++) {
    if (sieve[i]) {
      for (let j = i * i; j <= limit; j += i) sieve[j] = 0;
    }
  }
  const primes = [];
  for (let i = 2; i <= limit; i++) {
    if (sieve[i]) primes.push(i);
  }
  return primes;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
