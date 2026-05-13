// @ts-check
/**
 * UI factory — `createUi(opts)` decides per invocation whether to return a
 * TUI renderer or a plain renderer.
 *
 * PR-0 scope (docs/TUI_UX_REDESIGN_PROPOSAL.md §5.2 + v1.1 B3):
 *   - capability + PlainRenderer are wired up.
 *   - TuiRenderer is intentionally NOT yet implemented; lib/ui/tui-renderer.js
 *     does not exist. Any request for mode='tui' here throws so the fallback
 *     path runs and returns PlainRenderer.
 *   - This means `--plain` / `--tui` CLI flags (registered in ai-issue.js)
 *     have no observable effect yet — by design, PR-0 ships zero user-visible
 *     output changes (FR-9 byte-equal contract).
 *
 * Lazy loading note (B3): when PR-3 introduces TuiRenderer, the
 * `require('terminal-kit')` MUST live inside the TuiRenderer constructor, not
 * at file top level, so installs without terminal-kit (e.g. PR-0 itself, or
 * `npm install --no-optional`) keep working.
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
 * @returns {PlainRenderer}
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
      // PR-0: TuiRenderer not yet implemented. Throws so we hit the fallback
      // path below. PR-3 will replace this with `new TuiRenderer({...})`.
      throw new Error('TUI renderer not yet implemented (PR-0); use PR-3+');
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

module.exports = {
  createUi,
  TUI_REQUIRED_EXIT_CODE
};
