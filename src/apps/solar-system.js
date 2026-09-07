import { hive } from '../kernel/hive.js';

const TAU = Math.PI * 2;
const EARTH_DAY_HOURS = 24;
const DEFAULT_SPEED = 30;
const PANEL_UPDATE_INTERVAL_MS = 100;
const SPEED_OPTIONS = [1, 7, 30, 90, 365, 3650];

const PLANETS = [
  {
    name: 'Mercury',
    color: '#b7b7b7',
    orbitAU: 0.387,
    orbitalPeriodDays: 87.969,
    rotationPeriodDays: 58.646,
    radius: 4,
    initialAngle: 5.1,
    blurb: 'Fastest orbit and one of the slowest rotations in the Solar System.'
  },
  {
    name: 'Venus',
    color: '#d8b98a',
    orbitAU: 0.723,
    orbitalPeriodDays: 224.701,
    rotationPeriodDays: -243.025,
    radius: 6,
    initialAngle: 2.8,
    blurb: 'Retrograde rotation makes a Venus day longer than its year.'
  },
  {
    name: 'Earth',
    color: '#4fc3f7',
    orbitAU: 1,
    orbitalPeriodDays: 365.256,
    rotationPeriodDays: 0.997,
    radius: 6,
    initialAngle: 1.3,
    blurb: 'Reference world for day length, year length, and orbital scaling.'
  },
  {
    name: 'Mars',
    color: '#d26a4a',
    orbitAU: 1.524,
    orbitalPeriodDays: 686.98,
    rotationPeriodDays: 1.026,
    radius: 5,
    initialAngle: 0.3,
    blurb: 'Mars rotates nearly as quickly as Earth while taking almost two years to orbit.'
  },
  {
    name: 'Jupiter',
    color: '#d9a066',
    orbitAU: 5.203,
    orbitalPeriodDays: 4332.59,
    rotationPeriodDays: 0.4135,
    radius: 11,
    initialAngle: 4.2,
    blurb: 'The largest planet spins in under 10 hours and circles the Sun in almost 12 years.'
  },
  {
    name: 'Saturn',
    color: '#f1d28a',
    orbitAU: 9.537,
    orbitalPeriodDays: 10759.22,
    rotationPeriodDays: 0.444,
    radius: 10,
    initialAngle: 5.7,
    blurb: 'Rapid rotation and broad rings make Saturn visually distinctive.'
  },
  {
    name: 'Uranus',
    color: '#8fe7ef',
    orbitAU: 19.191,
    orbitalPeriodDays: 30685.4,
    rotationPeriodDays: -0.718,
    radius: 8,
    initialAngle: 3.4,
    blurb: "Retrograde spin reflects Uranus's extreme axial tilt."
  },
  {
    name: 'Neptune',
    color: '#5f85ff',
    orbitAU: 30.069,
    orbitalPeriodDays: 60189,
    rotationPeriodDays: 0.671,
    radius: 8,
    initialAngle: 1.9,
    blurb: 'The outermost major planet takes about 165 Earth years to complete one orbit.'
  }
];
const ORBIT_SCALE_DENOMINATOR = Math.log10(PLANETS[PLANETS.length - 1].orbitAU + 1);

function formatRotation(days) {
  const direction = days < 0 ? 'retrograde' : 'prograde';
  const absoluteDays = Math.abs(days);
  if (absoluteDays < 2) {
    return `${(absoluteDays * EARTH_DAY_HOURS).toFixed(1)} hours (${direction})`;
  }
  return `${absoluteDays.toFixed(1)} Earth days (${direction})`;
}

function formatOrbit(days) {
  if (days < 700) return `${days.toFixed(1)} Earth days`;
  return `${(days / 365.256).toFixed(2)} Earth years`;
}

function orbitRadiusForDisplay(orbitAU, maxRadius) {
  const normalized = Math.log10(orbitAU + 1) / ORBIT_SCALE_DENOMINATOR;
  return 44 + normalized * Math.max(120, maxRadius - 52);
}

function revolutionAngle(planet, simulationDays) {
  return planet.initialAngle + (simulationDays / planet.orbitalPeriodDays) * TAU;
}

