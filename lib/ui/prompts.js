// @ts-check
/**
 * Short-interaction prompt layer (TUI proposal §5.3 PR-1).
 *
 * Exposes `select` / `input` / `confirm` / `multiselect`. When stdout & stdin
 * are TTYs (and not CI), we use `enquirer` for a richer keyboard UX. Any
 * other condition — non-TTY, CI=true, enquirer load failure, or a
 * non-cancel runtime error inside enquirer — silently falls back to the
 * existing `lib/prompts.js` state-machine implementation, so behavior in
 * tests / pipes / CI stays byte-equivalent to today.
 *
 * Cancel contract (v1.1 I13): enquirer throws on Ctrl+C with err being
 * falsy / empty / `/cancel|abort/i` — we coerce these to `null` to match
 * the existing `lib/prompts.promptSelect` contract callers already handle.
 *
 * No global flag (`--plain`) gating here: per spec §5.3, the upgrade is
 * "behavior equivalent" so it does not need to honor a TUI-specific kill
 * switch. The only TUI gates are TTY presence and CI=true.
 */

const fallback = require('../prompts');

/**
 * @typedef {Object} ChoiceItem
 * @property {string} name              - Stable identifier; what `select` returns.
 * @property {string} [label]           - Display text. Defaults to `name`.
 * @property {string} [hint]            - Optional secondary hint shown by enquirer.
 * @property {boolean} [disabled]       - Reserved for future PRs.
 */

/**
 * @typedef {Object} SelectOptions
 * @property {number} [initialIndex]
 * @property {string} [message]         - Prompt header. Aliased to `header` for fallback compat.
 * @property {string} [header]
 */

/**
 * @typedef {Object} InputOptions
 * @property {string} message
 * @property {string} [initial]
 */

/**
 * @typedef {Object} ConfirmOptions
 * @property {string} message
 * @property {boolean} [default]        - Default answer (true=Y/n, false=y/N). Defaults to true.
 */

let _enquirerCache; // undefined = not yet probed; null = unavailable; obj = loaded module

function _loadEnquirer() {
  if (_enquirerCache !== undefined) return _enquirerCache;
  try {
    _enquirerCache = require('enquirer');
  } catch (_e) {
    _enquirerCache = null;
  }
  return _enquirerCache;
}

/**
 * Test-only escape hatch to reset the enquirer probe cache between tests.
 * Not part of the public API.
 */
function _resetForTesting() {
  _enquirerCache = undefined;
}

/**
 * Decide whether we can use enquirer for this invocation.
 *
 * @param {{ stdin?: { isTTY?: boolean }, stdout?: { isTTY?: boolean }, env?: NodeJS.ProcessEnv | Record<string,string|undefined> }} [overrides]
 * @returns {boolean}
 */
function _shouldUseEnquirer(overrides) {
  const o = overrides || {};
  const stdin = o.stdin || process.stdin;
  const stdout = o.stdout || process.stdout;
  const env = o.env || process.env;
  if (!stdin || !stdin.isTTY) return false;
  if (!stdout || !stdout.isTTY) return false;
  if (env && String(env.CI || '') === 'true') return false;
  return _loadEnquirer() != null;
}

/**
 * Recognise enquirer's cancel-shaped throws (Ctrl+C, ESC) so we can return
 * null instead of bubbling. Real errors fall through to fallback.
 *
 * @param {unknown} err
 * @returns {boolean}
 */
function _isCancelError(err) {
  if (err == null) return true;
  if (err === '') return true;
  if (typeof err === 'string') return /cancel|abort/i.test(err);
  // For Error objects (or any object exposing `.message`), treat empty
  // message as a cancel — enquirer emits `new Error('')` for ESC.
  if (typeof err === 'object' && err !== null && 'message' in /** @type {any} */ (err)) {
    const msg = String(/** @type {any} */ (err).message || '');
    return msg === '' || /cancel|abort/i.test(msg);
  }
  return /cancel|abort/i.test(String(err));
}

/**
 * Single-choice picker. Returns the chosen item's `name`, or `null` on
 * cancel / non-interactive.
 *
 * @param {ChoiceItem[]} items
 * @param {SelectOptions} [opts]
 * @returns {Promise<string|null>}
 */
