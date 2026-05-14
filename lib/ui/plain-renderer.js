// @ts-check
/**
 * Plain renderer — full facade implementation per
 * docs/TUI_UX_REDESIGN_PROPOSAL.md §3.1 + §5.4 (PR-2).
 *
 * Hard contracts:
 *  - Byte-equal: every line emitted by `success`/`error`/`info`/`warn`/`debug`
 *    /`log`/`highlight` MUST equal what the legacy `lib/logger.js` (pre-PR-2)
 *    produced for the same input. The shape of those expressions is replicated
 *    verbatim from the previous `lib/logger.js`. Existing assertions in
 *    tests/logger.test.js + the ~10 command-test files (which mock logger and
 *    assert specific substrings) are the regression net.
 *  - Module isolation: this file MUST NOT `require('../logger')`. After
 *    `lib/logger.js` becomes a forwarding shim that imports `lib/ui`, any
 *    require back into logger here would close a cycle.
 *
 * New methods (`header` / `table` / `statusList` / `emit` / `error`+`warn`'s
 * `{fix, command, exit}` opts) are exposed for PR-3+ callers; no production
 * code in PR-2 calls them yet, so the byte-equal contract holds for current
 * users.
 */

const chalk = require('chalk');

const SEPARATOR = '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';

/**
 * @typedef {Object} ErrorOptions
 * @property {string} [fix]      Indented '💡 ' hint printed under the error.
 * @property {string} [command]  Indented '$ ' shell hint printed under the error.
 * @property {number} [exit]     If set, calls process.exit(exit) after printing.
 */

/**
 * @typedef {Object} WarnOptions
 * @property {string} [fix]
 * @property {string} [command]
 */

/**
 * @typedef {Object} StatusItem
 * @property {'ok'|'fail'|'warn'|'skip'} status
 * @property {string} name
 * @property {string} [detail]
 * @property {string} [help]
 */

/**
 * @typedef {Object} StatusGroup
 * @property {string} title
 * @property {StatusItem[]} items
 */

/**
 * @typedef {{ type: 'task:start'|'task:finish', taskId: string, label?: string, durationMs?: number, success?: boolean }} TaskEvent
 */

class PlainRenderer {
  /**
   * @param {{ stdout?: NodeJS.WriteStream } & Record<string, any>} [_opts]
   */
  constructor(_opts) {
    this.mode = 'plain';
  }

  // ── byte-equal core (must match legacy lib/logger.js) ──────────────────

  /** @param {string} message */
  success(message) {
    console.log(chalk.green(`✅ ${message}`));
  }

  /**
   * @param {string} message
   * @param {ErrorOptions} [opts]
   */
  error(message, opts) {
    console.error(chalk.red(`❌ ${message}`));
    if (opts) {
      if (opts.fix) console.log(chalk.yellow(`   💡 ${opts.fix}`));
      if (opts.command) console.log(chalk.gray(`   $ ${opts.command}`));
      if (typeof opts.exit === 'number') process.exit(opts.exit);
    }
  }

  /** @param {string} message */
  info(message) {
    console.log(chalk.blue(`ℹ️  ${message}`));
  }

  /**
   * @param {string} message
   * @param {WarnOptions} [opts]
   */
  warn(message, opts) {
    console.log(chalk.yellow(`⚠️  ${message}`));
    if (opts) {
      if (opts.fix) console.log(chalk.yellow(`   💡 ${opts.fix}`));
      if (opts.command) console.log(chalk.gray(`   $ ${opts.command}`));
    }
  }

  /** @param {string} message */
  debug(message) {
    if (process.env.AI_ISSUE_DEBUG === 'true') {
      console.log(chalk.grey(`[DEBUG] ${message}`));
    }
  }

  /** @param {...any} args */
  log(...args) {
    console.log(...args);
  }

  /**
   * Pure string transform — wraps the input in the highlight style. Returned
   * for inline interpolation (e.g. info(`File at ${highlight(path)}`)).
   * @param {string} text
   * @returns {string}
   */
  highlight(text) {
    return chalk.bold.cyan(text);
  }

  // ── new facade methods (PR-2 surface; PR-3+ consumers) ────────────────

