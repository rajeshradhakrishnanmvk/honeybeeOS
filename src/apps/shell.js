// HoneyBeeOS - Command Shell Application

import { hive } from '../kernel/hive.js';
import { Capability, TaskPriority } from '../kernel/constants.js';

export const ShellManifest = {
  id: 'hive-shell',
  name: 'Hive Shell',
  version: '1.0.0',
  description: 'Command-line access to HoneyBeeOS kernel',
  permissions: [Capability.STORAGE_READ, Capability.TASK_CREATE]
};

export class HiveShell {
  #container = null;
  #output = null;
  #history = [];
  #historyIndex = -1;

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(ShellManifest.id, container);
    this.render();
  }

  render() {
    this.#container.innerHTML = `
      <div class="app shell-app">
        <div class="shell-header">
          <h2>🖥 Hive Shell</h2>
        </div>
        <div id="shell-output" class="shell-output"></div>
        <div class="shell-input-row">
          <span class="shell-prompt">hive:~ $</span>
          <input type="text" id="shell-input" class="shell-input" autocomplete="off" spellcheck="false"/>
        </div>
      </div>
    `;
    this.#output = this.#container.querySelector('#shell-output');
    const input = this.#container.querySelector('#shell-input');
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { this.execute(input.value); input.value = ''; }
      if (e.key === 'ArrowUp') { e.preventDefault(); this.historyUp(input); }
      if (e.key === 'ArrowDown') { e.preventDefault(); this.historyDown(input); }
    });
    this.print('HoneyBeeOS Shell v1.0.0', 'info');
    this.print('Type "help" for available commands', 'info');
    input.focus();
  }

  historyUp(input) {
    if (this.#historyIndex < this.#history.length - 1) {
      this.#historyIndex++;
      input.value = this.#history[this.#history.length - 1 - this.#historyIndex] || '';
    }
  }

  historyDown(input) {
    if (this.#historyIndex > 0) {
      this.#historyIndex--;
      input.value = this.#history[this.#history.length - 1 - this.#historyIndex] || '';
    } else {
      this.#historyIndex = -1;
      input.value = '';
    }
  }

  print(text, type = 'output') {
    const line = document.createElement('div');
    line.className = `shell-line shell-${type}`;
    line.textContent = text;
    this.#output.appendChild(line);
    this.#output.scrollTop = this.#output.scrollHeight;
  }

  printJSON(obj) {
    this.print(JSON.stringify(obj, null, 2), 'json');
  }

  async execute(line) {
    line = line.trim();
    if (!line) return;
    this.#history.push(line);
    this.#historyIndex = -1;
    this.print(`$ ${line}`, 'cmd');
    const [cmd, ...args] = line.split(/\s+/);
    try {
      await this.dispatch(cmd, args);
    } catch (err) {
      this.print(`Error: ${err.message}`, 'error');
    }
  }

  async dispatch(cmd, args) {
    switch (cmd) {
      case 'help': return this.cmdHelp();
      case 'hive': return this.cmdHive(args);
      case 'bee': return this.cmdBee(args);
      case 'task': return this.cmdTask(args);
      case 'comb': return this.cmdComb(args);
      case 'honey': return this.cmdHoney(args);
      case 'scout': return this.cmdScout(args);
      case 'pheromone': return this.cmdPheromone(args);
      case 'app': return this.cmdApp(args);
      case 'clear': this.#output.innerHTML = ''; return;
      default: this.print(`Unknown command: ${cmd}. Type "help" for commands.`, 'error');
    }
  }

  cmdHelp() {
    const cmds = [
      'hive status       - Show hive status',
      'hive metrics      - Show full metrics',
      'hive health       - Colony health',
      'bee list          - List all bees',
      'bee inspect <id>  - Inspect a bee',
      'bee spawn         - Spawn a new bee',
      'bee kill <id>     - Kill a bee',
      'task list         - List tasks',
      'task submit <type> - Submit a task',
      'task cancel <id>  - Cancel a task',
      'comb list         - List cells',
      'comb read <path>  - Read a cell',
      'honey list        - List honey artifacts',
      'scout <query>     - Search cells',
      'pheromone list    - Recent pheromones',
      'app list          - List apps',
      'app start <id>    - Start an app',
      'app stop <id>     - Stop an app',
      'clear             - Clear terminal'
    ];
    cmds.forEach(c => this.print(c, 'info'));
  }

  cmdHive(args) {
    const sub = args[0];
    if (!sub || sub === 'status') {
      this.printJSON(hive.status());
    } else if (sub === 'metrics') {
      this.printJSON(hive.getMetrics());
    } else if (sub === 'health') {
      this.printJSON(hive.colonyHealth());
    } else {
      this.print(`Unknown hive subcommand: ${sub}`, 'error');
    }
  }

  cmdBee(args) {
    const sub = args[0];
    if (!sub || sub === 'list') {
      const bees = hive.listBees();
      if (bees.length === 0) { this.print('No bees', 'info'); return; }
      bees.forEach(b => this.print(`${b.id.slice(0, 8)} [${b.type}] ${b.state} tasks:${b.completedTasks} fails:${b.failureCount}`));
    } else if (sub === 'inspect') {
      const id = args[1];
      if (!id) { this.print('Usage: bee inspect <id>', 'error'); return; }
      const bees = hive.listBees().filter(b => b.id.startsWith(id));
      if (!bees.length) { this.print(`Bee not found: ${id}`, 'error'); return; }
      this.printJSON(bees[0]);
    } else if (sub === 'spawn') {
      hive.spawnBee({}).then(b => this.print(`Spawned bee: ${b.id.slice(0, 8)}`, 'info')).catch(e => this.print(`Error: ${e.message}`, 'error'));
    } else if (sub === 'kill') {
      const id = args[1];
      const bees = hive.listBees().filter(b => b.id.startsWith(id));
      if (!bees.length) { this.print(`Bee not found: ${id}`, 'error'); return; }
      hive.killBee(bees[0].id).then(() => this.print(`Killed bee: ${bees[0].id.slice(0, 8)}`, 'info')).catch(e => this.print(`Error: ${e.message}`, 'error'));
    } else {
      this.print(`Unknown bee subcommand: ${sub}`, 'error');
    }
  }

  cmdTask(args) {
    const sub = args[0];
    if (!sub || sub === 'list') {
      const tasks = hive.listTasks();
      const recent = tasks.slice(-20).reverse();
      if (recent.length === 0) { this.print('No tasks', 'info'); return; }
      recent.forEach(t => this.print(`${t.id.slice(0, 8)} [${t.type}] ${t.state} P${t.priority}`));
    } else if (sub === 'submit') {
      const type = args[1] || 'compute:fibonacci';
      const task = hive.submitTask({ type, payload: {}, priority: TaskPriority.NORMAL });
      this.print(`Task submitted: ${task.id.slice(0, 8)} (${type})`, 'info');
    } else if (sub === 'cancel') {
      const id = args[1];
      const tasks = hive.listTasks().filter(t => t.id.startsWith(id));
      if (!tasks.length) { this.print(`Task not found: ${id}`, 'error'); return; }
      const cancelled = hive.cancelTask(tasks[0].id);
      this.print(cancelled ? `Cancelled task: ${id}` : `Could not cancel (not queued): ${id}`, 'info');
    } else {
      this.print(`Unknown task subcommand: ${sub}`, 'error');
    }
  }

  async cmdComb(args) {
    const sub = args[0];
    if (!sub || sub === 'list') {
      const cells = await hive.comb.listCells();
      if (!cells.length) { this.print('No cells', 'info'); return; }
      cells.forEach(c => { const r = c.toRecord ? c.toRecord() : c; this.print(`${r.path} [${r.type}] ${r.size}B`); });
    } else if (sub === 'read') {
      const path = args[1];
      if (!path) { this.print('Usage: comb read <path>', 'error'); return; }
      const result = await hive.comb.readCell(path);
      if (!result) { this.print(`Cell not found: ${path}`, 'error'); return; }
      this.printJSON({ cell: result.cell.toRecord ? result.cell.toRecord() : result.cell, contentPreview: String(result.content || '').slice(0, 200) });
    } else {
      this.print(`Unknown comb subcommand: ${sub}`, 'error');
    }
  }

  cmdHoney(args) {
    const sub = args[0] || 'list';
    if (sub === 'list') {
      const honey = hive.honeyStore.listAll();
      if (!honey.length) { this.print('No honey artifacts', 'info'); return; }
      honey.forEach(h => this.print(`${h.id.slice(0, 8)} [${h.type}] ${h.hash.slice(0, 16)}... ${h.size}B`));
    }
  }

  async cmdScout(args) {
    const query = args.join(' ');
    if (!query) { this.print('Usage: scout <query>', 'error'); return; }
    this.print(`Scouting for: "${query}"...`, 'info');
    const result = await hive.scout(query);
    this.print(`Found ${result?.count || 0} matching cells`, 'info');
    (result?.results || []).forEach(r => this.print(`  ${r.path} [${r.type}]`));
  }

  cmdPheromone(args) {
    const sub = args[0] || 'list';
    if (sub === 'list') {
      const events = hive.bus.getHistory({ limit: 20 });
      if (!events.length) { this.print('No pheromones', 'info'); return; }
      events.slice().reverse().forEach(e => this.print(`${new Date(e.timestamp).toLocaleTimeString()} ${e.type} [${e.source}]`));
    }
  }

  cmdApp(args) {
    const sub = args[0];
    if (!sub || sub === 'list') {
      const apps = hive.listApps();
      if (!apps.length) { this.print('No apps installed', 'info'); return; }
      apps.forEach(a => this.print(`${a.id} v${a.version} ${a.running ? '[running]' : '[stopped]'}`));
    } else if (sub === 'start') {
      const id = args[1];
      hive.startApp(id).then(() => this.print(`Started: ${id}`, 'info')).catch(e => this.print(`Error: ${e.message}`, 'error'));
    } else if (sub === 'stop') {
      const id = args[1];
      hive.stopApp(id).then(() => this.print(`Stopped: ${id}`, 'info')).catch(e => this.print(`Error: ${e.message}`, 'error'));
    } else {
      this.print(`Unknown app subcommand: ${sub}`, 'error');
    }
  }
}
