import { hive } from '../sdk/index.js';
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

const PLANETS = [
  'Mercury',
  'Venus',
  'Earth',
  'Mars',
  'Jupiter',
  'Saturn',
  'Uranus',
  'Neptune'
];
const TRANSFER_DAYS_PER_AU = 120;
const TRANSFER_MIN_DAYS = 20;
const TRANSFER_MAX_DAYS = 900;
const PLANET_VISUALS = {
  Mercury: { emoji: '☿️', color: '#b7b7b7', orbitSeconds: 4.4, spinSeconds: 5.8 },
  Venus: { emoji: '♀️', color: '#d8b98a', orbitSeconds: 11.2, spinSeconds: 8.5 },
  Earth: { emoji: '🌎', color: '#4fc3f7', orbitSeconds: 7.2, spinSeconds: 5.2 },
  Mars: { emoji: '🔴', color: '#d26a4a', orbitSeconds: 8.6, spinSeconds: 5.4 },
  Jupiter: { emoji: '🟠', color: '#d9a066', orbitSeconds: 13.6, spinSeconds: 3.6 },
  Saturn: { emoji: '🪐', color: '#f1d28a', orbitSeconds: 15.8, spinSeconds: 4.1 },
  Uranus: { emoji: '🟦', color: '#8fe7ef', orbitSeconds: 19.2, spinSeconds: 4.8 },
  Neptune: { emoji: '🔵', color: '#5f85ff', orbitSeconds: 22.4, spinSeconds: 4.6 }
};

function km(value) {
  const numeric = Number(value) || 0;
  return `${(numeric / 1000).toFixed(1)} km`;
}

function kms(value) {
  const numeric = Number(value) || 0;
  return `${(numeric / 1000).toFixed(2)} km/s`;
}

function percent(value) {
  const numeric = Number(value) || 0;
  return `${Math.max(0, numeric).toFixed(1)}%`;
}

function safeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function formatDayCount(days) {
  const normalized = Math.max(0, Number(days) || 0);
  if (normalized >= 365) return `${(normalized / 365).toFixed(2)} years`;
  return `${normalized.toFixed(1)} days`;
}

function orbitAU(planetName) {
  const map = {
    Mercury: 0.387,
    Venus: 0.723,
    Earth: 1,
    Mars: 1.524,
    Jupiter: 5.203,
    Saturn: 9.537,
    Uranus: 19.191,
    Neptune: 30.069
  };
  return map[planetName] || 1;
}

function transferDurationDays(fromPlanetName, toPlanetName) {
  const distanceAU = Math.abs(orbitAU(fromPlanetName) - orbitAU(toPlanetName));
  const variableDuration = distanceAU * TRANSFER_DAYS_PER_AU;
  return Math.max(TRANSFER_MIN_DAYS, Math.min(TRANSFER_MAX_DAYS, variableDuration + TRANSFER_MIN_DAYS));
}

function planetVisual(planetName) {
  return PLANET_VISUALS[planetName] || PLANET_VISUALS.Earth;
}

