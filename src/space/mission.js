import { propagateOrbitStep, telemetryFromState } from './physics.js';

export const MissionPhase = Object.freeze({
  READY: 'VEHICLE_READY',
  COUNTDOWN: 'COUNTDOWN',
  IGNITION: 'IGNITION',
  LIFTOFF: 'LIFTOFF',
  ASCENT: 'ASCENT',
  ORBIT_INSERTION: 'ORBIT_INSERTION',
  ORBITAL_OPERATIONS: 'ORBITAL_OPERATIONS',
  PAUSED: 'PAUSED',
  ABORTED: 'ABORTED'
});

const PHASE_TIMELINE = [
  { phase: MissionPhase.IGNITION, durationSeconds: 1, event: 'launch.ignition' },
  { phase: MissionPhase.LIFTOFF, durationSeconds: 2, event: 'launch.liftoff' },
  { phase: MissionPhase.ASCENT, durationSeconds: 8, event: 'launch.ascent' },
  { phase: MissionPhase.ORBIT_INSERTION, durationSeconds: 3, event: 'launch.orbit.insertion' },
  { phase: MissionPhase.ORBITAL_OPERATIONS, durationSeconds: 0, event: 'satellite.deployed' }
];
const FUEL_DRAIN_RATE_PER_SECOND = 0.0008;
const BATTERY_DRAIN_RATE_PER_SECOND = 0.0005;

export class SpaceMission {
  #phase = MissionPhase.READY;
  #countdownSeconds = 0;
  #timelineIndex = -1;
  #phaseElapsed = 0;
  #paused = false;
  #lastTelemetry = null;
  #logs = [];

  constructor({
    id,
    name,
    vehicle = 'HB-SAT-1',
    orbit = { altitude: 400_000, inclination: 51.6 },
    metadata = {},
    state = null
  }) {
    this.id = id || crypto.randomUUID();
    this.name = name || this.id;
    this.vehicle = vehicle;
    this.orbit = orbit;
    this.metadata = { ...metadata };
    this.createdAt = Date.now();
    this.updatedAt = Date.now();
    this.subsystemBeeIds = [];
    this.state = state || {
      position: { x: 6_771_000, y: 0, z: 0 },
      velocity: { x: 0, y: 7_670, z: 0 },
      mass: 500,
      fuel: 100,
      battery: 100,
      time: 0
    };
    this.#lastTelemetry = telemetryFromState(this.state);
    this.#log(`Mission created (${this.vehicle})`);
  }

