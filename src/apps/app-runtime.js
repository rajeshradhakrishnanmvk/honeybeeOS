// HoneyBeeOS - Application Runtime
// OS concept: Process isolation, application lifecycle
// Browser primitive: ES modules, IndexedDB for app registry
// Kernel state: installed apps, running apps
// Failure: app crash contained, emits pheromone
// UI observation: app.* pheromones

import { Capability, Namespaces } from '../kernel/constants.js';
import { PheromoneType } from '../ipc/pheromones.js';
import { kernelLog } from '../kernel/logger.js';

const APP_DB_NAME = 'honeybeeos-apps';
const APP_DB_VERSION = 1;
const MANIFESTS_STORE = 'manifests';

function openAppDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(APP_DB_NAME, APP_DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;
      if (!db.objectStoreNames.contains(MANIFESTS_STORE)) {
        db.createObjectStore(MANIFESTS_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export class AppRuntime {
  #db = null;
  #bus = null;
  #guard = null;
  #installedApps = new Map();
  #runningApps = new Map();  // appId → { instance, mountPoint }

  async init(bus, guard) {
    this.#bus = bus;
    this.#guard = guard;
    this.#db = await openAppDB();
    await this.#loadInstalledApps();
  }

  async #loadInstalledApps() {
    const tx = this.#db.transaction(MANIFESTS_STORE, 'readonly');
    const records = await new Promise((resolve, reject) => {
      const req = tx.objectStore(MANIFESTS_STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    for (const manifest of records) {
      this.#installedApps.set(manifest.id, manifest);
    }
    kernelLog.info('AppRuntime', `Loaded ${records.length} installed apps`);
  }

  async install(manifest) {
    this.#validateManifest(manifest);
    manifest.installedAt = Date.now();

    // Grant permissions
    if (this.#guard && manifest.permissions) {
      for (const perm of manifest.permissions) {
        const resource = this.#resolvePermissionResource(manifest, perm);
        await this.#guard.grantCapability({ app: manifest.id, permission: perm, resource, grantedBy: 'app-installer' });
      }
    }

    this.#installedApps.set(manifest.id, manifest);
    const tx = this.#db.transaction(MANIFESTS_STORE, 'readwrite');
    await new Promise((resolve, reject) => {
      tx.objectStore(MANIFESTS_STORE).put(manifest);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });

    this.#bus?.emit(PheromoneType.APP_INSTALLED, { appId: manifest.id, manifest }, 'app-runtime');
    kernelLog.info('AppRuntime', `Installed app: ${manifest.id}`);
    return manifest;
  }

  async uninstall(appId) {
    if (!this.#installedApps.has(appId)) throw new Error(`App not installed: ${appId}`);
    if (this.#runningApps.has(appId)) await this.stop(appId);

    this.#installedApps.delete(appId);
    const tx = this.#db.transaction(MANIFESTS_STORE, 'readwrite');
    await new Promise((resolve, reject) => {
      tx.objectStore(MANIFESTS_STORE).delete(appId);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    this.#bus?.emit(PheromoneType.APP_UNINSTALLED, { appId }, 'app-runtime');
  }

  async start(appId, mountPoint = null, hiveAPI = null) {
    if (!this.#installedApps.has(appId)) throw new Error(`App not installed: ${appId}`);
    if (this.#runningApps.has(appId)) return this.#runningApps.get(appId);

    const manifest = this.#installedApps.get(appId);

    // Enforce permissions
    if (this.#guard && manifest.permissions) {
      for (const perm of manifest.permissions) {
        const resource = this.#resolvePermissionResource(manifest, perm);
        try {
          await this.#guard.enforce(appId, perm, resource);
        } catch (err) {
          kernelLog.error('AppRuntime', `Permission check failed for ${appId}: ${err.message}`);
          throw err;
        }
      }
    }

    const instance = { appId, manifest, startedAt: Date.now(), mountPoint };
    this.#runningApps.set(appId, instance);
    this.#bus?.emit(PheromoneType.APP_STARTED, { appId, manifest }, 'app-runtime');
    kernelLog.info('AppRuntime', `Started app: ${appId}`);
    return instance;
  }

  async stop(appId) {
    if (!this.#runningApps.has(appId)) return;
    const instance = this.#runningApps.get(appId);
    this.#runningApps.delete(appId);
    this.#bus?.emit(PheromoneType.APP_STOPPED, { appId }, 'app-runtime');
    kernelLog.info('AppRuntime', `Stopped app: ${appId}`);
  }

  getManifest(appId) {
    return this.#installedApps.get(appId) || null;
  }

  list() {
    return [...this.#installedApps.values()].map(m => ({
      ...m,
      running: this.#runningApps.has(m.id)
    }));
  }

  isRunning(appId) { return this.#runningApps.has(appId); }

  #resolvePermissionResource(manifest, permission) {
    if (!manifest?.storageNamespace) return '*';
    if (permission === Capability.STORAGE_READ || permission === Capability.STORAGE_WRITE) {
      return `${manifest.storageNamespace}/*`;
    }
    return '*';
  }

  #validateManifest(manifest) {
    if (!manifest.id) throw new Error('Manifest must have an id');
    if (!manifest.name) throw new Error('Manifest must have a name');
    if (!manifest.version) throw new Error('Manifest must have a version');
    if (manifest.permissions) {
      const valid = new Set(Object.values(Capability));
      for (const perm of manifest.permissions) {
        if (!valid.has(perm)) throw new Error(`Invalid permission: ${perm}`);
      }
    }
  }
}
