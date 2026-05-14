// @ts-check

const { formatStatusLine, splitHelpLines } = require('./components/status-list');

/**
 * terminal-kit-backed renderer. PR-3 intentionally keeps this inline (no
 * alt-screen) and non-interactive; richer dashboards arrive in later PRs.
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
  table(rows, columns) {
    if (!Array.isArray(columns) || columns.length === 0) return;
    const widths = columns.map((c, idx) => {
      let max = c.width || (c.header || '').length;
      for (const row of rows || []) {
        const cell = row && row[idx] != null ? String(row[idx]) : '';
        if (cell.length > max) max = cell.length;
      }
      return max;
    });
    this._write('white', `${columns.map((c, i) => (c.header || '').padEnd(widths[i])).join(' ')}\n`, true);
    this.term(`${widths.map((w) => '─'.repeat(w)).join(' ')}\n`);
    for (const row of rows || []) {
      this.term(`${columns.map((_c, i) => (row && row[i] != null ? String(row[i]) : '').padEnd(widths[i])).join(' ')}\n`);
    }
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
   * @param {{ type?: string, taskId?: string, label?: string, durationMs?: number, success?: boolean }} event
   */
  emit(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'task:start') {
      this._write('blue', `📚 ${event.label || event.taskId}\n`, true);
    } else if (event.type === 'task:finish') {
      const dur = typeof event.durationMs === 'number'
        ? ` (${(event.durationMs / 1000).toFixed(1)}s)`
        : '';
      const label = event.label || event.taskId;
      if (event.success === false) this._write('red', `❌ ${label}${dur}\n`);
      else this._write('green', `✅ ${label}${dur}\n`);
    }
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

module.exports = {
  TuiRenderer
};
