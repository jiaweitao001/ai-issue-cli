/**
 * Tests for lib/ui/index.js — createUi() factory.
 *
 * PR-0 invariants:
 *   - mode='plain' (any reason)        → returns PlainRenderer.
 *   - mode='tui' implicit (auto/etc.)  → silent fallback to PlainRenderer.
 *   - mode='tui' explicit (flag/env/config) → process.exit(22) (FR-3).
 *
 * PR-2 additions:
 *   - defaultUi() singleton + _resetDefaultUi().
 */

// Mock logger so PlainRenderer's forwarded methods don't print during tests.
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const {
  createUi,
  defaultUi,
  TUI_REQUIRED_EXIT_CODE,
  _resetDefaultUi
} = require('../../lib/ui');
const { PlainRenderer } = require('../../lib/ui/plain-renderer');

function tty() { return { isTTY: true }; }
function pipe() { return { isTTY: false }; }

describe('lib/ui — createUi() (PR-0)', () => {
  let exitSpy;
  let stderrSpy;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stderrSpy.mockRestore();
    delete process.env.AI_ISSUE_DEBUG;
  });

  describe('exit code constant', () => {
    it('exposes TUI_REQUIRED_EXIT_CODE = 22', () => {
      expect(TUI_REQUIRED_EXIT_CODE).toBe(22);
    });
  });

  describe('plain paths', () => {
    it('--plain → PlainRenderer (no exit)', () => {
      const ui = createUi({ flagPlain: true, stdout: tty(), stdin: tty(), env: {} });
      expect(ui).toBeInstanceOf(PlainRenderer);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('non-TTY stdout → silent PlainRenderer (no exit)', () => {
      const ui = createUi({ stdout: pipe(), stdin: tty(), env: {} });
      expect(ui).toBeInstanceOf(PlainRenderer);
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it('config.uiMode=plain → PlainRenderer', () => {
      const ui = createUi({ stdout: tty(), stdin: tty(), env: {}, config: { uiMode: 'plain' } });
      expect(ui).toBeInstanceOf(PlainRenderer);
    });
  });

  describe('TUI explicit (FR-3 fail-fast)', () => {
    it('--tui + TTY → exit 22 (TUI not yet implemented in PR-0)', () => {
      expect(() =>
        createUi({ flagTui: true, stdout: tty(), stdin: tty(), env: {} })
      ).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(22);
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringContaining('TUI explicitly requested')
      );
    });

    it('AI_ISSUE_UI_MODE=tui → exit 22', () => {
      expect(() =>
        createUi({ stdout: tty(), stdin: tty(), env: { AI_ISSUE_UI_MODE: 'tui' } })
      ).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(22);
    });

    it('config.uiMode=tui → exit 22', () => {
      expect(() =>
        createUi({ stdout: tty(), stdin: tty(), env: {}, config: { uiMode: 'tui' } })
      ).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(22);
    });

    it('--tui + non-TTY stdout → exit 22 (explicit channel beats auto)', () => {
      expect(() =>
        createUi({ flagTui: true, stdout: pipe(), stdin: pipe(), env: {} })
      ).toThrow('process.exit called');
      expect(exitSpy).toHaveBeenCalledWith(22);
    });
  });

  describe('TUI implicit (FR-14 silent fallback)', () => {
    it('auto-ok (TTY everywhere) → silent fallback to PlainRenderer (PR-0 only)', () => {
      const ui = createUi({ stdout: tty(), stdin: tty(), env: { CI: 'false' } });
      expect(ui).toBeInstanceOf(PlainRenderer);
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  describe('debug output', () => {
    it('opts.debug=true writes [ui] line to stderr', () => {
      createUi({ flagPlain: true, debug: true, stdout: tty(), stdin: tty(), env: {} });
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[ui\] mode=plain reason=flag-plain/)
      );
    });

    it('AI_ISSUE_UI_MODE_DEBUG fallback path: AI_ISSUE_DEBUG=true env triggers debug print', () => {
      process.env.AI_ISSUE_DEBUG = 'true';
      createUi({ flagPlain: true, stdout: tty(), stdin: tty(), env: {} });
      expect(stderrSpy).toHaveBeenCalledWith(
        expect.stringMatching(/^\[ui\] mode=plain/)
      );
    });

    it('no debug → no [ui] line', () => {
      createUi({ flagPlain: true, stdout: tty(), stdin: tty(), env: {} });
      const debugCalls = stderrSpy.mock.calls.filter(args =>
        typeof args[0] === 'string' && args[0].startsWith('[ui]')
      );
      expect(debugCalls).toHaveLength(0);
    });
  });

  describe('defaults', () => {
    it('omitting stdout/stdin/env falls back to process.* without throwing', () => {
      // Force plain to avoid any TUI exit path.
      const ui = createUi({ flagPlain: true });
      expect(ui).toBeInstanceOf(PlainRenderer);
    });

    it('called with no args at all returns a renderer (defaults to process.*)', () => {
      // In Jest, process.stdout.isTTY is usually false → plain auto path.
      const ui = createUi();
      expect(ui).toBeInstanceOf(PlainRenderer);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // defaultUi() singleton (PR-2 / B2)
  // ─────────────────────────────────────────────────────────────────────

  describe('defaultUi() singleton', () => {
    beforeEach(() => {
      _resetDefaultUi();
    });

    afterEach(() => {
      _resetDefaultUi();
    });

    it('returns a PlainRenderer instance', () => {
      expect(defaultUi()).toBeInstanceOf(PlainRenderer);
    });

    it('returns the SAME instance on repeated calls (singleton identity)', () => {
      const a = defaultUi();
      const b = defaultUi();
      const c = defaultUi();
      expect(a).toBe(b);
      expect(b).toBe(c);
    });

    it('_resetDefaultUi() clears the cached instance', () => {
      const before = defaultUi();
      _resetDefaultUi();
      const after = defaultUi();
      expect(after).toBeInstanceOf(PlainRenderer);
      expect(after).not.toBe(before);
    });

    it('does NOT throw or call process.exit even with no input streams', () => {
      // defaultUi is the "just give me a sink" convenience used by the
      // logger forwarding shim; it must never escalate to fatal behavior.
      expect(() => defaultUi()).not.toThrow();
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
