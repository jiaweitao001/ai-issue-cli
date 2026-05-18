// @ts-check

const readline = require('readline');
const { formatStatusLine, splitHelpLines } = require('./components/status-list');
const { reduceDashboardEvent, reduceTaskEvent } = require('./events');
const { renderTimelineLines } = require('./components/timeline');
const { renderDashboardLines } = require('./components/dashboard');
const { filterTableRows, paginateTableRows, renderTablePage } = require('./components/table');

/**
 * terminal-kit-backed renderer. It intentionally stays inline (no alt-screen),
 * while data tables use raw stdin when available for lightweight browsing.
 */
class TuiRenderer {
  /**
   * @param {{ stdout?: ({ isTTY?: boolean } & Record<string, any>), stderr?: Record<string, any>, stdin?: ({ isTTY?: boolean, isRaw?: boolean, setRawMode?: (enabled: boolean) => void } & Record<string, any>) }} [opts]
   */
  constructor(opts) {
    const o = opts || {};
    const stdout = o.stdout || process.stdout;
    const stderr = o.stderr || process.stderr;
    const stdin = o.stdin || process.stdin;

    if (!stdout || !stdout.isTTY) {
      throw new Error('TUI requires a TTY stdout');
    }

    const hadRaw = !!(stdin && typeof stdin === 'object' && 'isRaw' in stdin);
    const previousRaw = hadRaw ? !!stdin.isRaw : false;

    try {
      // Lazy require: installs missing terminal-kit must still load the rest of
      // the CLI and explicit --tui should fail through createUi's exit-22 path.
      const terminalKit = require('terminal-kit');
      if (!terminalKit || typeof terminalKit.createTerminal !== 'function') {
        throw new Error('terminal-kit createTerminal() is unavailable');
      }
      this.term = terminalKit.createTerminal({
        stdin,
        stdout,
        stderr,
        generic: 'xterm'
      });
      this.mode = 'tui';
      this.timelineState = { tasks: {}, order: [] };
      this.timelineHeaderPrinted = false;
      this.dashboardState = { rows: {}, order: [] };
      this.dashboardHeaderPrinted = false;
      this.dashboardTitle = 'Batch Dashboard';
      this.stdin = stdin;
      this.stdout = stdout;
    } catch (err) {
      const rawChanged = hadRaw && !!stdin.isRaw !== previousRaw;
      if (stdin && typeof stdin.setRawMode === 'function' && rawChanged) {
        stdin.setRawMode(previousRaw);
      }
      if (err && err.code === 'MODULE_NOT_FOUND') {
        throw new Error('terminal-kit is not installed. Run: npm install');
      }
      throw err;
    }
  }

  /** @param {string} message */
  success(message) {
    this._write('green', `✅ ${message}\n`);
  }

  /** @param {string} message */
  error(message) {
    this._write('red', `❌ ${message}\n`);
  }

  /** @param {string} message */
  info(message) {
    this._write('blue', `ℹ️  ${message}\n`);
  }

  /** @param {string} message */
  warn(message) {
    this._write('yellow', `⚠️  ${message}\n`);
  }

  /** @param {string} message */
  debug(message) {
    if (process.env.AI_ISSUE_DEBUG === 'true') {
      this._write('gray', `[DEBUG] ${message}\n`);
    }
  }

