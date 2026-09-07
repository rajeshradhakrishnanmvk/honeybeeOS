// HoneyBeeOS - Security / Guard
// OS concept: Capability-based access control
// Browser primitive: IndexedDB (permission store), Promise-based enforcement
// Kernel state: granted capabilities, policies
// Failure: access denied = structured rejection + pheromone
// UI observation: access.* pheromones

import { Capability } from '../kernel/constants.js';
import { PheromoneType } from '../ipc/pheromones.js';
import { kernelLog } from '../kernel/logger.js';

const POLICY_DB_NAME = 'honeybeeos-security';
const POLICY_DB_VERSION = 1;
const GRANTS_STORE = 'grants';

function openPolicyDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(POLICY_DB_NAME, POLICY_DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(GRANTS_STORE)) {
        const s = db.createObjectStore(GRANTS_STORE, { keyPath: 'id' });
        s.createIndex('appId', 'appId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const VALID_CAPABILITIES = new Set(Object.values(Capability));

export class Guard {
  #db = null;
  #bus = null;
  #memoryGrants = new Map(); // "appId:capability:resource" → grant

  async init(bus) {
    this.#bus = bus;
    this.#db = await openPolicyDB();
    await this.#loadGrants();
  }

  async #loadGrants() {
    const tx = this.#db.transaction(GRANTS_STORE, 'readonly');
    const store = tx.objectStore(GRANTS_STORE);
    const records = await new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const record of records) {
      const key = `${record.appId}:${record.capability}:${record.resource}`;
      this.#memoryGrants.set(key, record);
    }
  }

  #validateCapability(capability) {
    if (!VALID_CAPABILITIES.has(capability)) {
      throw new Error(`Invalid capability: ${capability}`);
    }
  }

  async requestCapability({ app, permission, resource = '*' }) {
    this.#validateCapability(permission);
    const key = `${app}:${permission}:${resource}`;

    this.#bus?.emit(PheromoneType.ACCESS_REQUESTED, { app, permission, resource }, 'guard');

    // Check if already granted
    if (this.#memoryGrants.has(key)) {
      const grant = this.#memoryGrants.get(key);
      if (!grant.revoked) {
        this.#bus?.emit(PheromoneType.ACCESS_GRANTED, { app, permission, resource }, 'guard');
        return { granted: true, capability: permission, resource, app };
      }
    }

    // Check wildcard
    const wildcardKey = `${app}:${permission}:*`;
    if (this.#memoryGrants.has(wildcardKey)) {
      const grant = this.#memoryGrants.get(wildcardKey);
      if (!grant.revoked) {
        this.#bus?.emit(PheromoneType.ACCESS_GRANTED, { app, permission, resource }, 'guard');
        return { granted: true, capability: permission, resource, app };
      }
    }

    // Default deny
    this.#bus?.emit(PheromoneType.ACCESS_DENIED, { app, permission, resource }, 'guard');
    kernelLog.warn('Guard', `Access denied: ${app} → ${permission} on ${resource}`);
    return { granted: false, capability: permission, resource, app };
  }

  async grantCapability({ app, permission, resource = '*', grantedBy = 'system' }) {
    this.#validateCapability(permission);
    const id = crypto.randomUUID();
    const grant = { id, appId: app, capability: permission, resource, grantedBy, grantedAt: Date.now(), revoked: false };

    const key = `${app}:${permission}:${resource}`;
    this.#memoryGrants.set(key, grant);

    const tx = this.#db.transaction(GRANTS_STORE, 'readwrite');
    await new Promise((resolve, reject) => {
      tx.objectStore(GRANTS_STORE).put(grant);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    kernelLog.info('Guard', `Granted ${permission} to ${app} on ${resource}`);
    return grant;
  }

  async revokeCapability({ app, permission, resource = '*' }) {
    const key = `${app}:${permission}:${resource}`;
    const grant = this.#memoryGrants.get(key);
    if (grant) {
      grant.revoked = true;
      const tx = this.#db.transaction(GRANTS_STORE, 'readwrite');
      await new Promise((resolve, reject) => {
        tx.objectStore(GRANTS_STORE).put(grant);
        tx.oncomplete = resolve;
        tx.onerror = () => reject(tx.error);
      });
    }
  }

  async enforce(app, permission, resource = '*') {
    const result = await this.requestCapability({ app, permission, resource });
    if (!result.granted) {
      throw new Error(`Permission denied: ${app} requires ${permission} on ${resource}`);
    }
    return true;
  }

  listGrants(appId = null) {
    const grants = [...this.#memoryGrants.values()];
    if (appId) return grants.filter(g => g.appId === appId && !g.revoked);
    return grants.filter(g => !g.revoked);
  }
}
