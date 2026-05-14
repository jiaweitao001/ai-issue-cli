// @ts-check
/**
 * Logger — forwarding shim into the UI facade (PR-2 / B2).
 *
 * Historical context: this module used to own all CLI output. After
 * docs/TUI_UX_REDESIGN_PROPOSAL.md §5.4 the canonical implementation lives in
 * lib/ui/plain-renderer.js, and this file becomes a thin shim that delegates
 * to the process-wide singleton returned by `lib/ui/index.js#defaultUi()`.
 *
 * The external API (function names + signatures + emitted bytes) is identical
 * to the legacy logger so:
 *   - Every existing consumer (`require('../logger')`) keeps working.
 *   - Every existing test that mocks `lib/logger` keeps working — Jest replaces
 *     this entire module with the mock, so the indirection through `defaultUi`
 *     is bypassed for mocked code paths.
 *   - Real (non-mocked) calls now flow through PlainRenderer, which lets PR-3+
 *     swap in TuiRenderer without touching any caller.
 *
 * NEVER `require('./ui/plain-renderer')` directly here — go through `./ui` so
 * the singleton is shared. NEVER add new top-level mutable state.
 */

const chalk = require('chalk');
const { defaultUi } = require('./ui');

/** @param {...any} args */
function log(...args) {
  defaultUi().log(...args);
}

/** @param {string} message */
function error(message) {
  defaultUi().error(message);
}

/** @param {string} message */
function success(message) {
  defaultUi().success(message);
}

/** @param {string} message */
function info(message) {
  defaultUi().info(message);
}

/** @param {string} message */
function warning(message) {
  defaultUi().warn(message);
}

/** @param {string} message */
function debug(message) {
  defaultUi().debug(message);
}

/**
 * Pure string transform — wrap text in the highlight style for inline
 * interpolation. Returns a string (NOT a side-effecting call).
 * @param {string} message
 * @returns {string}
 */
function highlight(message) {
  return defaultUi().highlight(message);
}

module.exports = {
  log,
  error,
  success,
  info,
  warning,
  debug,
  highlight,
  chalk
};

