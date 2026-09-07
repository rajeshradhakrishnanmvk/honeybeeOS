import { hive } from '../kernel/hive.js';
import { Capability } from '../kernel/constants.js';

export const MissionControlManifest = {
  id: 'mission-control',
  name: 'Mission Control',
  version: '1.0.0',
  description: 'Launch and operate simulated spacecraft missions',
  permissions: [
    Capability.STORAGE_READ,
    Capability.STORAGE_WRITE,
    Capability.BEE_SPAWN
  ],
  storageNamespace: 'space'
};

function km(value) {
  return `${(value / 1000).toFixed(1)} km`;
}

function kms(value) {
  return `${(value / 1000).toFixed(2)} km/s`;
}

function percent(value) {
  return `${Math.max(0, value).toFixed(1)}%`;
}

export class MissionControlApp {
  #container = null;
  #timer = null;
  #missionId = null;

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(MissionControlManifest.id, container);
    this.render();
    this.#wireActions();
    await this.#ensureMission();
    this.#refresh();
    this.#timer = setInterval(() => this.#refresh(), 1000);
  }

  unmount() {
    if (this.#timer) clearInterval(this.#timer);
  }

  render() {
    this.#container.innerHTML = `
      <div class="app mission-control-app">
        <div class="app-header">
          <h2>🚀 Mission Control</h2>
          <div class="mission-subtitle">HoneyBeeOS Space Runtime</div>
        </div>
        <div class="mission-body">
          <div class="mission-stage">
            <div class="mission-world">
              <span class="mission-earth">🌎</span>
              <span class="mission-sat">🛰</span>
              <span class="mission-orbit"></span>
            </div>
          </div>
          <div class="mission-grid">
            <section class="mission-panel">
              <h3>Mission</h3>
              <div id="mission-status"></div>
              <div class="mission-controls">
                <button class="btn btn-primary" id="mission-launch">Launch Satellite</button>
                <button class="btn" id="mission-pause">Pause</button>
                <button class="btn" id="mission-resume">Resume</button>
                <button class="btn" id="mission-abort">Abort</button>
              </div>
            </section>
            <section class="mission-panel">
              <h3>Telemetry</h3>
              <div id="mission-telemetry"></div>
            </section>
            <section class="mission-panel">
              <h3>Flight Log</h3>
              <div class="mission-log" id="mission-log"></div>
            </section>
          </div>
        </div>
      </div>
    `;
  }

  #wireActions() {
    this.#container.querySelector('#mission-launch')?.addEventListener('click', async () => {
      if (!this.#missionId) return;
      await hive.launchSpaceMission(this.#missionId, 5);
      this.#refresh();
    });

    this.#container.querySelector('#mission-pause')?.addEventListener('click', async () => {
      if (!this.#missionId) return;
      await hive.pauseSpaceMission(this.#missionId);
      this.#refresh();
    });

    this.#container.querySelector('#mission-resume')?.addEventListener('click', async () => {
      if (!this.#missionId) return;
      await hive.resumeSpaceMission(this.#missionId);
      this.#refresh();
    });

    this.#container.querySelector('#mission-abort')?.addEventListener('click', async () => {
      if (!this.#missionId) return;
      await hive.abortSpaceMission(this.#missionId);
      this.#refresh();
    });
  }

  async #ensureMission() {
    const existing = hive.listSpaceMissions();
    if (existing.length > 0) {
      this.#missionId = existing[0].id;
      return;
    }
    const mission = hive.createSpaceMission({
      id: 'HB-001',
      name: 'HoneyBee Explorer',
      vehicle: 'HB-SAT-001',
      orbit: { altitude: 400_000, inclination: 51.6 }
    });
    this.#missionId = mission.id;
  }

  #refresh() {
    if (!this.#missionId) return;
    const mission = hive.getSpaceMission(this.#missionId);
    if (!mission) return;

    const telemetry = mission.telemetry || {};
    const status = this.#container.querySelector('#mission-status');
    if (status) {
      status.innerHTML = `
        <div>Status: <strong>${mission.phase}</strong></div>
        <div>Mission: ${mission.name}</div>
        <div>Vehicle: ${mission.vehicle}</div>
        <div>Subsystem Bees: ${mission.subsystemBeeIds?.length || 0}</div>
      `;
    }

    const telemetryEl = this.#container.querySelector('#mission-telemetry');
    if (telemetryEl) {
      telemetryEl.innerHTML = `
        <div>Altitude: ${km(telemetry.altitude ?? 0)}</div>
        <div>Velocity: ${kms(telemetry.velocity ?? 0)}</div>
        <div>Fuel: ${percent(telemetry.fuel ?? 0)}</div>
        <div>Battery: ${percent(telemetry.battery ?? 0)}</div>
        <div>Mission Time: ${Math.round(telemetry.time ?? 0)}s</div>
      `;
    }

    const logs = (mission.logs || []).slice(-20).reverse();
    const logsEl = this.#container.querySelector('#mission-log');
    if (logsEl) {
      logsEl.innerHTML = logs.length
        ? logs.map((entry) => `<div>${new Date(entry.timestamp).toLocaleTimeString()} • ${entry.message}</div>`).join('')
        : '<div class="empty-state">No mission events yet.</div>';
    }
  }
}
