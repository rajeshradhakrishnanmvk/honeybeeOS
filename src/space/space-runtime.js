import { SpaceMission, MissionPhase } from './mission.js';

const SPACE_MISSIONS_ROOT = 'space/missions';
const SPACE_TELEMETRY_ROOT = 'space/telemetry';
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
  #persistenceCounter = 0;
  #missionResumePhases = new Map();
  #tickInProgress = false;

  init(hive) {
    this.#hive = hive;
    this.#timer = setInterval(() => this.#tick(), 1000);
  }

  shutdown() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }

  createMission({ id, name, vehicle, orbit, state } = {}) {
    const mission = new SpaceMission({ id, name, vehicle, orbit, state });
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
    if (mission.subsystemBeeIds.length > 0) return;
    for (const role of SUBSYSTEM_ROLES) {
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
    const existing = await this.#hive.comb.readCell(path);
    if (existing) return this.#hive.comb.updateCell(path, content, metadata);
    return this.#hive.comb.createCell(path, 'JSON', content, metadata);
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
}
