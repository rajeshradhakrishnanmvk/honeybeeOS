// HoneyBeeOS - Kernel Logger
// Structured logging independent of the UI

const LogLevel = Object.freeze({
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3
});

export class KernelLogger {
  #logs = [];
  #maxLogs = 5000;
  #level = LogLevel.DEBUG;
  #listeners = new Set();

  setLevel(level) {
    this.#level = level;
  }

  #record(level, component, message, data = null) {
    if (level < this.#level) return;
    const entry = {
      id: crypto.randomUUID(),
      level: Object.keys(LogLevel).find(k => LogLevel[k] === level),
      component,
      message,
      data,
      timestamp: Date.now(),
      iso: new Date().toISOString()
    };
    this.#logs.push(entry);
    if (this.#logs.length > this.#maxLogs) {
      this.#logs.shift();
    }
    this.#notify(entry);
    this.#print(entry);
    return entry;
  }

  #print(entry) {
    const prefix = `[${entry.iso}] [${entry.level}] [${entry.component}]`;
    if (entry.level === 'ERROR') {
      console.error(prefix, entry.message, entry.data || '');
    } else if (entry.level === 'WARN') {
      console.warn(prefix, entry.message, entry.data || '');
    } else {
      console.log(prefix, entry.message, entry.data || '');
    }
  }

  #notify(entry) {
    for (const listener of this.#listeners) {
      try { listener(entry); } catch (_) {}
    }
  }

  debug(component, message, data) { return this.#record(LogLevel.DEBUG, component, message, data); }
  info(component, message, data)  { return this.#record(LogLevel.INFO,  component, message, data); }
  warn(component, message, data)  { return this.#record(LogLevel.WARN,  component, message, data); }
  error(component, message, data) { return this.#record(LogLevel.ERROR, component, message, data); }

  getLogs(options = {}) {
    let logs = [...this.#logs];
    if (options.component) logs = logs.filter(l => l.component === options.component);
    if (options.level)     logs = logs.filter(l => l.level === options.level);
    if (options.since)     logs = logs.filter(l => l.timestamp >= options.since);
    if (options.limit)     logs = logs.slice(-options.limit);
    return logs;
  }

  subscribe(listener) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  clear() { this.#logs = []; }
}

export const kernelLog = new KernelLogger();
