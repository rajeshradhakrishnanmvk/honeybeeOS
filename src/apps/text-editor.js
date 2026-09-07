// HoneyBeeOS - Text Editor Application

import { hive } from '../kernel/hive.js';
import { Capability, CellType, Namespaces } from '../kernel/constants.js';

export const TextEditorManifest = {
  id: 'text-editor',
  name: 'Text Editor',
  version: '1.0.0',
  description: 'Create and edit documents stored in Honeycomb',
  permissions: [Capability.STORAGE_READ, Capability.STORAGE_WRITE],
  storageNamespace: Namespaces.DOCUMENTS
};

export class TextEditorApp {
  #container = null;
  #currentPath = null;

  async mount(container) {
    this.#container = container;
    await hive.appRuntime.start(TextEditorManifest.id, container);
    this.render();
    this.loadDocumentList();
  }

  render() {
    this.#container.innerHTML = `
      <div class="app text-editor">
        <div class="app-header">
          <h2>📝 Text Editor</h2>
          <div class="app-controls">
            <input type="text" id="doc-name" placeholder="Document name..." class="text-input"/>
            <button id="new-doc" class="btn">New</button>
            <button id="save-doc" class="btn btn-primary">Save</button>
            <button id="import-file" class="btn">Import</button>
            <button id="export-file" class="btn">Export</button>
          </div>
        </div>
        <div class="app-body two-col">
          <div class="col col-narrow">
            <h3>Documents</h3>
            <div id="doc-list" class="doc-list"></div>
          </div>
          <div class="col col-wide">
            <div id="doc-meta" class="doc-meta hidden"></div>
            <textarea id="editor-area" class="editor-area" placeholder="Start typing..."></textarea>
          </div>
        </div>
      </div>
    `;

    this.#container.querySelector('#new-doc').addEventListener('click', () => this.newDocument());
    this.#container.querySelector('#save-doc').addEventListener('click', () => this.saveDocument());
    this.#container.querySelector('#import-file').addEventListener('click', () => this.importFile());
    this.#container.querySelector('#export-file').addEventListener('click', () => this.exportFile());
  }

  async newDocument() {
    this.#currentPath = null;
    this.#container.querySelector('#doc-name').value = `untitled-${Date.now()}`;
    this.#container.querySelector('#editor-area').value = '';
    this.#container.querySelector('#doc-meta').classList.add('hidden');
  }

  async saveDocument() {
    const nameInput = this.#container.querySelector('#doc-name').value.trim();
    if (!nameInput) return alert('Please enter a document name');
    const content = this.#container.querySelector('#editor-area').value;
    const path = `${Namespaces.DOCUMENTS}/${nameInput}`;

    try {
      const existing = await hive.comb.readCell(path);
      if (existing) {
        await hive.comb.updateCell(path, content, { editedAt: Date.now() });
      } else {
        await hive.comb.createCell(path, CellType.TEXT, content, { name: nameInput, createdBy: 'text-editor' });
      }
      this.#currentPath = path;
      this.loadDocumentList();
      this.showMeta(path);
    } catch (err) {
      alert(`Save failed: ${err.message}`);
    }
  }

  async loadDocument(path) {
    const result = await hive.comb.readCell(path);
    if (!result) return;
    const { cell, content } = result;
    this.#currentPath = path;
    const record = cell.toRecord ? cell.toRecord() : cell;
    this.#container.querySelector('#doc-name').value = record.metadata?.name || record.path.split('/').pop();
    this.#container.querySelector('#editor-area').value = content || '';
    this.showMeta(path);
  }

  async showMeta(path) {
    const result = await hive.comb.readCell(path);
    if (!result) return;
    const { cell } = result;
    const record = cell.toRecord ? cell.toRecord() : cell;
    const meta = this.#container.querySelector('#doc-meta');
    meta.classList.remove('hidden');
    meta.innerHTML = `
      <span>Path: ${record.path}</span> ·
      <span>Size: ${record.size} B</span> ·
      <span>Hash: ${(record.hash || '').slice(0, 12)}...</span> ·
      <span>Modified: ${new Date(record.updatedAt).toLocaleString()}</span>
    `;
  }

  async loadDocumentList() {
    try {
      const cells = await hive.comb.listCells(Namespaces.DOCUMENTS);
      const list = this.#container.querySelector('#doc-list');
      if (!cells || cells.length === 0) {
        list.innerHTML = '<p class="empty-state">No documents</p>';
        return;
      }
      list.innerHTML = cells.map(c => {
        const record = c.toRecord ? c.toRecord() : c;
        return `
          <div class="doc-item">
            <span class="doc-name">${record.metadata?.name || record.path.split('/').pop()}</span>
            <button class="btn-small" data-path="${record.path}">Open</button>
          </div>
        `;
      }).join('');
      list.querySelectorAll('.btn-small').forEach(btn => {
        btn.addEventListener('click', () => this.loadDocument(btn.dataset.path));
      });
    } catch (err) {}
  }

  async importFile() {
    try {
      const result = await hive.importFile();
      if (result) {
        const { cell, content } = result;
        const record = cell.toRecord ? cell.toRecord() : cell;
        this.#currentPath = record.path;
        this.#container.querySelector('#doc-name').value = record.metadata?.fileName || 'imported';
        this.#container.querySelector('#editor-area').value = content || '';
        this.loadDocumentList();
      }
    } catch (err) { alert(`Import failed: ${err.message}`); }
  }

  async exportFile() {
    if (!this.#currentPath) return alert('No document open');
    try {
      await hive.exportFile(this.#currentPath);
    } catch (err) { alert(`Export failed: ${err.message}`); }
  }
}