async function select(items, opts) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const o = opts || {};
  const header = o.message || o.header;
  const initialIndex = typeof o.initialIndex === 'number' ? o.initialIndex : 0;

  if (_shouldUseEnquirer()) {
    const enq = _loadEnquirer();
    try {
      const prompt = new enq.Select({
        name: 'value',
        message: header || 'Select:',
        initial: initialIndex,
        choices: items.map((it) => ({
          name: it.name,
          message: it.label || it.name,
          hint: it.hint,
          disabled: it.disabled
        }))
      });
      const value = await prompt.run();
      return typeof value === 'string' ? value : null;
    } catch (err) {
      if (_isCancelError(err)) return null;
      // Unexpected error → fall through to fallback for resilience.
    }
  }

  const idx = await fallback.promptSelect(
    items.map((it) => it.label || it.name),
    { initialIndex, header }
  );
  if (idx == null || idx < 0 || idx >= items.length) return null;
  return items[idx].name;
}

/**
 * Free-form text input. Returns the entered string (possibly empty), or
 * `null` on cancel / non-interactive.
 *
 * @param {InputOptions | string} opts
 * @returns {Promise<string|null>}
 */
async function input(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || { message: '' });
  const message = o.message || '';

  if (_shouldUseEnquirer()) {
    const enq = _loadEnquirer();
    try {
      const prompt = new enq.Input({
        name: 'value',
        message,
        initial: o.initial || ''
      });
      const value = await prompt.run();
      return value == null ? '' : String(value);
    } catch (err) {
      if (_isCancelError(err)) return null;
    }
  }

  // Fallback expects a question string with trailing space.
  const question = /\s$/.test(message) ? message : `${message} `;
  const answer = await fallback.promptInput(question);
  return answer == null ? null : String(answer);
}

/**
 * Yes/No confirmation. Returns boolean, or `null` on cancel / non-interactive.
 *
 * @param {ConfirmOptions | string} opts
 * @returns {Promise<boolean|null>}
 */
async function confirm(opts) {
  const o = typeof opts === 'string' ? { message: opts } : (opts || { message: '' });
  const message = o.message || '';
  const defaultYes = o.default !== false; // default true

  if (_shouldUseEnquirer()) {
    const enq = _loadEnquirer();
    try {
      const prompt = new enq.Confirm({
        name: 'value',
        message,
        initial: defaultYes
      });
      const value = await prompt.run();
      return !!value;
    } catch (err) {
      if (_isCancelError(err)) return null;
    }
  }

  const suffix = defaultYes ? '(Y/n)' : '(y/N)';
  const answer = await fallback.promptInput(`${message} ${suffix} `);
  if (answer == null) return null;
  const trimmed = String(answer).trim();
  if (trimmed === '') return defaultYes;
  if (defaultYes) return !/^n(o)?$/i.test(trimmed);
  return /^y(es)?$/i.test(trimmed);
}

/**
 * Multi-select picker. PR-1 only wires it for the enquirer path; non-TTY /
 * CI returns `null` so callers can branch (no callers in PR-1; reserved
 * for PR-3+).
 *
 * @param {ChoiceItem[]} items
 * @param {SelectOptions} [opts]
 * @returns {Promise<string[]|null>}
 */
async function multiselect(items, opts) {
  if (!Array.isArray(items) || items.length === 0) return null;
  const o = opts || {};

  if (_shouldUseEnquirer()) {
    const enq = _loadEnquirer();
    try {
      const prompt = new enq.MultiSelect({
        name: 'value',
        message: o.message || o.header || 'Select multiple:',
        choices: items.map((it) => ({
          name: it.name,
          message: it.label || it.name,
          hint: it.hint
        }))
      });
      const values = await prompt.run();
      return Array.isArray(values) ? values : null;
    } catch (err) {
      if (_isCancelError(err)) return null;
    }
  }

  // No fallback in PR-1. Future PRs can wire a numbered batch picker.
  return null;
}

module.exports = {
  select,
  input,
  confirm,
  multiselect,
  // Internals for tests
  _isCancelError,
  _shouldUseEnquirer,
  _loadEnquirer,
  _resetForTesting
};