  /** @param {...any} args */
  log(...args) {
    this.term(`${args.map(String).join(' ')}\n`);
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  highlight(text) {
    return text;
  }

  /** @param {string} text */
  header(text) {
    this.term('\n');
    this._write('cyan', `${text}\n`, true);
    this._write('cyan', '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');
  }

  /**
   * @param {Array<Array<string>>} rows
   * @param {Array<{ header: string, width?: number }>} columns
   */
  async table(rows, columns, options) {
    const opts = { showFooter: true, ...(options || {}) };
    const state = {
      page: opts.page || 1,
      pageSize: opts.pageSize || 20,
      filter: opts.filter || '',
      detailIndex: typeof opts.detailIndex === 'number' ? opts.detailIndex : undefined
    };
    const interactive = opts.interactive !== false && this._canInteract();

    this._renderTablePage(rows, columns, state, interactive);
    if (!interactive) return;

    try {
      while (true) {
        const key = await this._readKey();
        const shouldContinue = await this._handleTableKey(key, rows, columns, state);
        if (!shouldContinue) break;
        this._renderTablePage(rows, columns, state, true);
      }
    } finally {
      if (this._canReadTerminalKeys()) this.term.grabInput(false);
    }
    this.term('\n');
  }

  /**
   * @param {Array<Array<string>>} rows
   * @param {Array<{ header: string, width?: number }>} columns
   * @param {{ page: number, pageSize: number, filter: string, detailIndex?: number }} state
   * @param {boolean} interactive
   */
  _renderTablePage(rows, columns, state, interactive) {
    const rendered = renderTablePage(rows, columns, {
      page: state.page,
      pageSize: state.pageSize,
      filter: state.filter,
      detailIndex: state.detailIndex,
      showFooter: true
    });
    if (rendered.lines.length === 0) return;
    state.page = rendered.page;

    this.term('\n');
    this._write('white', `${rendered.lines[0]}\n`, true);
    for (const line of rendered.lines.slice(1)) {
      this.term(`${line}\n`);
    }
    if (rendered.detailLines.length > 0) {
      this.term('\n');
      this._write('cyan', 'Details\n', true);
      for (const line of rendered.detailLines) this.term(`${line}\n`);
    }
    if (interactive) {
      const filter = state.filter ? ` filter="${state.filter}"` : '';
      this._write('gray', `\nControls: n/→ next, p/← previous, f filter, d choose row details, q quit.${filter}\n`);
    }
  }

  /**
   * @param {string} key
   * @param {Array<Array<string>>} rows
   * @param {Array<{ header: string, width?: number }>} columns
   * @param {{ page: number, pageSize: number, filter: string, detailIndex?: number }} state
   * @returns {Promise<boolean>}
   */
  async _handleTableKey(key, rows, columns, state) {
    const value = String(key || '');
    const lower = value.toLowerCase();
    if (lower === 'q' || value === '\u0003' || value === '\u0004') return false;

    const current = renderTablePage(rows, columns, {
      page: state.page,
      pageSize: state.pageSize,
      filter: state.filter,
      detailIndex: state.detailIndex,
      showFooter: true
    });

    if (lower === 'n' || value === '\u001b[C' || value === ' ') {
      state.page = Math.min(current.totalPages, current.page + 1);
      return true;
    }
    if (lower === 'p' || value === '\u001b[D') {
      state.page = Math.max(1, current.page - 1);
      return true;
    }
    if (lower === 'f' || value === '/') {
      this._write('cyan', '\nEnter text to filter the already-loaded rows, or press Enter to clear the filter.\n', true);
      const nextFilter = await this._readLine('Filter: ');
      state.filter = String(nextFilter || '').trim();
      state.page = 1;
      state.detailIndex = undefined;
      return true;
    }
    if (lower === 'd') {
      const rowCount = this._currentPageRowCount(rows, state);
      if (rowCount === 0) {
        state.detailIndex = undefined;
        return true;
      }
      const detailPrompt = `Enter current-page row number (1-${rowCount}) to show details, or press Enter to clear.`;
      this._write('cyan', `\n${detailPrompt}\n`, true);
      const answer = await this._readLine('Row number: ');
      const trimmed = String(answer || '').trim();
      if (!trimmed) {
        state.detailIndex = undefined;
      } else {
        const nextIndex = Number(trimmed);
        if (Number.isInteger(nextIndex) && nextIndex >= 1 && nextIndex <= rowCount) {
          state.detailIndex = nextIndex - 1;
        }
      }
      return true;
    }
    return true;
  }

  /**
   * @param {Array<Array<string>>} rows
   * @param {{ page: number, pageSize: number, filter: string }} state
   * @returns {number}
   */
  _currentPageRowCount(rows, state) {
    const filtered = filterTableRows(rows, state.filter || '');
    return paginateTableRows(filtered, state.page || 1, state.pageSize || 20).rows.length;
  }

  /** @returns {boolean} */
  _canInteract() {
    if (this._canReadTerminalKeys()) return true;
    const stdin = this.stdin;
    return !!(stdin &&
      stdin.isTTY &&
      typeof stdin.setRawMode === 'function' &&
      typeof stdin.once === 'function' &&
      typeof stdin.resume === 'function');
  }

  /** @returns {boolean} */
  _canReadTerminalKeys() {
    return !!(this.term &&
      typeof this.term.grabInput === 'function' &&
      typeof this.term.once === 'function' &&
      typeof this.term.removeListener === 'function');
  }

  /** @returns {Promise<string>} */
  _readKey() {
    if (this._canReadTerminalKeys()) return this._readTerminalKey();

    const stdin = this.stdin;
    if (!stdin || typeof stdin.once !== 'function') return Promise.resolve('q');

    const previousRaw = !!stdin.isRaw;
    const rawSupported = typeof stdin.setRawMode === 'function';
    const wasPaused = typeof stdin.isPaused === 'function' ? stdin.isPaused() : false;
    return new Promise((resolve) => {
      const cleanup = (value) => {
        stdin.removeListener('data', onData);
        if (rawSupported) stdin.setRawMode(previousRaw);
        if (wasPaused && typeof stdin.pause === 'function') stdin.pause();
        resolve(String(value || ''));
      };
      const onData = (chunk) => cleanup(chunk);
      if (typeof stdin.setEncoding === 'function') stdin.setEncoding('utf8');
      if (rawSupported) stdin.setRawMode(true);
      stdin.resume();
      stdin.once('data', onData);
    });
  }

  /** @returns {Promise<string>} */
  _readTerminalKey() {
    const term = this.term;
    return new Promise((resolve) => {
      const cleanup = (name) => {
        term.removeListener('key', onKey);
        resolve(normalizeTerminalKey(name));
      };
      const onKey = (name) => cleanup(name);
      term.grabInput(true);
      term.once('key', onKey);
    });
  }

  /**
   * @param {string} prompt
   * @returns {Promise<string>}
   */
  _readLine(prompt) {
    const stdin = this.stdin;
    if (!stdin || !stdin.readable) return Promise.resolve('');

    const previousRaw = !!stdin.isRaw;
    const rawSupported = typeof stdin.setRawMode === 'function';
    const terminalKeys = this._canReadTerminalKeys();
    if (terminalKeys) this.term.grabInput(false);
    if (rawSupported) stdin.setRawMode(false);
    this.term(prompt);
    const input = /** @type {NodeJS.ReadStream} */ (stdin);
    const output = /** @type {NodeJS.WriteStream} */ (this.stdout);

    return new Promise((resolve) => {
      const rl = readline.createInterface(input, output, undefined, true);
      rl.question('', (answer) => {
        rl.close();
        if (rawSupported) stdin.setRawMode(previousRaw);
        if (terminalKeys) this.term.grabInput(true);
        resolve(answer);
      });
    });
  }

  /**
   * @param {import('./components/status-list').StatusGroup[]} groups
   */
  statusList(groups) {
    if (!Array.isArray(groups)) return;
    let index = 1;
    for (const group of groups) {
      if (!group || !Array.isArray(group.items)) continue;
      this.term('\n');
      this._write('cyan', `${group.title || ''}\n`, true);
      for (const item of group.items) {
        const line = formatStatusLine(index, item);
        const color = item.status === 'ok'
          ? 'green'
          : item.status === 'fail'
            ? 'red'
            : item.status === 'warn'
              ? 'yellow'
              : 'gray';
        this._write(color, `${line}\n`);
        for (const helpLine of splitHelpLines(item.help)) {
          this._write('yellow', `   💡 ${helpLine}\n`);
        }
        if (item.command) {
          this._write('gray', `   $ ${item.command}\n`);
        }
        index += 1;
      }
    }
  }

  /**
   * @param {{ type?: string, taskId?: string, parentTaskId?: string, label?: string, startedAt?: number, endedAt?: number, durationMs?: number, success?: boolean, agent?: string, error?: string, dashboardTitle?: string }} event
   */
  emit(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type !== 'task:start' && event.type !== 'task:finish') return;
    if (event.parentTaskId) {
      this.dashboardState = reduceDashboardEvent(this.dashboardState, event);
      this._renderDashboardRow(event.parentTaskId, event.dashboardTitle);
      return;
    }
    this.timelineState = reduceTaskEvent(this.timelineState, event);
    this._renderTimelineTask(event.taskId);
  }