  /**
   * Section header: blank / bold-cyan title / cyan separator / blank.
   * Replicates the existing pattern in check.js:99-102 and model.js:77-80
   * verbatim so future migrations are byte-equal.
   * @param {string} text
   */
  header(text) {
    console.log('');
    console.log(chalk.bold.cyan(text));
    console.log(chalk.cyan(SEPARATOR));
    console.log('');
  }

  /**
   * Render an ASCII table.
   *
   * @param {Array<Array<string>>} rows  Data rows (no header row).
   * @param {Array<{ key?: string, header: string, width?: number }>} columns
   *   Column descriptors. `width` sets the minimum padding; absent → derived
   *   from longest cell. The header row is bold; an underline of unicode
   *   box-drawing dashes is printed below the header.
   */
  table(rows, columns) {
    if (!Array.isArray(columns) || columns.length === 0) return;
    const widths = columns.map((c, idx) => {
      const headerLen = (c.header || '').length;
      let max = c.width || headerLen;
      for (const r of rows || []) {
        const cell = r && r[idx] != null ? String(r[idx]) : '';
        if (cell.length > max) max = cell.length;
      }
      return max;
    });
    const headerLine = columns
      .map((c, i) => (c.header || '').padEnd(widths[i]))
      .join(' ');
    const ruleLine = widths.map((w) => '─'.repeat(w)).join(' ');
    console.log(chalk.bold(headerLine));
    console.log(ruleLine);
    for (const r of rows || []) {
      const line = columns
        .map((_c, i) => (r && r[i] != null ? String(r[i]) : '').padEnd(widths[i]))
        .join(' ');
      console.log(line);
    }
  }

  /**
   * Render grouped status checks. Designed for PR-3 `ai-issue check` rewrite.
   * Each group prints a bold-cyan title, a blank line spacer, then numbered
   * items. Numbering is global (matches today's check.js sequencing).
   *
   * @param {StatusGroup[]} groups
   */
  statusList(groups) {
    if (!Array.isArray(groups)) return;
    let index = 1;
    for (const group of groups) {
      if (!group || !Array.isArray(group.items)) continue;
      console.log('');
      console.log(chalk.bold.cyan(group.title || ''));
      for (const item of group.items) {
        const icon = _statusIcon(item && item.status);
        const detail = item && item.detail ? `    ${chalk.gray(`[${item.detail}]`)}` : '';
        const line = `${index}. ${icon} ${(item && item.name) || ''}${detail}`;
        if (item && item.status === 'ok') {
          console.log(chalk.green(line));
        } else if (item && item.status === 'fail') {
          console.error(chalk.red(line));
        } else if (item && item.status === 'warn') {
          console.log(chalk.yellow(line));
        } else {
          console.log(chalk.gray(line));
        }
        if (item && item.help) {
          console.log(chalk.yellow(`   💡 ${item.help}`));
        }
        index += 1;
      }
    }
  }

  /**
   * Renderer-side hook for orchestration events. PR-2 ships a minimal handler
   * for `task:start` / `task:finish` that mirrors the chalk lines `solve.js`
   * currently prints inline; PR-5 will route those orchestration entry points
   * through `emit()` (B1 byte-equal contract for plain mode).
   *
   * @param {TaskEvent} event
   */
  emit(event) {
    if (!event || typeof event !== 'object') return;
    if (event.type === 'task:start') {
      const label = event.label || event.taskId;
      console.log(chalk.bold.blue(`📚 ${label}`));
    } else if (event.type === 'task:finish') {
      const label = event.label || event.taskId;
      const dur = typeof event.durationMs === 'number'
        ? ` (${(event.durationMs / 1000).toFixed(1)}s)`
        : '';
      if (event.success === false) {
        console.error(chalk.red(`❌ ${label}${dur}`));
      } else {
        console.log(chalk.green(`✅ ${label}${dur}`));
      }
    }
  }
}

/**
 * @param {string|undefined} status
 * @returns {string}
 */
function _statusIcon(status) {
  switch (status) {
    case 'ok':   return '✅';
    case 'fail': return '❌';
    case 'warn': return '⚠️ ';
    case 'skip': return '⏭ ';
    default:     return '•';
  }
}

module.exports = {
  PlainRenderer,
  // Internal helpers exposed for tests:
  _statusIcon,
  _SEPARATOR: SEPARATOR
};
