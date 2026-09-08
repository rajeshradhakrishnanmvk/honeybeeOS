import { SpaceMission, MissionPhase } from './mission.js';

const SPACE_MISSIONS_ROOT = 'space/missions';
const SPACE_TELEMETRY_ROOT = 'space/telemetry';
const INITIAL_EARTH_LAUNCHERS = 6;
const TRANSFER_DAYS_PER_TICK = 5;
const SUBSYSTEM_ROLES = [
  'flight-computer',
  'guidance',
  'navigation',
  'propulsion',
  'power',
  'thermal',
  'communications',
  'payload'
];

export class SpaceRuntime {
  #missions = new Map();
  #hive = null;
  #timer = null;
  #tickSeconds = 1;
  #transferDaysPerTick = TRANSFER_DAYS_PER_TICK;
  #persistenceCounter = 0;
  #missionResumePhases = new Map();
  #tickInProgress = false;
  #writeLocks = new Map();
  #planetLauncherInventory = new Map([['Earth', INITIAL_EARTH_LAUNCHERS]]);
  #launcherTransfers = [];

  init(hive) {
    this.#hive = hive;
    this.#timer = setInterval(() => this.#tick(), 1000);
  }

  shutdown() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  createMission({ id, name, vehicle, orbit, metadata, state } = {}) {
    const mission = new SpaceMission({ id, name, vehicle, orbit, metadata, state });
    this.#missions.set(mission.id, mission);
    this.#emit('mission.created', mission.snapshot());
    this.#persistMission(mission).catch(() => {});
    return mission.snapshot();
  }

