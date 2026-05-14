// @ts-check
/**
 * UI factory.
 *
 * Two entry points:
 *  - `createUi(opts)` — builds a renderer per invocation (decides plain vs
 *    TUI from CLI flags / env / config / TTY).
 *  - `defaultUi()` — process-wide singleton PlainRenderer used by
 *    `lib/logger.js` (the forwarding shim) and any caller that just wants
 *    "the default plain renderer" without dealing with capability detection.
 *
 * PR-2 scope (docs/TUI_UX_REDESIGN_PROPOSAL.md §5.4):
 *   - PlainRenderer is now a complete facade (header / table / statusList /
 *     emit / error+warn opts).
 *   - `lib/logger.js` is a thin forwarding shim that delegates to
 *     `defaultUi()` so the byte-equal contract holds and the existing
 *     ~10 mock-logger-based test files keep working unchanged (B2).
 *   - TuiRenderer is still NOT implemented (PR-3 introduces it). `mode='tui'`
 *     paths still throw inside `createUi` and either fall back or exit 22.
 *
 * Lazy loading note (B3): when PR-3 introduces TuiRenderer, the
 * `require('terminal-kit')` MUST live inside the TuiRenderer constructor, not
 * at file top level, so installs without terminal-kit keep working.
 */

const { detectUiMode } = require('./capability');
const { PlainRenderer } = require('./plain-renderer');

// Exit code for "TUI explicitly required but unavailable". Reserved by
// docs/TUI_UX_REDESIGN_PROPOSAL.md §4.3; verified unused elsewhere in lib/.
const TUI_REQUIRED_EXIT_CODE = 22;

/**
 * @typedef {Object} CreateUiOptions
 * @property {boolean} [flagPlain]
 * @property {boolean} [flagTui]
 * @property {boolean} [debug]
 * @property {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 * @property {{ uiMode?: string } | null} [config]
 * @property {{ isTTY?: boolean } | NodeJS.WriteStream | null} [stdout]
 * @property {{ isTTY?: boolean } | NodeJS.ReadStream | null}  [stdin]
 */

/**
 * Build a renderer for this invocation.
 *
 * @param {CreateUiOptions} [opts]
 * @returns {InstanceType<typeof PlainRenderer>}
 */
function createUi(opts) {
  const o = opts || {};
  const stdout = o.stdout != null ? o.stdout : process.stdout;
  const stdin = o.stdin != null ? o.stdin : process.stdin;
  const env = o.env != null ? o.env : process.env;
  const config = o.config != null ? o.config : null;

  const { mode, reason } = detectUiMode({
    flagPlain: !!o.flagPlain,
    flagTui: !!o.flagTui,
    env,
    config,
    stdout,
    stdin
  });

  if (o.debug || process.env.AI_ISSUE_DEBUG === 'true') {
    process.stderr.write(`[ui] mode=${mode} reason=${reason}\n`);
  }

  if (mode === 'tui') {
    try {
      // PR-2: TuiRenderer not yet implemented. Throws so we hit the fallback
      // path below. PR-3 will replace this with `new TuiRenderer({...})`.
      throw new Error('TUI renderer not yet implemented (PR-2); use PR-3+');
    } catch (err) {
      const explicit =
        reason === 'flag-tui' || reason === 'env-tui' || reason === 'config-tui';
      if (explicit) {
        // FR-3: explicit channel must NOT be silently auto-fallback'd.
        process.stderr.write(
          `Error: TUI explicitly requested (reason=${reason}) but unavailable: ${err.message}\n`
        );
        process.exit(TUI_REQUIRED_EXIT_CODE);
      }
      // FR-14: implicit auto path silently degrades.
      return new PlainRenderer();
    }
  }

  return new PlainRenderer();
}

/**
 * Process-wide singleton PlainRenderer. Created lazily on first call so that
 * (a) tests can replace it via `_resetDefaultUi()`, and (b) test runs that
 * never touch the renderer don't pay any construction cost.
 */
let _defaultUi = /** @type {InstanceType<typeof PlainRenderer>|null} */ (null);

/**
 * Get (or lazily construct) the process-wide default PlainRenderer. Used
 * primarily by `lib/logger.js`'s forwarding shim. Never throws and never
 * exits — `createUi` owns the explicit-TUI failure semantics; `defaultUi`
 * is a "just give me a sink" convenience.
 *
 * @returns {InstanceType<typeof PlainRenderer>}
 */
function defaultUi() {
  if (!_defaultUi) {
    _defaultUi = new PlainRenderer();
  }
  return _defaultUi;
}

/**
 * Reset the singleton. Test-only.
 */
function _resetDefaultUi() {
  _defaultUi = null;
}

module.exports = {
  createUi,
  defaultUi,
  TUI_REQUIRED_EXIT_CODE,
  _resetDefaultUi
};

