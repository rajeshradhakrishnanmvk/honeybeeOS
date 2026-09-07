// HoneyBeeOS - Calculator Application
// Canonical example of the HoneyBeeOS Application SDK.
//
// The developer defines work using hive.app() — no Web Workers,
// no worker protocols, no task types. HoneyBeeOS handles everything.
//
// Developer experience:
//
//   const calculator = hive.app({ id: "calculator", name: "Calculator" });
//   calculator.work("calculate", ({ a, operator, b }) => { ... });
//   const result = await calculator.run("calculate", { a: 42, operator: "*", b: 10 });

import { hive } from '../kernel/hive.js';

// ─── Application Definition ───────────────────────────────────────────────────

export const calculator = hive.app({
  id: 'calculator',
  name: 'Calculator',
  version: '1.0.0'
});

function calculate(a, operator, b) {
  switch (operator) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/':
      if (b === 0) throw new Error('Division by zero');
      return a / b;
    default:
      throw new Error(`Unknown operator: ${operator}`);
  }
}

calculator.work('calculate', ({ a, operator, b }) => {
  return calculate(Number(a), operator, Number(b));
});

calculator.start();

// ─── Calculator UI ────────────────────────────────────────────────────────────

export const CalculatorManifest = {
  id: 'calculator',
  name: '🧮 Calculator',
  version: '1.0.0',
  description: 'Canonical HoneyBeeOS application demonstrating the Application SDK',
  permissions: []
};

export class CalculatorApp {
  #container = null;
  #display = '';
  #a = null;
  #operator = null;
  #waitingForB = false;
  #justCalculated = false;
  #taskLog = [];

  async mount(container) {
    this.#container = container;
    this.render();
  }

  render() {
    this.#container.innerHTML = `
      <div class="app calculator-app">
        <div class="calculator-header">
          <h2>🧮 Calculator</h2>
          <p class="calculator-subtitle">Powered by HoneyBeeOS Application SDK</p>
        </div>

        <div class="calculator-body">
          <!-- Calculator -->
          <div class="calculator-panel">
            <div class="calc-display" id="calc-display">0</div>
            <div class="calc-status" id="calc-status"></div>

            <div class="calc-buttons">
              <button class="calc-btn btn-clear span-2" data-action="clear">C</button>
              <button class="calc-btn btn-op" data-op="/">÷</button>
              <button class="calc-btn btn-op" data-op="*">×</button>

              <button class="calc-btn" data-num="7">7</button>
              <button class="calc-btn" data-num="8">8</button>
              <button class="calc-btn" data-num="9">9</button>
              <button class="calc-btn btn-op" data-op="-">−</button>

              <button class="calc-btn" data-num="4">4</button>
              <button class="calc-btn" data-num="5">5</button>
              <button class="calc-btn" data-num="6">6</button>
              <button class="calc-btn btn-op" data-op="+">+</button>

              <button class="calc-btn" data-num="1">1</button>
              <button class="calc-btn" data-num="2">2</button>
              <button class="calc-btn" data-num="3">3</button>
              <button class="calc-btn btn-equals span-col-2" data-action="equals">=</button>

              <button class="calc-btn span-2" data-num="0">0</button>
              <button class="calc-btn" data-num=".">.</button>
            </div>
          </div>

          <!-- OS Activity log -->
          <div class="calculator-os-panel">
            <div class="os-panel-title">🐝 HoneyBeeOS Activity</div>
            <div class="os-panel-subtitle">What happens under the hood</div>
            <div class="calc-task-log" id="calc-task-log">
              <div class="log-idle">Waiting for calculation…</div>
            </div>
          </div>
        </div>
      </div>
    `;

    this.#container.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-num],[data-op],[data-action]');
      if (!btn) return;
      if (btn.dataset.num !== undefined) this.#pressDigit(btn.dataset.num);
      else if (btn.dataset.op) this.#pressOperator(btn.dataset.op);
      else if (btn.dataset.action === 'clear') this.#pressClear();
      else if (btn.dataset.action === 'equals') this.#pressEquals();
    });
  }

  #pressDigit(d) {
    const display = this.#container.querySelector('#calc-display');
    if (this.#justCalculated) {
      this.#display = '';
      this.#justCalculated = false;
    }
    if (d === '.' && this.#display.includes('.')) return;
    this.#display = this.#display === '0' && d !== '.' ? d : this.#display + d;
    if (!this.#display) this.#display = '0';
    display.textContent = this.#display;
  }

  #pressOperator(op) {
    const val = parseFloat(this.#display || '0');
    if (this.#a !== null && this.#operator && !this.#waitingForB) {
      // Chain: compute previous then set new operator
      this.#performCalculation(this.#a, this.#operator, val).then(result => {
        this.#a = result;
        this.#operator = op;
        this.#display = String(result);
        this.#waitingForB = true;
        this.#justCalculated = false;
        const display = this.#container.querySelector('#calc-display');
        if (display) display.textContent = this.#display;
      });
    } else {
      this.#a = val;
      this.#operator = op;
      this.#waitingForB = true;
      this.#justCalculated = false;
    }
    this.#setStatus(`${val} ${op}`);
  }

  #pressClear() {
    this.#display = '0';
    this.#a = null;
    this.#operator = null;
    this.#waitingForB = false;
    this.#justCalculated = false;
    const display = this.#container.querySelector('#calc-display');
    if (display) display.textContent = '0';
    this.#setStatus('');
  }

  #pressEquals() {
    if (this.#a === null || !this.#operator) return;
    const b = parseFloat(this.#display || '0');
    this.#performCalculation(this.#a, this.#operator, b).then(result => {
      this.#a = result;
      this.#operator = null;
      this.#waitingForB = false;
      this.#justCalculated = true;
      this.#display = String(result);
      const display = this.#container.querySelector('#calc-display');
      if (display) display.textContent = this.#display;
    }).catch(err => {
      const display = this.#container.querySelector('#calc-display');
      if (display) display.textContent = 'Error';
      this.#setStatus(err.message);
    });
  }

  async #performCalculation(a, operator, b) {
    const startTime = Date.now();
    this.#logEntry('submitted', `Task: calculate(${a} ${operator} ${b})`);
    this.#logEntry('scheduling', '🗓 Scheduler queuing task…');

    try {
      const result = await calculator.run('calculate', { a, operator, b });
      const ms = Date.now() - startTime;
      this.#logEntry('completed', `🍯 Honey: ${result}  (${ms}ms)`);
      this.#setStatus('');
      return result;
    } catch (err) {
      this.#logEntry('failed', `❌ ${err.message}`);
      throw err;
    }
  }

  #setStatus(msg) {
    const el = this.#container.querySelector('#calc-status');
    if (el) el.textContent = msg;
  }

  #logEntry(type, message) {
    this.#taskLog.unshift({ type, message, time: Date.now() });
    if (this.#taskLog.length > 20) this.#taskLog.pop();
    this.#renderLog();
  }

  #renderLog() {
    const el = this.#container.querySelector('#calc-task-log');
    if (!el) return;

    const icons = { submitted: '📋', scheduling: '🗓', completed: '🍯', failed: '❌', bee: '🐝' };
    el.innerHTML = this.#taskLog.map(e => `
      <div class="log-entry log-${e.type}">
        <span class="log-icon">${icons[e.type] || '•'}</span>
        <span class="log-msg">${e.message}</span>
      </div>
    `).join('');
  }
}
