// HoneyBeeOS - Desktop UI
// Visualizes real kernel state. No fake metrics.

import { hive } from '../kernel/hive.js';
import { PheromoneType } from '../ipc/pheromones.js';
import { HoneycombExplorerApp, HoneycombExplorerManifest } from '../apps/honeycomb-explorer.js';
import { TaskManagerApp, TaskManagerManifest } from '../apps/task-manager.js';
import { TextEditorApp, TextEditorManifest } from '../apps/text-editor.js';
import { HiveShell, ShellManifest } from '../apps/shell.js';
import { Observatory, ObservatoryManifest } from '../apps/observatory.js';
import { CalculatorApp, CalculatorManifest } from '../apps/calculator.js';
import { SolarSystemApp, SolarSystemManifest } from '../apps/solar-system.js';

let windowZIndex = 100;
const openWindows = new Map();

const APP_DEFS = {
  'honeycomb-explorer':  { title: '🍯 Honeycomb Explorer', w: 700, h: 500, App: HoneycombExplorerApp, Manifest: HoneycombExplorerManifest },
  'task-manager':        { title: '🐝 Task Manager',       w: 750, h: 550, App: TaskManagerApp,       Manifest: TaskManagerManifest },
  'text-editor':         { title: '📝 Text Editor',        w: 700, h: 550, App: TextEditorApp,        Manifest: TextEditorManifest },
  'hive-shell':          { title: '🖥 Hive Shell',         w: 600, h: 450, App: HiveShell,            Manifest: ShellManifest },
  'observatory':         { title: '🔭 Observatory',        w: 800, h: 600, App: Observatory,          Manifest: ObservatoryManifest },
  'calculator':          { title: '🧮 Calculator',         w: 680, h: 520, App: CalculatorApp,        Manifest: CalculatorManifest },
  'solar-system':        { title: '🪐 Solar System',       w: 980, h: 700, App: SolarSystemApp,       Manifest: SolarSystemManifest }
};

function manifestNeedsSync(installed, builtin) {
  if (!installed) return true;
  if (installed.version !== builtin.version) return true;
  if ((installed.storageNamespace || '') !== (builtin.storageNamespace || '')) return true;

  const installedPerms = [...(installed.permissions || [])].sort().join('|');
  const builtinPerms = [...(builtin.permissions || [])].sort().join('|');
  return installedPerms !== builtinPerms;
}

async function syncBuiltinApps() {
  for (const [appId, def] of Object.entries(APP_DEFS)) {
    const installed = hive.getAppManifest(appId);
    if (manifestNeedsSync(installed, def.Manifest)) {
      await hive.installApp(def.Manifest);
    }
  }
}

function createWindow(id, title, width, height, x, y, onClose = null) {
  const win = document.createElement('div');
  win.className = 'hive-window';
  win.id = `window-${id}`;
  win.style.cssText = `width:${width}px;height:${height}px;left:${x}px;top:${y}px;z-index:${++windowZIndex}`;

  win.innerHTML = `
    <div class="window-titlebar">
      <button class="window-close" title="Close"></button>
      <span class="window-title">${title}</span>
    </div>
    <div class="window-body" id="wb-${id}"></div>
  `;

  // Drag
  const titlebar = win.querySelector('.window-titlebar');
  let dragging = false, ox = 0, oy = 0;
  titlebar.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('window-close')) return;
    dragging = true;
    ox = e.clientX - win.offsetLeft;
    oy = e.clientY - win.offsetTop;
    win.style.zIndex = ++windowZIndex;
  });
  document.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    win.style.left = (e.clientX - ox) + 'px';
    win.style.top = (e.clientY - oy) + 'px';
  });
  document.addEventListener('mouseup', () => dragging = false);

  win.querySelector('.window-close').addEventListener('click', () => {
    onClose?.();
    win.remove();
    openWindows.delete(id);
    const taskBtn = document.querySelector(`[data-app="${id}"]`);
    if (taskBtn) taskBtn.classList.remove('active');
  });

  document.getElementById('desktop').appendChild(win);
  return win;
}

async function openApp(id) {
  if (openWindows.has(id)) {
    const { win } = openWindows.get(id);
    win.style.zIndex = ++windowZIndex;
    return;
  }

  const def = APP_DEFS[id];
  if (!def) return;

  // Ensure app is installed
  if (!hive.getAppManifest(id)) {
    await hive.installApp(def.Manifest);
  }

  const offset = openWindows.size * 25;
  let app = null;
  const win = createWindow(id, def.title, def.w, def.h, 80 + offset, 60 + offset, () => {
    app?.unmount?.();
    hive.appRuntime.stop(id).catch(() => {});
  });

  const container = document.getElementById(`wb-${id}`);
  container.style.height = '100%';
  app = new def.App();
  await app.mount(container);
  openWindows.set(id, { win, app });

  const taskBtn = document.querySelector(`[data-app="${id}"]`);
  if (taskBtn) taskBtn.classList.add('active');
}

export async function initDesktop() {
  await syncBuiltinApps();

  // Update taskbar status
  updateTaskbarStatus();
  setInterval(updateTaskbarStatus, 1000);

  // Network status
  hive.bus.on(PheromoneType.NETWORK_ONLINE, () => showNotification('Network connected 🌐'));
  hive.bus.on(PheromoneType.NETWORK_OFFLINE, () => showNotification('Network disconnected ✈️'));
  hive.bus.on(PheromoneType.BEE_DIED, (e) => showNotification(`Bee died: ${e.payload.bee?.id?.slice(0, 8)}... 💀`));

  // Wire taskbar buttons
  document.querySelectorAll('[data-app]').forEach(btn => {
    btn.addEventListener('click', () => openApp(btn.dataset.app));
  });

  // Auto-open observatory
  setTimeout(() => openApp('observatory'), 200);
}

function updateTaskbarStatus() {
  const status = hive.status();
  const indicator = document.getElementById('hive-state-indicator');
  const statusEl = document.getElementById('taskbar-status');
  if (indicator) {
    indicator.className = '';
    indicator.classList.toggle('running', status.state === 'running');
    indicator.classList.toggle('initializing', status.state === 'initializing');
  }
  if (statusEl) {
    const bees = status.bees || {};
    const tasks = status.tasks || {};
    const uptime = Math.floor((status.uptime || 0) / 1000);
    statusEl.textContent = `Bees: ${bees.working || 0}/${bees.total || 0} working | Queue: ${tasks.queueDepth || 0} | Uptime: ${uptime}s`;
  }
}

function showNotification(msg) {
  const notif = document.createElement('div');
  notif.className = 'notification';
  notif.textContent = msg;
  document.body.appendChild(notif);
  setTimeout(() => notif.remove(), 3000);
}
