// HoneyBeeOS - Observatory (Real-time OS Monitor)

import { hive } from '../kernel/hive.js';
import { PheromoneType } from '../ipc/pheromones.js';
import { Capability } from '../kernel/constants.js';

export const ObservatoryManifest = {
  id: 'observatory',
  name: 'Hive Observatory',
  version: '1.0.0',
  description: 'Real-time observation of HoneyBeeOS state',
  permissions: [Capability.STORAGE_READ]
};

export class Observatory {
  #container = null;
  #canvas = null;
  #ctx = null;
  #animFrame = null;
  #unsubscribers = [];
  #pheromoneParticles = [];
  #beePositions = new Map();

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(ObservatoryManifest.id, container);
    this.render();
    this.#setupCanvas();
    this.#subscribeEvents();
    this.#startLoop();
  }

  unmount() {
    this.#unsubscribers.forEach(fn => fn());
    if (this.#animFrame) cancelAnimationFrame(this.#animFrame);
  }

  render() {
    this.#container.innerHTML = `
      <div class="app observatory">
        <div class="app-header">
          <h2>🔭 Hive Observatory</h2>
          <div class="obs-stats" id="obs-stats"></div>
        </div>
        <div class="obs-body">
          <div class="obs-section">
            <h3>Colony Visualization</h3>
            <canvas id="obs-canvas" width="600" height="200"></canvas>
          </div>
          <div class="obs-grid">
            <div class="obs-panel" id="colony-panel">
              <h4>🐝 Colony</h4>
              <div id="colony-stats"></div>
            </div>
            <div class="obs-panel" id="nectar-panel">
              <h4>🌸 Nectar Queue</h4>
              <div id="nectar-stats"></div>
            </div>
            <div class="obs-panel" id="honey-panel">
              <h4>🍯 Honey Store</h4>
              <div id="honey-stats"></div>
            </div>
            <div class="obs-panel" id="pheromone-panel">
              <h4>💨 Pheromones</h4>
              <div id="pheromone-list"></div>
            </div>
            <div class="obs-panel" id="health-panel">
              <h4>❤️ Health</h4>
              <div id="health-stats"></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  #setupCanvas() {
    this.#canvas = this.#container.querySelector('#obs-canvas');
    this.#ctx = this.#canvas?.getContext('2d');
  }

  #subscribeEvents() {
    const spawnParticle = (event) => {
      this.#pheromoneParticles.push({
        x: Math.random() * 600,
        y: Math.random() * 200,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
        life: 60,
        type: event.type,
        color: this.#colorForEvent(event.type)
      });
    };

    const handler = spawnParticle;
    hive.bus.on('*', handler);
    this.#unsubscribers.push(() => hive.bus.off('*', handler));
  }

  #colorForEvent(type) {
    if (type.startsWith('bee.')) return '#FFD700';
    if (type.startsWith('task.')) return '#00BFFF';
    if (type.startsWith('honey.')) return '#FFA500';
    if (type.startsWith('access.')) return '#FF6347';
    return '#ADFF2F';
  }

  #startLoop() {
    const loop = () => {
      this.#drawCanvas();
      this.#updateStats();
      this.#animFrame = requestAnimationFrame(loop);
    };
    this.#animFrame = requestAnimationFrame(loop);
  }

  #drawCanvas() {
    if (!this.#ctx) return;
    const ctx = this.#ctx;
    const w = 600, h = 200;
    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, w, h);

    // Draw honeycomb grid (decorative, representing real cells)
    const cells = hive.honeyStore?.listAll() || [];
    const hexR = 15;
    let cx = hexR * 2, cy = hexR * 1.5;
    for (let i = 0; i < Math.min(cells.length + 5, 20); i++) {
      ctx.beginPath();
      for (let j = 0; j < 6; j++) {
        const angle = Math.PI / 180 * (60 * j - 30);
        const x = cx + hexR * Math.cos(angle);
        const y = cy + hexR * Math.sin(angle);
        if (j === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
      ctx.strokeStyle = i < cells.length ? '#FFA500' : '#333';
      ctx.fillStyle = i < cells.length ? 'rgba(255,165,0,0.2)' : 'rgba(50,50,50,0.2)';
      ctx.fill();
      ctx.stroke();
      cx += hexR * 2.2;
      if (cx > w - hexR) { cx = hexR * 2; cy += hexR * 1.8; }
    }

    // Draw bees (real workers)
    const bees = hive.listBees();
    bees.forEach((bee, i) => {
      if (!this.#beePositions.has(bee.id)) {
        this.#beePositions.set(bee.id, {
          x: 300 + Math.random() * 200 - 100,
          y: 100 + Math.random() * 80 - 40,
          vx: (Math.random() - 0.5) * 1.5,
          vy: (Math.random() - 0.5) * 1.5
        });
      }
      const pos = this.#beePositions.get(bee.id);
      if (bee.state === 'WORKING') {
        pos.x += pos.vx * 1.5;
        pos.y += pos.vy * 0.8;
      } else if (bee.state === 'IDLE') {
        // drift slowly
        pos.x += pos.vx * 0.3;
        pos.y += pos.vy * 0.3;
      }
      // Bounce
      if (pos.x < 50 || pos.x > 550) pos.vx *= -1;
      if (pos.y < 20 || pos.y > 180) pos.vy *= -1;
      pos.x = Math.max(50, Math.min(550, pos.x));
      pos.y = Math.max(20, Math.min(180, pos.y));

      ctx.font = '16px serif';
      const icons = { WORKING: '⚡', IDLE: '🐝', FAILED: '💀', TERMINATED: '💨', PAUSED: '⏸' };
      ctx.fillText(icons[bee.state] || '🐝', pos.x - 8, pos.y + 6);
    });

    // Clean removed bees from position cache
    const beeIds = new Set(bees.map(b => b.id));
    for (const id of this.#beePositions.keys()) {
      if (!beeIds.has(id)) this.#beePositions.delete(id);
    }

    // Draw pheromone particles
    this.#pheromoneParticles = this.#pheromoneParticles.filter(p => p.life > 0);
    for (const p of this.#pheromoneParticles) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3 * (p.life / 60), 0, Math.PI * 2);
      ctx.fillStyle = p.color + Math.floor(p.life / 60 * 255).toString(16).padStart(2, '0');
      ctx.fill();
      p.x += p.vx;
      p.y += p.vy;
      p.life--;
    }
  }

  #updateStats() {
    const status = hive.status();
    const beeMetrics = status.bees || {};
    const taskMetrics = status.tasks || {};
    const health = hive.colonyHealth();
    const honey = hive.honeyStore?.listAll() || [];
    const events = hive.bus?.getHistory({ limit: 10 }) || [];

    const el = (id) => this.#container?.querySelector(`#${id}`);

    const stats = el('obs-stats');
    if (stats) stats.innerHTML = `State: ${status.state} | Uptime: ${Math.round(status.uptime / 1000)}s | v${status.version}`;

    const colony = el('colony-stats');
    if (colony) colony.innerHTML = `
      <div>Total: ${beeMetrics.total || 0}</div>
      <div>Idle: ${beeMetrics.idle || 0}</div>
      <div>Working: ${beeMetrics.working || 0}</div>
      <div>Failed: ${beeMetrics.failed || 0}</div>
    `;

    const nectar = el('nectar-stats');
    if (nectar) nectar.innerHTML = `
      <div>Queued: ${taskMetrics.queueDepth || 0}</div>
      <div>Submitted: ${taskMetrics.submitted || 0}</div>
      <div>Completed: ${taskMetrics.completed || 0}</div>
      <div>Failed: ${taskMetrics.failed || 0}</div>
      <div>Avg latency: ${taskMetrics.avgLatencyMs || 0}ms</div>
    `;

    const honeyEl = el('honey-stats');
    if (honeyEl) honeyEl.innerHTML = `<div>Artifacts: ${honey.length}</div>`;

    const phero = el('pheromone-list');
    if (phero) phero.innerHTML = events.slice().reverse().map(e =>
      `<div class="phero-event">${new Date(e.timestamp).toLocaleTimeString()} ${e.type}</div>`
    ).join('');

    const healthEl = el('health-stats');
    if (healthEl) healthEl.innerHTML = `
      <div>Status: ${health.healthy ? '✅ Healthy' : '⚠️ Issues'}</div>
      <div>Failure rate: ${(health.failureRate * 100).toFixed(1)}%</div>
      <div>Utilization: ${(health.workerUtilization * 100).toFixed(1)}%</div>
    `;
  }
}
