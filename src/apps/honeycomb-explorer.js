// HoneyBeeOS - Honeycomb Explorer Application
// Allows browsing cells, viewing metadata, searching, and viewing Honey artifacts.

import { hive } from '../kernel/hive.js';
import { Capability, CellType, Namespaces } from '../kernel/constants.js';

export const HoneycombExplorerManifest = {
  id: 'honeycomb-explorer',
  name: 'Honeycomb Explorer',
  version: '1.0.0',
  description: 'Browse and inspect cells, honey artifacts, and storage',
  permissions: [Capability.STORAGE_READ],
  storageNamespace: Namespaces.DOCUMENTS
};

export class HoneycombExplorerApp {
  #container = null;

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(HoneycombExplorerManifest.id, container);
    this.render();
    this.refresh();
  }

  render() {
    this.#container.innerHTML = `
      <div class="app honeycomb-explorer">
        <div class="app-header">
          <h2>🍯 Honeycomb Explorer</h2>
          <div class="app-controls">
            <input type="text" id="explorer-search" placeholder="Search cells..." class="search-input"/>
            <button id="explorer-refresh" class="btn">Refresh</button>
          </div>
        </div>
        <div class="app-body">
          <div class="explorer-tabs">
            <button class="tab-btn active" data-tab="cells">Cells</button>
            <button class="tab-btn" data-tab="honey">Honey Artifacts</button>
          </div>
          <div id="explorer-cells" class="tab-content active">
            <div id="cells-list" class="cells-list">Loading...</div>
          </div>
          <div id="explorer-honey" class="tab-content hidden">
            <div id="honey-list" class="honey-list">Loading...</div>
          </div>
        </div>
      </div>
    `;
    this.#container.querySelector('#explorer-refresh').addEventListener('click', () => this.refresh());
    this.#container.querySelector('#explorer-search').addEventListener('input', (e) => this.search(e.target.value));
    this.#container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.#container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        this.#container.querySelectorAll('.tab-content').forEach(c => { c.classList.remove('active'); c.classList.add('hidden'); });
        btn.classList.add('active');
        const tab = btn.dataset.tab;
        const panel = this.#container.querySelector(`#explorer-${tab}`);
        panel.classList.remove('hidden');
        panel.classList.add('active');
        if (tab === 'honey') this.refreshHoney();
      });
    });
  }

  async refresh() {
    try {
      const cells = await hive.comb.listCells();
      this.renderCells(cells);
    } catch (err) {
      this.#container.querySelector('#cells-list').textContent = `Error: ${err.message}`;
    }
  }

  async search(query) {
    try {
      if (!query) return this.refresh();
      const results = await hive.scout(query);
      const cells = results?.results || [];
      this.renderCells(cells);
    } catch (err) {}
  }

  renderCells(cells) {
    const list = this.#container.querySelector('#cells-list');
    if (!cells || cells.length === 0) {
      list.innerHTML = '<p class="empty-state">No cells found</p>';
      return;
    }
    list.innerHTML = cells.map(c => {
      const cell = c.toRecord ? c.toRecord() : c;
      return `
        <div class="cell-item" data-id="${cell.id}">
          <div class="cell-icon">${this.#iconForType(cell.type)}</div>
          <div class="cell-info">
            <div class="cell-path">${cell.path}</div>
            <div class="cell-meta">${cell.type} · ${this.#formatSize(cell.size)} · ${this.#formatDate(cell.updatedAt)}</div>
          </div>
          <button class="btn-small inspect-btn" data-path="${cell.path}">Inspect</button>
        </div>
      `;
    }).join('');
    list.querySelectorAll('.inspect-btn').forEach(btn => {
      btn.addEventListener('click', () => this.inspectCell(btn.dataset.path));
    });
  }

  async inspectCell(path) {
    const result = await hive.comb.readCell(path);
    if (!result) return;
    const { cell, content } = result;
    const record = cell.toRecord ? cell.toRecord() : cell;
    const preview = typeof content === 'string' ? content.slice(0, 500) : JSON.stringify(content).slice(0, 500);
    alert(`Cell: ${record.path}\nType: ${record.type}\nSize: ${this.#formatSize(record.size)}\nHash: ${record.hash}\nContent preview:\n${preview}`);
  }

  async refreshHoney() {
    const honey = hive.honeyStore.listAll();
    const list = this.#container.querySelector('#honey-list');
    if (!honey || honey.length === 0) {
      list.innerHTML = '<p class="empty-state">No honey artifacts yet</p>';
      return;
    }
    list.innerHTML = honey.map(h => `
      <div class="honey-item">
        <div class="honey-icon">🍯</div>
        <div class="honey-info">
          <div class="honey-type">${h.type}</div>
          <div class="honey-hash" title="${h.hash}">${h.hash.slice(0, 16)}...</div>
          <div class="honey-meta">From bee: ${h.producerBeeId?.slice(0, 8)}... · ${this.#formatDate(h.createdAt)}</div>
        </div>
      </div>
    `).join('');
  }

  #iconForType(type) {
    const icons = { TEXT: '📄', JSON: '📋', BINARY: '💾', APPLICATION: '📦', SYSTEM: '⚙️' };
    return icons[type] || '📄';
  }
  #formatSize(bytes) {
    if (!bytes) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
  #formatDate(ts) {
    if (!ts) return '';
    return new Date(ts).toLocaleString();
  }
}
