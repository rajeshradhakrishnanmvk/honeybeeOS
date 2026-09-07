// HoneyBeeOS - Hive Task Manager Application

import { hive } from '../kernel/hive.js';
import { Capability, TaskPriority, TaskState } from '../kernel/constants.js';
import { PheromoneType } from '../ipc/pheromones.js';

export const TaskManagerManifest = {
  id: 'task-manager',
  name: 'Hive Task Manager',
  version: '1.0.0',
  description: 'Submit, monitor and manage tasks',
  permissions: [Capability.TASK_CREATE, Capability.TASK_CANCEL, Capability.STORAGE_READ]
};

export class TaskManagerApp {
  #container = null;
  #unsubscribers = [];
  #refreshInterval = null;

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(TaskManagerManifest.id, container);
    this.render();
    this.refresh();

    // Subscribe to task pheromones
    const handler = () => this.refresh();
    [PheromoneType.TASK_CREATED, PheromoneType.TASK_COMPLETED, PheromoneType.TASK_FAILED, PheromoneType.TASK_CANCELLED].forEach(type => {
      hive.bus.on(type, handler);
      this.#unsubscribers.push(() => hive.bus.off(type, handler));
    });
  }

  unmount() {
    this.#unsubscribers.forEach(fn => fn());
    if (this.#refreshInterval) clearInterval(this.#refreshInterval);
  }

  render() {
    this.#container.innerHTML = `
      <div class="app task-manager">
        <div class="app-header">
          <h2>🐝 Hive Task Manager</h2>
          <div class="app-controls">
            <select id="task-type" class="select-input">
              <option value="compute:fibonacci">Fibonacci</option>
              <option value="compute:prime">Prime Sieve</option>
              <option value="compute:hash">Hash</option>
              <option value="compute:sort">Sort</option>
              <option value="generic">Generic</option>
            </select>
            <select id="task-priority" class="select-input">
              <option value="1">Normal</option>
              <option value="0">Low</option>
              <option value="2">High</option>
              <option value="3">Critical</option>
            </select>
            <button id="submit-task" class="btn">Submit Task</button>
            <button id="submit-100" class="btn">Submit 100</button>
          </div>
        </div>
        <div class="app-body two-col">
          <div class="col">
            <h3>Active Bees</h3>
            <div id="bees-list" class="bees-list"></div>
          </div>
          <div class="col">
            <h3>Tasks</h3>
            <div id="tasks-list" class="tasks-list"></div>
          </div>
        </div>
      </div>
    `;
    this.#container.querySelector('#submit-task').addEventListener('click', () => this.submitTask());
    this.#container.querySelector('#submit-100').addEventListener('click', () => this.submitBatch(100));
    this.#refreshInterval = setInterval(() => this.refresh(), 500);
  }

  async submitTask() {
    const type = this.#container.querySelector('#task-type').value;
    const priority = parseInt(this.#container.querySelector('#task-priority').value);
    const payload = this.#defaultPayload(type);
    hive.submitTask({ type, payload, priority });
  }

  async submitBatch(count) {
    for (let i = 0; i < count; i++) {
      const types = ['compute:fibonacci', 'compute:prime', 'compute:hash', 'compute:sort'];
      const type = types[i % types.length];
      hive.submitTask({ type, payload: this.#defaultPayload(type), priority: TaskPriority.NORMAL });
    }
  }

  #defaultPayload(type) {
    switch (type) {
      case 'compute:fibonacci': return { n: 30 + Math.floor(Math.random() * 10) };
      case 'compute:prime': return { limit: 5000 + Math.floor(Math.random() * 5000) };
      case 'compute:hash': return { data: `data-${Date.now()}-${Math.random()}` };
      case 'compute:sort': return { array: Array.from({ length: 1000 }, () => Math.random()) };
      default: return { delay: Math.floor(Math.random() * 200) };
    }
  }

  refresh() {
    this.renderBees();
    this.renderTasks();
  }

  renderBees() {
    const list = this.#container?.querySelector('#bees-list');
    if (!list) return;
    const bees = hive.listBees();
    if (bees.length === 0) { list.innerHTML = '<p class="empty-state">No bees</p>'; return; }
    list.innerHTML = bees.map(b => `
      <div class="bee-item state-${b.state.toLowerCase()}">
        <span class="bee-icon">${this.#beeIcon(b.state)}</span>
        <span class="bee-id">${b.id.slice(0, 8)}</span>
        <span class="bee-state badge">${b.state}</span>
        <span class="bee-tasks">✓${b.completedTasks} ✗${b.failureCount}</span>
        <button class="btn-small" onclick="window.hive?.killBee('${b.id}')">Kill</button>
      </div>
    `).join('');
  }

  renderTasks() {
    const list = this.#container?.querySelector('#tasks-list');
    if (!list) return;
    const tasks = hive.listTasks();
    const recent = tasks.slice(-20).reverse();
    list.innerHTML = recent.map(t => `
      <div class="task-item state-${t.state.toLowerCase()}">
        <span class="task-type">${t.type}</span>
        <span class="task-state badge">${t.state}</span>
        <span class="task-priority">P${t.priority}</span>
        ${t.state === 'QUEUED' ? `<button class="btn-small" onclick="window.hive?.cancelTask('${t.id}')">Cancel</button>` : ''}
      </div>
    `).join('');
  }

  #beeIcon(state) {
    const icons = { IDLE: '🐝', WORKING: '⚡', PAUSED: '⏸', FAILED: '💀', TERMINATED: '🪦', CREATED: '🥚' };
    return icons[state] || '🐝';
  }
}
