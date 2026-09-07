// HoneyBeeOS - Boot Entry Point
// Initializes the kernel and then the UI.
// The kernel is always initialized before any UI code runs.

import { hive } from './kernel/hive.js';
import { initDesktop } from './ui/desktop.js';
import { PheromoneType } from './ipc/pheromones.js';

const bootLog = document.getElementById('boot-log');
const bootScreen = document.getElementById('boot-screen');

function bootPrint(msg) {
  if (bootLog) {
    const line = document.createElement('div');
    line.textContent = `> ${msg}`;
    bootLog.appendChild(line);
  }
}

async function boot() {
  bootPrint('HONEYBEEOS v1.0.0');
  bootPrint('Hive initializing...');

  try {
    await hive.start();
    bootPrint('Bee Runtime ready');
    bootPrint('Honeycomb storage ready');
    bootPrint('Pheromone bus ready');
    bootPrint('Security guard ready');
    bootPrint('Scheduler ready');
    bootPrint('Queen initializing...');
    bootPrint('Hive ready.');

    // Register network status
    window.addEventListener('online', () => hive.bus?.emit(PheromoneType.NETWORK_ONLINE, {}, 'network'));
    window.addEventListener('offline', () => hive.bus?.emit(PheromoneType.NETWORK_OFFLINE, {}, 'network'));

    // Expose hive globally for shell button handlers (shell uses window.hive)
    window.hive = hive;

    // Register service worker
    if ('serviceWorker' in navigator) {
      try {
        await navigator.serviceWorker.register('./sw.js');
        bootPrint('Service worker registered');
      } catch (err) {
        bootPrint(`Service worker skipped: ${err.message}`);
      }
    }

    // Dismiss boot screen
    await new Promise(r => setTimeout(r, 600));
    if (bootScreen) {
      bootScreen.style.transition = 'opacity 0.5s';
      bootScreen.style.opacity = '0';
      setTimeout(() => bootScreen.remove(), 500);
    }

    // Initialize desktop UI
    await initDesktop();

  } catch (err) {
    bootPrint(`BOOT ERROR: ${err.message}`);
    console.error('Boot failed:', err);
    const errEl = document.createElement('div');
    errEl.style.cssText = 'color:red;margin-top:16px;';
    errEl.textContent = `Boot failed: ${err.message}`;
    bootLog?.appendChild(errEl);
  }
}

boot();