  /**
   * @param {string | undefined} taskId
   */
  _renderTimelineTask(taskId) {
    if (!taskId || !this.timelineState.tasks[taskId]) return;
    if (!this.timelineHeaderPrinted) {
      this._write('cyan', '\nTimeline\n', true);
      this.timelineHeaderPrinted = true;
    }
    const [line] = renderTimelineLines({
      tasks: this.timelineState.tasks,
      order: [taskId]
    });
    if (!line) return;
    if (line.startsWith('✓')) this._write('green', `${line}\n`);
    else if (line.startsWith('✗')) this._write('red', `${line}\n`);
    else if (line.startsWith('▶')) this._write('yellow', `${line}\n`);
    else this._write('gray', `${line}\n`);
  }

  /**
   * @param {string | undefined} parentTaskId
   * @param {string | undefined} dashboardTitle
   */
  _renderDashboardRow(parentTaskId, dashboardTitle) {
    if (!parentTaskId || !this.dashboardState.rows[parentTaskId]) return;
    if (!this.dashboardHeaderPrinted) {
      this.dashboardTitle = dashboardTitle || this.dashboardTitle;
      this._write('cyan', `\n${this.dashboardTitle}\n`, true);
      this._write('gray', '#issue  status  duration  agent  lastStep\n');
      this.dashboardHeaderPrinted = true;
    }
    const [line] = renderDashboardLines({
      rows: this.dashboardState.rows,
      order: [parentTaskId]
    });
    if (!line) return;
    if (line.startsWith('✓')) this._write('green', `${line}\n`);
    else if (line.startsWith('✗')) this._write('red', `${line}\n`);
    else if (line.startsWith('▶')) this._write('yellow', `${line}\n`);
    else this._write('gray', `${line}\n`);
  }

  /**
   * @param {string} color
   * @param {string} text
   * @param {boolean} [bold]
   */
  _write(color, text, bold) {
    const root = bold && this.term.bold ? this.term.bold : this.term;
    const writer = root && root[color];
    if (typeof writer === 'function') writer(text);
    else this.term(text);
  }
}

/**
 * @param {unknown} key
 * @returns {string}
 */
function normalizeTerminalKey(key) {
  const name = String(key || '');
  switch (name) {
    case 'CTRL_C':
      return '\u0003';
    case 'CTRL_D':
      return '\u0004';
    case 'RIGHT':
      return '\u001b[C';
    case 'LEFT':
      return '\u001b[D';
    case 'ENTER':
      return '\n';
    case 'SPACE':
      return ' ';
    default:
      return name.length === 1 ? name : name.toLowerCase();
  }
}

module.exports = {
  TuiRenderer
};