export class MissionControlApp {
  #container = null;
  #timer = null;
  #missionId = null;
  #opsApp = null;
  #unsubscribers = [];
  #eventFeed = [];
  #launchPlanet = 'Earth';
  #launchMessage = 'All satellite launches are performed from Mission Control.';
  #transferFromPlanet = 'Earth';
  #transferToPlanet = 'Mars';
  #logisticsMessage = 'Send launcher craft here, then launch satellites from selected planets. Transfers progress automatically over time.';

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(MissionControlManifest.id, container);
    this.#initOpsApp();
    this.#subscribeBus();
    this.render();
    this.#wireActions();
    await this.#ensureMission();
    this.#refresh();
    this.#timer = setInterval(() => this.#refresh(), 1000);
  }

  unmount() {
    if (this.#timer) clearInterval(this.#timer);
    this.#unsubscribers.forEach((fn) => fn());
    this.#unsubscribers = [];
    this.#opsApp?.stop();
  }

  #applyStageAnimation() {
    const stage = this.#container?.querySelector('#mission-stage-world');
    const planetEl = this.#container?.querySelector('#mission-stage-planet');
    const labelEl = this.#container?.querySelector('#mission-stage-label');
    const secondary = this.#container?.querySelector('#mission-stage-sat-secondary');
    const tertiary = this.#container?.querySelector('#mission-stage-sat-tertiary');
    if (!stage || !planetEl || !labelEl || !secondary || !tertiary) return;

    const visual = planetVisual(this.#launchPlanet);
    const launchedFromPlanet = hive
      .listSpaceMissions()
      .filter((mission) => (mission.metadata?.originPlanet || 'Earth') === this.#launchPlanet)
      .filter((mission) => mission.phase !== 'VEHICLE_READY' && mission.phase !== 'ABORTED').length;

    const satelliteCount = Math.max(1, Math.min(3, launchedFromPlanet));
    stage.style.setProperty('--mission-planet-accent', visual.color);
    stage.style.setProperty('--mission-orbit-duration', `${visual.orbitSeconds}s`);
    stage.style.setProperty('--mission-spin-duration', `${visual.spinSeconds}s`);
    stage.style.setProperty('--mission-orbit-duration-2', `${(visual.orbitSeconds * 1.35).toFixed(2)}s`);
    stage.style.setProperty('--mission-orbit-duration-3', `${(visual.orbitSeconds * 1.75).toFixed(2)}s`);
    planetEl.textContent = visual.emoji;
    secondary.style.display = satelliteCount >= 2 ? 'block' : 'none';
    tertiary.style.display = satelliteCount >= 3 ? 'block' : 'none';
    labelEl.textContent = `${this.#launchPlanet} orbital lane • ${satelliteCount} satellite${satelliteCount === 1 ? '' : 's'} active`;
  }

  #initOpsApp() {
    if (this.#opsApp?.isStarted()) return;
    this.#opsApp = hive
      .app({ id: 'mission-control-ops', name: 'Mission Control Ops' })
      .work('plan-transfer', ({ from, to }) => {
        const totalDays = transferDurationDays(from, to);
        return { totalDays };
      })
      .work('plan-launch-orbit', ({ missionLabel }) => {
        return {
          altitude: 180_000 + missionLabel * 12_000,
          inclination: 15 + (missionLabel * 7) % 70
        };
      })
      .start();
  }

  #subscribeBus() {
    const handler = (event) => {
      if (!event?.type) return;
      if (!event.type.startsWith('launcher.') && !event.type.startsWith('mission.') && !event.type.startsWith('launch.')) {
        return;
      }
      this.#eventFeed.unshift({
        timestamp: event.timestamp || Date.now(),
        type: event.type
      });
      if (this.#eventFeed.length > 20) this.#eventFeed.pop();
    };
    hive.bus.on('*', handler);
    this.#unsubscribers.push(() => hive.bus.off('*', handler));
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
            <div class="mission-world" id="mission-stage-world">
              <span class="mission-earth" id="mission-stage-planet">🌎</span>
              <span class="mission-orbit"></span>
              <span class="mission-orbit"></span>
              <span class="mission-sat" id="mission-stage-sat">🛰</span>
              <span class="mission-sat mission-sat-secondary" id="mission-stage-sat-secondary">🛰</span>
              <span class="mission-sat mission-sat-tertiary" id="mission-stage-sat-tertiary">🛰</span>
              <span class="mission-stage-glow"></span>
            </div>
            <div class="mission-stage-label" id="mission-stage-label">Earth orbital lane</div>
            <div class="mission-stage-note">Planet and orbit animation follow the selected launch site.</div>
          </div>
          <div class="mission-grid">
            <section class="mission-panel">
              <h3>Mission</h3>
              <div id="mission-status"></div>
              <div class="mission-controls">
                <label class="mission-launch-site">
                  <span>Launch from</span>
                  <select class="select-input" id="mission-launch-planet">
                    ${PLANETS.map((planet) => `<option value="${planet}"${planet === this.#launchPlanet ? ' selected' : ''}>${planet}</option>`).join('')}
                  </select>
                </label>
                <button class="btn btn-primary" id="mission-launch">Launch Satellite</button>
                <button class="btn" id="mission-pause">Pause</button>
                <button class="btn" id="mission-resume">Resume</button>
                <button class="btn" id="mission-abort">Abort</button>
              </div>
              <div class="mission-launch-message" id="mission-launch-message"></div>
            </section>
            <section class="mission-panel">
              <h3>Telemetry</h3>
              <div id="mission-telemetry"></div>
            </section>
            <section class="mission-panel">
              <h3>Orbital Logistics</h3>
              <div class="mission-logistics">
                <label class="mission-logistics-field">
                  <span>From</span>
                  <select class="select-input" id="mission-transfer-from">
                    ${PLANETS.map((planet) => `<option value="${planet}"${planet === this.#transferFromPlanet ? ' selected' : ''}>${planet}</option>`).join('')}
                  </select>
                </label>
                <label class="mission-logistics-field">
                  <span>To</span>
                  <select class="select-input" id="mission-transfer-to">
                    ${PLANETS.map((planet) => `<option value="${planet}"${planet === this.#transferToPlanet ? ' selected' : ''}>${planet}</option>`).join('')}
                  </select>
                </label>
                <div class="mission-logistics-actions">
                  <button class="btn" id="mission-send-launcher">Send Launcher Craft</button>
                </div>
                <div class="mission-launch-message" id="mission-logistics-message"></div>
                <div class="mission-transfer-list" id="mission-transfer-list"></div>
              </div>
            </section>
            <section class="mission-panel">
              <h3>HoneyBeeOS Activity</h3>
              <div id="mission-hive-activity"></div>
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
    this.#container.querySelector('#mission-launch-planet')?.addEventListener('change', (event) => {
      this.#launchPlanet = String(event.target.value || 'Earth');
      this.#refresh();
    });

    this.#container.querySelector('#mission-launch')?.addEventListener('click', async () => {
      await this.#launchSatelliteFromControl();
      this.#refresh();
    });

    this.#container.querySelector('#mission-transfer-from')?.addEventListener('change', (event) => {
      this.#transferFromPlanet = String(event.target.value || 'Earth');
      if (this.#transferToPlanet === this.#transferFromPlanet) {
        const alternative = PLANETS.find((planet) => planet !== this.#transferFromPlanet);
        this.#transferToPlanet = alternative || this.#transferToPlanet;
        const toSelector = this.#container.querySelector('#mission-transfer-to');
        if (toSelector) toSelector.value = this.#transferToPlanet;
      }
      this.#refresh();
    });

    this.#container.querySelector('#mission-transfer-to')?.addEventListener('change', (event) => {
      this.#transferToPlanet = String(event.target.value || 'Mars');
      this.#refresh();
    });

    this.#container.querySelector('#mission-send-launcher')?.addEventListener('click', async () => {
      await this.#sendLauncherCraftFromControl();
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

  async #sendLauncherCraftFromControl() {
    if (this.#transferFromPlanet === this.#transferToPlanet) {
      this.#logisticsMessage = 'Origin and destination must be different planets.';
      return;
    }

    const plan = this.#opsApp
      ? await this.#opsApp.run('plan-transfer', {
          from: this.#transferFromPlanet,
          to: this.#transferToPlanet
        })
      : { totalDays: transferDurationDays(this.#transferFromPlanet, this.#transferToPlanet) };
    const totalDays = Number(plan?.totalDays) || transferDurationDays(this.#transferFromPlanet, this.#transferToPlanet);

    try {
      const transfer = hive.sendLauncherCraft(this.#transferFromPlanet, this.#transferToPlanet, totalDays);
      await this.#opsApp?.store('last-transfer', {
        transferId: transfer.id,
        from: transfer.from,
        to: transfer.to,
        totalDays: transfer.totalDays,
        timestamp: Date.now()
      });
      this.#logisticsMessage = `Launcher departed ${this.#transferFromPlanet} toward ${this.#transferToPlanet}. ETA ${formatDayCount(totalDays)}.`;
    } catch (error) {
      this.#logisticsMessage = error?.message || 'Unable to send launcher craft.';
    }
  }

  async #launchSatelliteFromControl() {
    const planet = this.#launchPlanet;
    const existingFromPlanet = hive.listSpaceMissions().filter((mission) => (mission.metadata?.originPlanet || 'Earth') === planet).length;
    const missionLabel = existingFromPlanet + 1;
    const plannedOrbit = this.#opsApp
      ? await this.#opsApp.run('plan-launch-orbit', { missionLabel, planet })
      : {
          altitude: 180_000 + missionLabel * 12_000,
          inclination: 15 + (missionLabel * 7) % 70
        };

    try {
      const mission = await hive.launchSatelliteFromPlanet({
        planet,
        countdownSeconds: 5,
        id: `${planet.slice(0, 2).toUpperCase()}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`,
        name: `${planet} Orbiter ${missionLabel}`,
        vehicle: `${planet.slice(0, 3).toUpperCase()}-SAT-${String(missionLabel).padStart(2, '0')}`,
        orbit: plannedOrbit,
        metadata: {
          operator: 'mission-control'
        }
      });
      await this.#opsApp?.store('last-launch', {
        missionId: mission.id,
        missionName: mission.name,
        planet,
        orbit: plannedOrbit,
        timestamp: Date.now()
      });
      this.#missionId = mission.id;
      this.#launchMessage = `Launch queued from ${planet}: ${mission.name}.`;
    } catch (error) {
      this.#launchMessage = error?.message || `Unable to launch from ${planet}.`;
    }
  }

  async #ensureMission() {
    const existing = hive.listSpaceMissions();
    if (existing.length > 0) {
      this.#missionId = existing[0].id;
      return;
    }
    const mission = hive.createSpaceMission({
      id: `HB-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      name: 'HoneyBee Explorer',
      vehicle: 'HB-SAT-001',
      orbit: { altitude: 400_000, inclination: 51.6 },
      metadata: { originPlanet: 'Earth', launchSite: 'Earth' }
    });
    this.#missionId = mission.id;
  }

  #refresh() {
    const launchInventory = hive.getLauncherInventory();
    const availableAtSelected = Number(launchInventory?.[this.#launchPlanet] || 0);
    const mission = this.#missionId ? hive.getSpaceMission(this.#missionId) : null;
    const stage = this.#container?.querySelector('#mission-stage-world');

    this.#applyStageAnimation();
    if (stage) {
      const phase = String(mission?.phase || 'VEHICLE_READY');
      const boosted = phase === 'LIFTOFF' || phase === 'ASCENT' || phase === 'ORBIT_INSERTION';
      stage.style.setProperty('--mission-sat-scale', boosted ? '1.22' : '1');
      stage.style.setProperty('--mission-thruster-opacity', boosted ? '0.95' : '0.25');
    }

    const telemetry = mission?.telemetry || {};
    const status = this.#container.querySelector('#mission-status');
    if (status) {
      status.innerHTML = `
        <div>Status: <strong>${safeText(mission?.phase || 'NO_ACTIVE_MISSION')}</strong></div>
        <div>Mission: ${safeText(mission?.name || 'None')}</div>
        <div>Vehicle: ${safeText(mission?.vehicle || 'None')}</div>
        <div>Subsystem Bees: ${mission?.subsystemBeeIds?.length || 0}</div>
        <div>Selected Launch Site: ${safeText(this.#launchPlanet)} (${availableAtSelected} launcher craft ready)</div>
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

    const logs = (mission?.logs || []).slice(-20).reverse();
    const logsEl = this.#container.querySelector('#mission-log');
    if (logsEl) {
      logsEl.innerHTML = logs.length
        ? logs.map((entry) => `<div>${new Date(entry.timestamp).toLocaleTimeString()} • ${safeText(entry.message)}</div>`).join('')
        : '<div class="empty-state">No mission events yet.</div>';
    }

    const launchMessage = this.#container.querySelector('#mission-launch-message');
    if (launchMessage) {
      launchMessage.textContent = this.#launchMessage;
    }

    const logisticsMessage = this.#container.querySelector('#mission-logistics-message');
    if (logisticsMessage) {
      logisticsMessage.textContent = this.#logisticsMessage;
    }

    const transferList = this.#container.querySelector('#mission-transfer-list');
    if (transferList) {
      const transfers = hive.listLauncherTransfers();
      const inventory = PLANETS
        .map((planet) => `${planet}: ${Number(launchInventory?.[planet] || 0)}`)
        .join(' • ');

      transferList.innerHTML = `
        <div class="solar-source-note">Launcher inventory by planet: ${safeText(inventory)}</div>
        ${transfers.length
          ? transfers.map((transfer) => {
              const progress = transfer.totalDays > 0
                ? ((transfer.totalDays - transfer.remainingDays) / transfer.totalDays) * 100
                : 100;
              return `
                <div class="mission-transfer-row">
                  <div class="mission-transfer-title">${safeText(transfer.id)} • ${safeText(transfer.from)} → ${safeText(transfer.to)}</div>
                  <div class="mission-transfer-meta">ETA ${formatDayCount(transfer.remainingDays)} • ${Math.max(0, Math.min(100, progress)).toFixed(1)}% complete</div>
                  <div class="mission-transfer-progress"><span style="width:${Math.max(0, Math.min(100, progress)).toFixed(1)}%"></span></div>
                </div>
              `;
            }).join('')
          : '<div class="empty-state">No launcher transfers in transit.</div>'}
      `;
    }

    const hiveActivity = this.#container.querySelector('#mission-hive-activity');
    if (hiveActivity) {
      const status = hive.status();
      const beeMetrics = status.bees || {};
      const taskMetrics = status.tasks || {};
      const events = this.#eventFeed.length
        ? this.#eventFeed
        : (hive.bus?.getHistory({ limit: 8 }) || [])
            .filter((event) => event?.type)
            .map((event) => ({ timestamp: event.timestamp, type: event.type }));

      hiveActivity.innerHTML = `
        <div class="mission-hive-stats">Bees: ${beeMetrics.total || 0} total, ${beeMetrics.working || 0} working</div>
        <div class="mission-hive-stats">Tasks: ${taskMetrics.queueDepth || 0} queued, ${taskMetrics.completed || 0} completed</div>
        <div class="mission-hive-stats">Honey Artifacts: ${(hive.honeyStore?.listAll() || []).length}</div>
        <div class="mission-hive-events">
          ${events.length
            ? events.slice(0, 8).map((event) => `<div>${new Date(event.timestamp || Date.now()).toLocaleTimeString()} • ${safeText(event.type)}</div>`).join('')
            : '<div class="empty-state">No HoneyBeeOS events yet.</div>'}
        </div>
      `;
    }
  }
}