  listMissions() {
    return [...this.#missions.values()].map(m => m.snapshot());
  }

  getMission(id) {
    return this.#missions.get(id)?.snapshot() || null;
  }

  async launchMission(id, countdownSeconds = 5) {
    const mission = this.#requireMission(id);
    if (!mission.launch(countdownSeconds)) return mission.snapshot();
    await this.#spawnSubsystemBees(mission);
    this.#emit('mission.launch.requested', { missionId: id, countdownSeconds });
    await this.#persistMission(mission);
    return mission.snapshot();
  }

  getLauncherInventory() {
    return Object.fromEntries(this.#planetLauncherInventory.entries());
  }

  listLauncherTransfers() {
    return this.#launcherTransfers.map((transfer) => ({ ...transfer }));
  }

  sendLauncherCraft(fromPlanet, toPlanet, totalDays) {
    const from = String(fromPlanet || 'Earth');
    const to = String(toPlanet || 'Earth');
    const days = Math.max(1, Number(totalDays) || 1);

    if (from === to) throw new Error('Origin and destination must be different planets');
    const available = this.#launcherCount(from);
    if (available <= 0) throw new Error(`No launcher craft available at ${from}`);

    this.#planetLauncherInventory.set(from, Math.max(0, available - 1));
    const transfer = {
      id: `XFER-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
      from,
      to,
      totalDays: days,
      remainingDays: days,
      createdAt: Date.now()
    };
    this.#launcherTransfers.push(transfer);
    this.#emit('launcher.transfer.started', transfer);
    return { ...transfer };
  }

  advanceLauncherTransfers(elapsedDays) {
    const days = Math.max(0, Number(elapsedDays) || 0);
    if (days <= 0 || !this.#launcherTransfers.length) return [];

    const arrived = [];
    this.#launcherTransfers = this.#launcherTransfers.filter((transfer) => {
      transfer.remainingDays = Math.max(0, transfer.remainingDays - days);
      if (transfer.remainingDays <= 0) {
        arrived.push({ ...transfer });
        return false;
      }
      return true;
    });

    for (const transfer of arrived) {
      this.#planetLauncherInventory.set(transfer.to, this.#launcherCount(transfer.to) + 1);
      this.#emit('launcher.transfer.arrived', transfer);
    }

    return arrived;
  }

  async launchSatelliteFromPlanet({
    planet = 'Earth',
    countdownSeconds = 5,
    id,
    name,
    vehicle,
    orbit,
    metadata = {}
  } = {}) {
    const originPlanet = String(planet || 'Earth');
    const available = this.#launcherCount(originPlanet);
    if (available <= 0) {
      const inbound = this.#nextInboundTransfer(originPlanet);
      if (inbound) {
        throw new Error(
          `No launcher craft available at ${originPlanet} yet. Inbound transfer ${inbound.id} from ${inbound.from} arrives in ${inbound.remainingDays.toFixed(1)} days.`
        );
      }
      throw new Error(`No launcher craft available at ${originPlanet}`);
    }

    const mission = this.createMission({
      id,
      name,
      vehicle,
      orbit,
      metadata: {
        ...metadata,
        originPlanet,
        launchSite: originPlanet
      }
    });

    this.#planetLauncherInventory.set(originPlanet, Math.max(0, available - 1));
    this.#emit('launcher.consumed', { planet: originPlanet, missionId: mission.id });
    return this.launchMission(mission.id, countdownSeconds);
  }

  pauseMission(id) {
    const mission = this.#requireMission(id);
    const previousPhase = mission.phase;
    if (mission.pause()) {
      this.#missionResumePhases.set(id, previousPhase);
      this.#emit('mission.paused', { missionId: id, phase: previousPhase });
      this.#persistMission(mission).catch(() => {});
    }
    return mission.snapshot();
  }

  resumeMission(id) {
    const mission = this.#requireMission(id);
    const previousPhase = this.#missionResumePhases.get(id) || MissionPhase.COUNTDOWN;
    if (mission.resume(previousPhase)) {
      this.#emit('mission.resumed', { missionId: id, phase: previousPhase });
      this.#persistMission(mission).catch(() => {});
    }
    return mission.snapshot();
  }

  abortMission(id) {
    const mission = this.#requireMission(id);
    if (mission.abort()) {
      this.#emit('mission.aborted', { missionId: id });
      this.#persistMission(mission).catch(() => {});
    }
    return mission.snapshot();
  }

  async #spawnSubsystemBees(mission) {
    if (mission.subsystemBeeIds.length >= SUBSYSTEM_ROLES.length) return;
    const startIndex = mission.subsystemBeeIds.length;
    for (const role of SUBSYSTEM_ROLES.slice(startIndex)) {
      const bee = await this.#hive.spawnBee({
        metadata: {
          role,
          missionId: mission.id,
          domain: 'space'
        }
      });
      mission.subsystemBeeIds.push(bee.id);
      this.#emit('mission.subsystem.spawned', { missionId: mission.id, role, beeId: bee.id });
    }
  }

  async #tick() {
    if (this.#tickInProgress) return;
    this.#tickInProgress = true;

    try {
      for (const mission of this.#missions.values()) {
        const { events } = mission.tick(this.#tickSeconds);
        for (const evt of events || []) {
          this.#emit(evt.type, evt.payload);
        }
      }

      this.advanceLauncherTransfers(this.#transferDaysPerTick);

      this.#persistenceCounter += 1;
      if (this.#persistenceCounter >= 5) {
        this.#persistenceCounter = 0;
        const writes = [...this.#missions.values()].map((mission) => this.#persistMission(mission));
        await Promise.allSettled(writes);
      }
    } finally {
      this.#tickInProgress = false;
    }
  }

  async #persistMission(mission) {
    const missionPath = `${SPACE_MISSIONS_ROOT}/${mission.id}/state.json`;
    const telemetryPath = `${SPACE_TELEMETRY_ROOT}/${mission.id}/latest.json`;
    const snapshot = mission.snapshot();
    await this.#upsertCell(missionPath, snapshot, {
      missionId: mission.id,
      phase: snapshot.phase
    });
    await this.#upsertCell(telemetryPath, snapshot.telemetry, {
      missionId: mission.id,
      type: 'latest'
    });
  }

  async #upsertCell(path, content, metadata = {}) {
    return this.#queuePathWrite(path, async () => {
      const existing = await this.#hive.comb.readCell(path);
      if (existing) return this.#hive.comb.updateCell(path, content, metadata);
      try {
        return await this.#hive.comb.createCell(path, 'JSON', content, metadata);
      } catch (_) {
        return this.#hive.comb.updateCell(path, content, metadata);
      }
    });
  }

  #emit(type, payload) {
    this.#hive.emit(type, payload, 'space-runtime');
    if (type === 'telemetry.updated' && payload?.telemetry) {
      this.#hive.produceHoney({
        type: 'telemetry:satellite',
        content: payload.telemetry,
        producerBeeId: payload.missionId,
        originatingTaskId: null,
        metadata: { missionId: payload.missionId }
      }).catch(() => {});
    }
  }

  #requireMission(id) {
    const mission = this.#missions.get(id);
    if (!mission) throw new Error(`Mission not found: ${id}`);
    return mission;
  }

  #launcherCount(planet) {
    return this.#planetLauncherInventory.get(planet) || 0;
  }

  #nextInboundTransfer(planet) {
    let candidate = null;
    for (const transfer of this.#launcherTransfers) {
      if (transfer.to !== planet) continue;
      if (!candidate || transfer.remainingDays < candidate.remainingDays) {
        candidate = transfer;
      }
    }
    return candidate;
  }

  #queuePathWrite(path, operation) {
    const previous = this.#writeLocks.get(path) || Promise.resolve();
    const next = previous
      .catch(() => {})
      .then(operation);
    this.#writeLocks.set(path, next.finally(() => {
      if (this.#writeLocks.get(path) === next) {
        this.#writeLocks.delete(path);
      }
    }));
    return next;
  }
}
