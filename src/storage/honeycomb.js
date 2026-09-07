// HoneyBeeOS - Honeycomb Storage (IndexedDB abstraction)
// OS concept: Filesystem / persistent storage
// Browser primitive: IndexedDB
// Kernel state: cell metadata, namespaces
// Failure: DB errors caught, returned as structured errors
// UI observation: subscribes to cell pheromones

import { CellType, Namespaces } from '../kernel/constants.js';

const DB_NAME = 'honeybeeos-honeycomb';
const DB_VERSION = 2;
const CELLS_STORE = 'cells';
const BLOBS_STORE = 'blobs';

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(CELLS_STORE)) {
        const s = db.createObjectStore(CELLS_STORE, { keyPath: 'id' });
        s.createIndex('path', 'path', { unique: true });
        s.createIndex('namespace', 'namespace', { unique: false });
        s.createIndex('type', 'type', { unique: false });
        s.createIndex('updatedAt', 'updatedAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(BLOBS_STORE)) {
        db.createObjectStore(BLOBS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txStore(db, storeName, mode = 'readonly') {
  const tx = db.transaction(storeName, mode);
  return { tx, store: tx.objectStore(storeName) };
}

function promisifyRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function sha256Hex(data) {
  let bytes;
  if (typeof data === 'string') {
    bytes = new TextEncoder().encode(data);
  } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    bytes = data;
  } else {
    bytes = new TextEncoder().encode(JSON.stringify(data));
  }
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export class Cell {
  constructor(data) {
    this.id = data.id || crypto.randomUUID();
    this.path = data.path;
    this.namespace = data.namespace || Namespaces.DOCUMENTS;
    this.type = data.type || CellType.TEXT;
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || Date.now();
    this.updatedAt = data.updatedAt || Date.now();
    this.size = data.size || 0;
    this.hash = data.hash || null;
    // content is stored separately in blobs store
  }

  toRecord() {
    return {
      id: this.id,
      path: this.path,
      namespace: this.namespace,
      type: this.type,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      size: this.size,
      hash: this.hash
    };
  }
}

export class Comb {
  #db = null;
  #bus = null;

  async init(bus) {
    this.#bus = bus;
    this.#db = await openDB();
  }

  async createCell(path, type, content, metadata = {}) {
    if (!path) throw new Error('Cell path is required');
    const hash = await sha256Hex(content);
    let size = 0;
    if (typeof content === 'string') size = new TextEncoder().encode(content).byteLength;
    else if (content instanceof ArrayBuffer) size = content.byteLength;
    else size = new TextEncoder().encode(JSON.stringify(content)).byteLength;

    const namespace = path.split('/')[0] || Namespaces.DOCUMENTS;
    const cell = new Cell({ path, namespace, type, metadata, size, hash });

    const tx2 = this.#db.transaction([CELLS_STORE, BLOBS_STORE], 'readwrite');
    const cellStore2 = tx2.objectStore(CELLS_STORE);
    const blobStore2 = tx2.objectStore(BLOBS_STORE);

    await new Promise((resolve, reject) => {
      cellStore2.put(cell.toRecord());
      blobStore2.put({ id: cell.id, content });
      tx2.oncomplete = resolve;
      tx2.onerror = () => reject(tx2.error);
    });

    this.#bus?.emit('cell.created', { cell: cell.toRecord() }, 'honeycomb');
    return cell;
  }

  async readCell(pathOrId) {
    const db = this.#db;
    const { store } = txStore(db, CELLS_STORE, 'readonly');
    let record;
    // try by path index first
    try {
      record = await promisifyRequest(store.index('path').get(pathOrId));
    } catch (_) {}
    if (!record) {
      const { store: s2 } = txStore(db, CELLS_STORE, 'readonly');
      record = await promisifyRequest(s2.get(pathOrId));
    }
    if (!record) return null;

    const { store: blobStore } = txStore(db, BLOBS_STORE, 'readonly');
    const blob = await promisifyRequest(blobStore.get(record.id));
    return { cell: new Cell(record), content: blob?.content ?? null };
  }

  async updateCell(pathOrId, content, metadata = null) {
    const existing = await this.readCell(pathOrId);
    if (!existing) throw new Error(`Cell not found: ${pathOrId}`);
    const cell = existing.cell;
    const hash = await sha256Hex(content);
    let size = 0;
    if (typeof content === 'string') size = new TextEncoder().encode(content).byteLength;
    else if (content instanceof ArrayBuffer) size = content.byteLength;
    else size = new TextEncoder().encode(JSON.stringify(content)).byteLength;

    cell.hash = hash;
    cell.size = size;
    cell.updatedAt = Date.now();
    if (metadata) cell.metadata = { ...cell.metadata, ...metadata };

    const tx = this.#db.transaction([CELLS_STORE, BLOBS_STORE], 'readwrite');
    await new Promise((resolve, reject) => {
      tx.objectStore(CELLS_STORE).put(cell.toRecord());
      tx.objectStore(BLOBS_STORE).put({ id: cell.id, content });
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    this.#bus?.emit('cell.updated', { cell: cell.toRecord() }, 'honeycomb');
    return cell;
  }

  async deleteCell(pathOrId) {
    const existing = await this.readCell(pathOrId);
    if (!existing) return false;
    const cell = existing.cell;
    const tx = this.#db.transaction([CELLS_STORE, BLOBS_STORE], 'readwrite');
    await new Promise((resolve, reject) => {
      tx.objectStore(CELLS_STORE).delete(cell.id);
      tx.objectStore(BLOBS_STORE).delete(cell.id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    this.#bus?.emit('cell.deleted', { id: cell.id, path: cell.path }, 'honeycomb');
    return true;
  }

  async listCells(namespace = null) {
    const { store } = txStore(this.#db, CELLS_STORE, 'readonly');
    let records;
    if (namespace) {
      records = await promisifyRequest(store.index('namespace').getAll(namespace));
    } else {
      records = await promisifyRequest(store.getAll());
    }
    return records.map(r => new Cell(r));
  }

  async queryCells(predicate) {
    const cells = await this.listCells();
    return cells.filter(predicate);
  }

  async findByHash(hash) {
    const cells = await this.listCells();
    return cells.filter(c => c.hash === hash);
  }

  async getStats() {
    const cells = await this.listCells();
    const totalSize = cells.reduce((acc, c) => acc + (c.size || 0), 0);
    return { count: cells.length, totalSize };
  }
}
