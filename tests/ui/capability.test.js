/**
 * Tests for lib/ui/capability.js — pure-function decision matrix.
 */
const { detectUiMode } = require('../../lib/ui/capability');

// Helpers to build fake stdio handles.
function tty() { return { isTTY: true }; }
function pipe() { return { isTTY: false }; }

describe('lib/ui/capability — detectUiMode', () => {
  describe('CLI flag precedence (highest)', () => {
    it('flag --plain wins over everything else', () => {
      const r = detectUiMode({
        flagPlain: true,
        env: { CI: 'false', AI_ISSUE_UI_MODE: 'tui' },
        config: { uiMode: 'tui' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'flag-plain' });
    });

    it('flag --tui wins over config and env', () => {
      const r = detectUiMode({
        flagTui: true,
        env: { AI_ISSUE_UI_MODE: 'plain' },
        config: { uiMode: 'plain' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'tui', reason: 'flag-tui' });
    });

    it('both flags → plain wins (conservative; reason flag-both-plain-wins)', () => {
      const r = detectUiMode({
        flagPlain: true,
        flagTui: true,
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'flag-both-plain-wins' });
    });
  });

  describe('config.uiMode (when no CLI flag)', () => {
    it("config 'plain' wins over env 'tui'", () => {
      const r = detectUiMode({
        env: { AI_ISSUE_UI_MODE: 'tui' },
        config: { uiMode: 'plain' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'config-plain' });
    });

    it("config 'tui' wins over env 'plain'", () => {
      const r = detectUiMode({
        env: { AI_ISSUE_UI_MODE: 'plain' },
        config: { uiMode: 'tui' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'tui', reason: 'config-tui' });
    });

    it("config 'auto' falls through to env / auto-detect", () => {
      const r = detectUiMode({
        env: { AI_ISSUE_UI_MODE: 'tui' },
        config: { uiMode: 'auto' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'tui', reason: 'env-tui' });
    });

    it("invalid config.uiMode (e.g. 'TUI' uppercase) is normalized via toLowerCase", () => {
      const r = detectUiMode({
        config: { uiMode: 'TUI' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'tui', reason: 'config-tui' });
    });

    it('invalid config.uiMode (e.g. "garbage") falls through to auto-detect', () => {
      const r = detectUiMode({
        config: { uiMode: 'garbage' },
        stdout: tty(),
        stdin: tty()
      });
      // 'garbage' doesn't match plain/tui in step 2, no env, auto → tui.
      expect(r).toEqual({ mode: 'tui', reason: 'auto-ok' });
    });
  });

  describe('env (only when config is auto/missing)', () => {
    it("env 'plain' wins when config is auto", () => {
      const r = detectUiMode({
        env: { AI_ISSUE_UI_MODE: 'plain' },
        config: { uiMode: 'auto' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'env-plain' });
    });

    it("env 'tui' wins when config is missing", () => {
      const r = detectUiMode({
        env: { AI_ISSUE_UI_MODE: 'tui' },
        config: null,
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'tui', reason: 'env-tui' });
    });

    it('env case-insensitive', () => {
      const r = detectUiMode({
        env: { AI_ISSUE_UI_MODE: 'PLAIN' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'env-plain' });
    });
  });

  describe('auto-detect (no flag, no config, no env)', () => {
    it('non-TTY stdout → plain (auto-no-tty)', () => {
      const r = detectUiMode({
        stdout: pipe(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'auto-no-tty' });
    });

    it("CI=true → plain (auto-no-tty) even when stdout is TTY", () => {
      const r = detectUiMode({
        env: { CI: 'true' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'auto-no-tty' });
    });

    it('non-TTY stdin → plain (auto-no-raw-stdin)', () => {
      const r = detectUiMode({
        stdout: tty(),
        stdin: pipe()
      });
      expect(r).toEqual({ mode: 'plain', reason: 'auto-no-raw-stdin' });
    });

    it('all TTY + not CI → tui (auto-ok)', () => {
      const r = detectUiMode({
        env: { CI: 'false' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'tui', reason: 'auto-ok' });
    });

    it('NO_COLOR is intentionally NOT honored as a plain trigger', () => {
      // v1.1 I1: NO_COLOR means "no color", not "no TUI".
      const r = detectUiMode({
        env: { NO_COLOR: '1' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r).toEqual({ mode: 'tui', reason: 'auto-ok' });
    });

    it("CI literal string 'false' is treated as not-CI", () => {
      const r = detectUiMode({
        env: { CI: 'false' },
        stdout: tty(),
        stdin: tty()
      });
      expect(r.mode).toBe('tui');
    });

    it('missing all inputs → safe default plain', () => {
      const r = detectUiMode({});
      // No stdout → !ttyOut → plain (auto-no-tty).
      expect(r).toEqual({ mode: 'plain', reason: 'auto-no-tty' });
    });
  });

  describe('purity', () => {
    it('does not mutate inputs', () => {
      const env = Object.freeze({ AI_ISSUE_UI_MODE: 'tui' });
      const config = Object.freeze({ uiMode: 'plain' });
      // Frozen objects would throw on mutation.
      expect(() => detectUiMode({ env, config, stdout: tty(), stdin: tty() })).not.toThrow();
    });

    it('returns a plain object literal each call', () => {
      const a = detectUiMode({ flagPlain: true });
      const b = detectUiMode({ flagPlain: true });
      expect(a).not.toBe(b);
      expect(a).toEqual(b);
    });
  });
});