function rotationAngle(planet, simulationDays) {
  return (simulationDays / planet.rotationPeriodDays) * TAU;
}

export const SolarSystemManifest = {
  id: 'solar-system',
  name: '🪐 Solar System',
  version: '1.0.0',
  description: 'Solar System simulation with factual planetary rotation and orbital periods',
  permissions: []
};

export class SolarSystemApp {
  #container = null;
  #canvas = null;
  #ctx = null;
  #animationFrame = null;
  #lastTimestamp = 0;
  #simulationDays = 0;
  #daysPerSecond = DEFAULT_SPEED;
  #paused = false;
  #selectedPlanet = 'Earth';
  #planetHitAreas = new Map();
  #stars = [];
  #lastPanelRefresh = 0;

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(SolarSystemManifest.id, container);
    this.render();
    this.#canvas = this.#container.querySelector('#solar-canvas');
    this.#ctx = this.#canvas?.getContext('2d');
    this.#seedStars();
    this.#bindEvents();
    this.#renderLegend();
    this.#renderSelectedPanel();
    this.#updatePanels(true);
    this.#startLoop();
  }

  unmount() {
    if (this.#animationFrame) cancelAnimationFrame(this.#animationFrame);
  }

  render() {
    const options = SPEED_OPTIONS.map(value => (
      `<option value="${value}"${value === DEFAULT_SPEED ? ' selected' : ''}>1 sec = ${value} Earth day${value === 1 ? '' : 's'}</option>`
    )).join('');

    this.#container.innerHTML = `
      <div class="app solar-system-app">
        <div class="app-header">
          <h2>🪐 Solar System Simulator</h2>
          <div class="solar-header-note">Relative rates use factual sidereal rotation and revolution periods.</div>
        </div>
        <div class="solar-toolbar">
          <button class="btn btn-primary" id="solar-toggle">${this.#paused ? 'Resume' : 'Pause'}</button>
          <button class="btn" id="solar-reset">Reset</button>
          <label class="solar-speed-label">
            <span>Simulation speed</span>
            <select class="select-input" id="solar-speed">${options}</select>
          </label>
          <div class="solar-clock" id="solar-clock"></div>
        </div>
        <div class="solar-layout">
          <div class="solar-stage">
            <canvas id="solar-canvas" width="860" height="480"></canvas>
            <div class="solar-stage-note">Orbit spacing is compressed for readability; planetary rates and ordering remain factual.</div>
          </div>
          <aside class="solar-sidebar">
            <section class="solar-panel" id="solar-selected-panel"></section>
            <section class="solar-panel">
              <h3>Planetary data</h3>
              <div class="solar-legend" id="solar-legend"></div>
            </section>
          </aside>
        </div>
      </div>
    `;
  }

  #bindEvents() {
    this.#container.querySelector('#solar-toggle')?.addEventListener('click', () => {
      this.#paused = !this.#paused;
      this.#container.querySelector('#solar-toggle').textContent = this.#paused ? 'Resume' : 'Pause';
      this.#lastTimestamp = 0;
    });

    this.#container.querySelector('#solar-reset')?.addEventListener('click', () => {
      this.#simulationDays = 0;
      this.#lastTimestamp = 0;
      this.#updatePanels(true);
    });

    this.#container.querySelector('#solar-speed')?.addEventListener('change', (event) => {
      this.#daysPerSecond = Number(event.target.value) || DEFAULT_SPEED;
      this.#updatePanels(true);
    });

    this.#canvas?.addEventListener('click', (event) => {
      const rect = this.#canvas.getBoundingClientRect();
      const scaleX = this.#canvas.width / rect.width;
      const scaleY = this.#canvas.height / rect.height;
      const x = (event.clientX - rect.left) * scaleX;
      const y = (event.clientY - rect.top) * scaleY;

      for (const [name, hitArea] of this.#planetHitAreas.entries()) {
        const dx = x - hitArea.x;
        const dy = y - hitArea.y;
        if (Math.hypot(dx, dy) <= hitArea.radius + 6) {
          this.#selectedPlanet = name;
          this.#renderLegend();
          this.#renderSelectedPanel();
          this.#updatePanels(true);
          return;
        }
      }
    });
  }

  #startLoop() {
    const loop = (timestamp) => {
      if (!this.#paused) {
        if (this.#lastTimestamp) {
          const elapsedSeconds = (timestamp - this.#lastTimestamp) / 1000;
          this.#simulationDays += elapsedSeconds * this.#daysPerSecond;
        }
        this.#lastTimestamp = timestamp;
      }

      this.#drawScene();
      this.#updatePanels(false, timestamp);
      this.#animationFrame = requestAnimationFrame(loop);
    };

    this.#animationFrame = requestAnimationFrame(loop);
  }

  #seedStars() {
    if (!this.#canvas) return;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    this.#stars = Array.from({ length: 140 }, (_, index) => ({
      x: Math.random() * width,
      y: Math.random() * height,
      size: 1 + Math.floor(Math.random() * 3),
      alpha: 0.2 + Math.random() * 0.6
    }));
  }

  #drawScene() {
    if (!this.#ctx || !this.#canvas) return;

    const ctx = this.#ctx;
    const width = this.#canvas.width;
    const height = this.#canvas.height;
    const centerX = width * 0.42;
    const centerY = height * 0.5;
    const orbitLimit = Math.min(centerX - 36, height / 2 - 34);

    ctx.clearRect(0, 0, width, height);

    const background = ctx.createLinearGradient(0, 0, 0, height);
    background.addColorStop(0, '#050814');
    background.addColorStop(1, '#0f1730');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);

    this.#stars.forEach((star) => {
      ctx.fillStyle = `rgba(255,255,255,${star.alpha})`;
      ctx.fillRect(star.x, star.y, star.size, star.size);
    });

    PLANETS.forEach((planet) => {
      const orbitRadius = orbitRadiusForDisplay(planet.orbitAU, orbitLimit);
      ctx.beginPath();
      ctx.arc(centerX, centerY, orbitRadius, 0, TAU);
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = planet.name === this.#selectedPlanet ? 1.8 : 1;
      ctx.stroke();
    });

    const sunGradient = ctx.createRadialGradient(centerX, centerY, 8, centerX, centerY, 28);
    sunGradient.addColorStop(0, '#fff4a3');
    sunGradient.addColorStop(0.5, '#ffb300');
    sunGradient.addColorStop(1, 'rgba(255,140,0,0.35)');
    ctx.beginPath();
    ctx.arc(centerX, centerY, 26, 0, TAU);
    ctx.fillStyle = sunGradient;
    ctx.fill();

    ctx.fillStyle = '#f9dd71';
    ctx.font = 'bold 14px system-ui';
    ctx.fillText('Sun', centerX - 14, centerY + 46);

    this.#planetHitAreas.clear();

    PLANETS.forEach((planet) => {
      const orbitRadius = orbitRadiusForDisplay(planet.orbitAU, orbitLimit);
      const angle = revolutionAngle(planet, this.#simulationDays);
      const x = centerX + Math.cos(angle) * orbitRadius;
      const y = centerY + Math.sin(angle) * orbitRadius;
      const selected = planet.name === this.#selectedPlanet;

      this.#planetHitAreas.set(planet.name, { x, y, radius: planet.radius });

      if (selected) {
        ctx.beginPath();
        ctx.arc(x, y, planet.radius + 8, 0, TAU);
        ctx.strokeStyle = 'rgba(255,215,0,0.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, planet.radius, 0, TAU);
      ctx.fillStyle = planet.color;
      ctx.fill();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rotationAngle(planet, this.#simulationDays));
      ctx.beginPath();
      ctx.moveTo(-planet.radius, 0);
      ctx.lineTo(planet.radius, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.8)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      if (planet.name === 'Saturn') {
        ctx.beginPath();
        ctx.ellipse(x, y, planet.radius + 5, planet.radius + 1.8, 0.3, 0, TAU);
        ctx.strokeStyle = 'rgba(241,210,138,0.65)';
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      ctx.fillStyle = selected ? '#ffffff' : 'rgba(255,255,255,0.72)';
      ctx.font = selected ? 'bold 12px system-ui' : '11px system-ui';
      ctx.fillText(planet.name, x + planet.radius + 6, y + 4);
    });
  }

  #updatePanels(force = false, timestamp = 0) {
    if (!force && timestamp - this.#lastPanelRefresh < PANEL_UPDATE_INTERVAL_MS) return;
    this.#lastPanelRefresh = timestamp || performance.now();

    const selected = PLANETS.find((planet) => planet.name === this.#selectedPlanet) || PLANETS[2];

    const clock = this.#container.querySelector('#solar-clock');
    if (clock) {
      clock.textContent = `Simulation day ${this.#simulationDays.toFixed(1)} • Speed ${this.#daysPerSecond} day${this.#daysPerSecond === 1 ? '' : 's'}/sec`;
    }

    const orbitProgress = ((((this.#simulationDays % selected.orbitalPeriodDays) + selected.orbitalPeriodDays) % selected.orbitalPeriodDays) / selected.orbitalPeriodDays) * 100;
    const rotationProgress = ((((this.#simulationDays / selected.rotationPeriodDays) % 1) + 1) % 1) * 100;

    const orbitValue = this.#container.querySelector('#solar-orbit-progress-value');
    if (orbitValue) orbitValue.textContent = `${orbitProgress.toFixed(1)}%`;

    const rotationValue = this.#container.querySelector('#solar-rotation-progress-value');
    if (rotationValue) rotationValue.textContent = `${rotationProgress.toFixed(1)}%`;

    const orbitBar = this.#container.querySelector('#solar-orbit-progress-bar');
    if (orbitBar) orbitBar.style.width = `${orbitProgress}%`;

    const rotationBar = this.#container.querySelector('#solar-rotation-progress-bar');
    if (rotationBar) rotationBar.style.width = `${rotationProgress}%`;
  }

  #renderSelectedPanel() {
    const selected = PLANETS.find((planet) => planet.name === this.#selectedPlanet) || PLANETS[2];
    const selectedPanel = this.#container.querySelector('#solar-selected-panel');
    if (selectedPanel) {
      selectedPanel.innerHTML = `
        <h3 id="solar-selected-title">${selected.name}</h3>
        <div class="solar-selected-meta" id="solar-selected-meta">
          <span class="solar-chip">Orbit: ${selected.orbitAU.toFixed(3)} AU</span>
          <span class="solar-chip">Year: ${formatOrbit(selected.orbitalPeriodDays)}</span>
          <span class="solar-chip">Day: ${formatRotation(selected.rotationPeriodDays)}</span>
        </div>
        <p class="solar-selected-copy" id="solar-selected-copy">${selected.blurb}</p>
        <div class="solar-progress-block">
          <div class="solar-progress-label">
            <span>Current orbit</span>
            <span id="solar-orbit-progress-value"></span>
          </div>
          <div class="solar-progress-bar"><div id="solar-orbit-progress-bar"></div></div>
        </div>
        <div class="solar-progress-block">
          <div class="solar-progress-label">
            <span>Current rotation</span>
            <span id="solar-rotation-progress-value"></span>
          </div>
          <div class="solar-progress-bar"><div id="solar-rotation-progress-bar"></div></div>
        </div>
        <div class="solar-source-note" id="solar-source-note">Simulation uses factual sidereal periods for rotation and revolution; starting positions are illustrative.</div>
      `;
    }
  }

  #renderLegend() {
    const legend = this.#container.querySelector('#solar-legend');
    if (!legend) return;

    legend.innerHTML = PLANETS.map((planet) => `
      <button class="solar-planet-row${planet.name === this.#selectedPlanet ? ' active' : ''}" data-planet="${planet.name}">
        <span class="solar-swatch" style="background:${planet.color}"></span>
        <span class="solar-planet-name">${planet.name}</span>
        <span class="solar-planet-fact">${formatOrbit(planet.orbitalPeriodDays)}</span>
      </button>
    `).join('');

    legend.querySelectorAll('[data-planet]').forEach((button) => {
      button.addEventListener('click', () => {
        this.#selectedPlanet = button.dataset.planet;
        this.#renderLegend();
        this.#renderSelectedPanel();
        this.#updatePanels(true);
      });
    });
  }
}