  get phase() { return this.#phase; }
  get countdownSeconds() { return this.#countdownSeconds; }
  get paused() { return this.#paused; }
  get telemetry() { return this.#lastTelemetry; }
  get logs() { return [...this.#logs]; }

  launch(countdownSeconds = 5) {
    if (this.#phase !== MissionPhase.READY) return false;
    this.#paused = false;
    this.#phase = MissionPhase.COUNTDOWN;
    this.#countdownSeconds = Math.max(0, Math.floor(countdownSeconds));
    this.#timelineIndex = -1;
    this.#phaseElapsed = 0;
    this.#log(`Countdown started (T-${this.#countdownSeconds})`);
    return true;
  }

  pause() {
    if (this.#phase === MissionPhase.ABORTED || this.#phase === MissionPhase.READY || this.#phase === MissionPhase.PAUSED) return false;
    this.#paused = true;
    this.#phase = MissionPhase.PAUSED;
    this.#log('Mission paused');
    return true;
  }

  resume(previousPhase = MissionPhase.COUNTDOWN) {
    if (!this.#paused || this.#phase !== MissionPhase.PAUSED) return false;
    this.#paused = false;
    this.#phase = previousPhase;
    this.#log('Mission resumed');
    return true;
  }

  abort() {
    if (this.#phase === MissionPhase.ABORTED) return false;
    this.#phase = MissionPhase.ABORTED;
    this.#paused = false;
    this.#log('Mission aborted');
    return true;
  }

  tick(dtSeconds = 1) {
    if (this.#phase === MissionPhase.ABORTED || this.#phase === MissionPhase.PAUSED) {
      return { changed: false, events: [], telemetry: this.#lastTelemetry };
    }
    const dt = Math.max(0, Number(dtSeconds) || 0);
    let changed = false;
    const events = [];

    if (this.#phase === MissionPhase.COUNTDOWN) {
      this.#phaseElapsed += dt;
      while (this.#phaseElapsed >= 1 && this.#countdownSeconds > 0) {
        this.#phaseElapsed -= 1;
        this.#countdownSeconds -= 1;
        events.push({ type: 'mission.countdown', payload: { missionId: this.id, seconds: this.#countdownSeconds } });
      }
      if (this.#countdownSeconds <= 0) {
        changed = true;
        this.#advanceTimeline(events);
      }
    } else if (this.#phase !== MissionPhase.READY) {
      this.#ensureTimelineIndex();
      this.#phaseElapsed += dt;
      const timeline = PHASE_TIMELINE[this.#timelineIndex];
      if (timeline?.durationSeconds && this.#phaseElapsed >= timeline.durationSeconds) {
        changed = true;
        this.#advanceTimeline(events);
      }
    }

    if (this.#phase === MissionPhase.ORBITAL_OPERATIONS) {
      this.state = propagateOrbitStep(this.state, dt);
      this.state.fuel = Math.max(0, this.state.fuel - dt * FUEL_DRAIN_RATE_PER_SECOND);
      this.state.battery = Math.max(0, this.state.battery - dt * BATTERY_DRAIN_RATE_PER_SECOND);
      this.#lastTelemetry = telemetryFromState(this.state);
      events.push({ type: 'telemetry.updated', payload: { missionId: this.id, telemetry: this.#lastTelemetry } });
    }

    this.updatedAt = Date.now();
    return { changed, events, telemetry: this.#lastTelemetry };
  }

  snapshot() {
    return {
      id: this.id,
      name: this.name,
      vehicle: this.vehicle,
      orbit: this.orbit,
      metadata: { ...this.metadata },
      phase: this.#phase,
      countdownSeconds: this.#countdownSeconds,
      paused: this.#paused,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      subsystemBeeIds: [...this.subsystemBeeIds],
      state: { ...this.state },
      telemetry: this.#lastTelemetry,
      logs: this.logs
    };
  }

  restore(snapshot) {
    this.state = snapshot.state;
    this.subsystemBeeIds = snapshot.subsystemBeeIds || [];
    this.metadata = { ...(snapshot.metadata || {}) };
    this.#phase = snapshot.phase || MissionPhase.READY;
    this.#timelineIndex = Math.max(
      -1,
      PHASE_TIMELINE.findIndex((step) => step.phase === this.#phase)
    );
    this.#countdownSeconds = snapshot.countdownSeconds || 0;
    this.#paused = snapshot.paused || false;
    this.#lastTelemetry = snapshot.telemetry || telemetryFromState(this.state);
    this.#logs = snapshot.logs || [];
    this.updatedAt = snapshot.updatedAt || Date.now();
  }

  #advanceTimeline(events) {
    this.#timelineIndex += 1;
    this.#phaseElapsed = 0;
    const next = PHASE_TIMELINE[this.#timelineIndex];
    if (!next) return;
    this.#phase = next.phase;
    this.#log(`Transitioned to ${next.phase}`);
    events.push({ type: next.event, payload: { missionId: this.id, phase: next.phase } });
  }

  #ensureTimelineIndex() {
    if (this.#timelineIndex >= 0) return;
    const index = PHASE_TIMELINE.findIndex((step) => step.phase === this.#phase);
    this.#timelineIndex = index;
  }

  #log(message) {
    const entry = { timestamp: Date.now(), message };
    this.#logs.push(entry);
    if (this.#logs.length > 100) this.#logs.shift();
  }
}
