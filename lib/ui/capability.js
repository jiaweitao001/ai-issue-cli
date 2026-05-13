// @ts-check
/**
 * UI capability detection — pure function with no side effects.
 *
 * Decides which renderer (`'plain'` or `'tui'`) the CLI should use for a given
 * invocation. Caller is responsible for wiring up arguments; this module never
 * touches `process.argv`, `process.env`, or `process.stdout` directly so it
 * stays trivially testable.
 *
 * Precedence (see docs/TUI_UX_REDESIGN_PROPOSAL.md §3.2 / §4.2 v1.1):
 *
 *   1. CLI flag (`--plain` / `--tui`)
 *      - If both passed: plain wins (conservative; caller should print a warn).
 *   2. config.uiMode when explicitly set to 'plain' or 'tui' (i.e. not 'auto')
 *   3. AI_ISSUE_UI_MODE env (only if config.uiMode is 'auto')
 *   4. Auto-detect:
 *        - !stdout.isTTY  → plain  (reason: 'auto-no-tty')
 *        - CI === 'true'  → plain  (reason: 'auto-no-tty')
 *        - !stdin.isTTY   → plain  (reason: 'auto-no-raw-stdin'; TUI needs raw stdin)
 *        - else            → tui    (reason: 'auto-ok')
 *
 * NO_COLOR is intentionally NOT inspected here. Per https://no-color.org it
 * means "do not output color"; it does not mean "do not render layout". A
 * non-color TUI is still a valid TUI. chalk handles NO_COLOR on its own.
 */

/**
 * @typedef {Object} CapabilityInputs
 * @property {boolean} [flagPlain]
 * @property {boolean} [flagTui]
 * @property {NodeJS.ProcessEnv | Record<string,string|undefined>} [env]
 * @property {{ uiMode?: string } | null} [config]
 * @property {{ isTTY?: boolean } | NodeJS.WriteStream | null} [stdout]
 * @property {{ isTTY?: boolean } | NodeJS.ReadStream | null}  [stdin]
 */

/**
 * @typedef {(
 *   'flag-plain' | 'flag-tui' | 'flag-both-plain-wins' |
 *   'config-plain' | 'config-tui' |
 *   'env-plain' | 'env-tui' |
 *   'auto-no-tty' | 'auto-no-raw-stdin' | 'auto-ok'
 * )} CapabilityReason
 */

/**
 * @typedef {Object} CapabilityResult
 * @property {'plain'|'tui'} mode
 * @property {CapabilityReason} reason
 */

/**
 * Detect the UI mode for this invocation.
 *
 * @param {CapabilityInputs} inputs
 * @returns {CapabilityResult}
 */
function detectUiMode(inputs) {
  const flagPlain = !!(inputs && inputs.flagPlain);
  const flagTui = !!(inputs && inputs.flagTui);
  const env = (inputs && inputs.env) || {};
  const config = (inputs && inputs.config) || null;
  const stdout = (inputs && inputs.stdout) || null;
  const stdin = (inputs && inputs.stdin) || null;

  // 1. CLI flag (highest precedence)
  if (flagPlain && flagTui) {
    return { mode: 'plain', reason: 'flag-both-plain-wins' };
  }
  if (flagPlain) return { mode: 'plain', reason: 'flag-plain' };
  if (flagTui) return { mode: 'tui', reason: 'flag-tui' };

  // 2. config.uiMode when explicitly non-auto
  const c = config && typeof config.uiMode === 'string' ? String(config.uiMode).toLowerCase() : 'auto';
  if (c === 'plain') return { mode: 'plain', reason: 'config-plain' };
  if (c === 'tui') return { mode: 'tui', reason: 'config-tui' };

  // 3. env (only if config is 'auto')
  const e = env && typeof env.AI_ISSUE_UI_MODE === 'string' ? String(env.AI_ISSUE_UI_MODE).toLowerCase() : '';
  if (e === 'plain') return { mode: 'plain', reason: 'env-plain' };
  if (e === 'tui') return { mode: 'tui', reason: 'env-tui' };

  // 4. auto-detect
  const ttyOut = !!(stdout && stdout.isTTY);
  const ttyIn = !!(stdin && stdin.isTTY);
  const isCI = String(env && env.CI ? env.CI : '') === 'true';
  if (!ttyOut || isCI) return { mode: 'plain', reason: 'auto-no-tty' };
  if (!ttyIn) return { mode: 'plain', reason: 'auto-no-raw-stdin' };
  return { mode: 'tui', reason: 'auto-ok' };
}

module.exports = {
  detectUiMode
};
