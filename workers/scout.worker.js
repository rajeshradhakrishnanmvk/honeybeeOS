// HoneyBeeOS - Scout Worker
// Specialized discovery/search worker

let beeId = null;
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 5000;

function sendMessage(type, payload) {
  self.postMessage({ type, beeId, payload, timestamp: Date.now() });
}

self.onmessage = async function(event) {
  const { type, payload } = event.data;

  switch (type) {
    case 'INIT': {
      beeId = payload.beeId;
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
    case 'EXECUTE': {
      sendMessage('STARTED', { taskId: payload.taskId });
      try {
        const result = await executeScout(payload);
        sendMessage('RESULT', { taskId: payload.taskId, result });
      } catch (err) {
        sendMessage('ERROR', { taskId: payload.taskId, error: err.message });
      }
      break;
    }
    case 'TERMINATE': {
      clearInterval(heartbeatInterval);
      sendMessage('EXITED', { beeId });
      self.close();
      break;
    }
  }
};

async function executeScout(payload) {
  const { taskPayload } = payload;
  const { cells = [], query, options = {} } = taskPayload;

  const results = [];
  const queryLower = (query || '').toLowerCase();

  for (const cell of cells) {
    if (matchesQuery(cell, queryLower, options)) {
      results.push({
        id: cell.id,
        path: cell.path,
        type: cell.type,
        namespace: cell.namespace,
        metadata: cell.metadata,
        hash: cell.hash,
        size: cell.size,
        updatedAt: cell.updatedAt
      });
    }
  }

  return { query, results, count: results.length, scoutId: beeId };
}

function matchesQuery(cell, query, options) {
  // Mandatory pre-filters (regardless of query match)
  if (options.type && cell.type && cell.type.toLowerCase() !== options.type.toLowerCase()) return false;
  if (options.namespace && cell.namespace && cell.namespace !== options.namespace) return false;

  if (!query) return true;
  // Check path
  if (cell.path && cell.path.toLowerCase().includes(query)) return true;
  // Check metadata
  if (cell.metadata) {
    const metaStr = JSON.stringify(cell.metadata).toLowerCase();
    if (metaStr.includes(query)) return true;
  }
  return false;
}
