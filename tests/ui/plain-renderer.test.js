/**
 * Tests for lib/ui/plain-renderer.js (PR-2 facade).
 *
 * The PlainRenderer is the byte-equal sink that lib/logger now delegates to.
 * Two layers of contract:
 *
 *   1. **Byte-equal core** (B2 contract / acceptance §5.4): success / error /
 *      info / warn / debug / log / highlight must produce strings identical to
 *      the legacy lib/logger output for the same input. Today's
 *      tests/logger.test.js + the ~10 mock-logger command tests are the
 *      cross-check.
 *   2. **New facade methods** (PR-3+ surface): header / table / statusList /
 *      emit, plus error+warn opts. These have no legacy counterpart so they
 *      are tested in full here.
 *
 * Strategy: spy on console.log / console.error and assert with snapshot-quality
 * substring + line-shape matchers. We disable chalk colour by setting
 * `chalk.level = 0` per-test (saved/restored) so assertions stay readable; the
 * cross-check via tests/logger.test.js still runs at chalk's default level so
 * any byte-level drift would surface there too.
 */

const chalk = require('chalk');
const {
  PlainRenderer,
  _statusIcon,
  _SEPARATOR
} = require('../../lib/ui/plain-renderer');

describe('lib/ui/plain-renderer — PlainRenderer (PR-2 facade)', () => {
  let logSpy;
  let errSpy;
  let exitSpy;
  let originalChalkLevel;
  let originalDebug;

  beforeEach(() => {
    logSpy = jest.spyOn(console, 'log').mockImplementation();
    errSpy = jest.spyOn(console, 'error').mockImplementation();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    originalChalkLevel = chalk.level;
    chalk.level = 0; // strip ANSI for byte-readable assertions
    originalDebug = process.env.AI_ISSUE_DEBUG;
    delete process.env.AI_ISSUE_DEBUG;
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    exitSpy.mockRestore();
    chalk.level = originalChalkLevel;
    if (originalDebug === undefined) delete process.env.AI_ISSUE_DEBUG;
    else process.env.AI_ISSUE_DEBUG = originalDebug;
  });

  // ─────────────────────────────────────────────────────────────────────
  // Identity / exports
  // ─────────────────────────────────────────────────────────────────────

  describe('identity', () => {
    it('exposes mode = "plain"', () => {
      expect(new PlainRenderer().mode).toBe('plain');
    });

    it('accepts an opts argument without throwing', () => {
      expect(() => new PlainRenderer({ stdout: process.stdout })).not.toThrow();
    });

    it('accepts no argument without throwing', () => {
      expect(() => new PlainRenderer()).not.toThrow();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // Byte-equal core (matches legacy lib/logger output)
  // ─────────────────────────────────────────────────────────────────────

  describe('byte-equal core (logger contract)', () => {
    it('success(msg) → console.log("✅ msg")', () => {
      new PlainRenderer().success('done');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toBe('✅ done');
    });

    it('error(msg) → console.error("❌ msg") (no opts → no extra lines)', () => {
      new PlainRenderer().error('boom');
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls[0][0]).toBe('❌ boom');
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('info(msg) → console.log("ℹ️  msg")  (two-space gap matches today)', () => {
      new PlainRenderer().info('note');
      expect(logSpy.mock.calls[0][0]).toBe('ℹ️  note');
    });

    it('warn(msg) → console.log("⚠️  msg") (no opts → no extra lines)', () => {
      new PlainRenderer().warn('careful');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toBe('⚠️  careful');
    });

    it('debug(msg) prints "[DEBUG] msg" only when AI_ISSUE_DEBUG=true', () => {
      const r = new PlainRenderer();
      r.debug('x');
      expect(logSpy).not.toHaveBeenCalled();
      process.env.AI_ISSUE_DEBUG = 'true';
      r.debug('x');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toBe('[DEBUG] x');
    });

    it('log(...args) is a thin console.log passthrough', () => {
      new PlainRenderer().log('a', 'b', 1);
      expect(logSpy).toHaveBeenCalledWith('a', 'b', 1);
    });

    it('highlight(text) returns a string (does NOT print)', () => {
      const r = new PlainRenderer();
      const out = r.highlight('hello');
      expect(typeof out).toBe('string');
      expect(out).toBe('hello'); // chalk.level=0 → pure string
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // error / warn opts (PR-3+ surface)
  // ─────────────────────────────────────────────────────────────────────

  describe('error opts', () => {
    it('opts.fix prints an indented "💡 fix" line on stdout', () => {
      new PlainRenderer().error('boom', { fix: 'try harder' });
      expect(errSpy).toHaveBeenCalledTimes(1);
      expect(errSpy.mock.calls[0][0]).toBe('❌ boom');
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy.mock.calls[0][0]).toBe('   💡 try harder');
    });

    it('opts.command prints an indented "$ command" line on stdout', () => {
      new PlainRenderer().error('boom', { command: 'ai-issue init' });
      expect(errSpy.mock.calls[0][0]).toBe('❌ boom');
      expect(logSpy.mock.calls[0][0]).toBe('   $ ai-issue init');
    });

    it('opts.fix + opts.command both print, fix first', () => {
      new PlainRenderer().error('boom', { fix: 'F', command: 'C' });
      expect(logSpy.mock.calls[0][0]).toBe('   💡 F');
      expect(logSpy.mock.calls[1][0]).toBe('   $ C');
    });

    it('opts.exit calls process.exit with the given code', () => {
      expect(() => new PlainRenderer().error('boom', { exit: 42 })).toThrow(
        'process.exit called'
      );
      expect(exitSpy).toHaveBeenCalledWith(42);
    });

    it('opts.exit fires AFTER fix/command lines so user sees the hint', () => {
      expect(() =>
        new PlainRenderer().error('boom', { fix: 'try this', exit: 1 })
      ).toThrow('process.exit called');
      expect(logSpy).toHaveBeenCalledWith('   💡 try this');
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  describe('warn opts', () => {
    it('opts.fix and opts.command print under the warning line', () => {
      new PlainRenderer().warn('careful', { fix: 'F', command: 'C' });
      expect(logSpy.mock.calls.map((c) => c[0])).toEqual([
        '⚠️  careful',
        '   💡 F',
        '   $ C'
      ]);
    });

    it('warn never calls process.exit (asymmetric vs error)', () => {
      // @ts-ignore - intentionally ignored: warn does not honour `exit`
      new PlainRenderer().warn('careful', { exit: 1 });
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // header
  // ─────────────────────────────────────────────────────────────────────

  describe('header', () => {
    it('emits exactly 4 lines: blank, title, separator, blank', () => {
      new PlainRenderer().header('🔍 Environment Check');
      expect(logSpy).toHaveBeenCalledTimes(4);
      expect(logSpy.mock.calls[0][0]).toBe('');
      expect(logSpy.mock.calls[1][0]).toBe('🔍 Environment Check');
      expect(logSpy.mock.calls[2][0]).toBe(_SEPARATOR);
      expect(logSpy.mock.calls[3][0]).toBe('');
    });

    it('separator is 38 box-drawing dashes (matches check.js / model.js today)', () => {
      expect(_SEPARATOR).toBe('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      expect(_SEPARATOR).toHaveLength(38);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // table
  // ─────────────────────────────────────────────────────────────────────

  describe('table', () => {
    it('renders a simple table with header, rule, and rows padded to widest cell', () => {
      new PlainRenderer().table(
        [
          ['gpt-5', 'OpenAI', 'pro'],
          ['claude', 'Anthropic', 'pro']
        ],
        [
          { header: 'ID' },
          { header: 'Vendor' },
          { header: 'Tier' }
        ]
      );
      const lines = logSpy.mock.calls.map((c) => c[0]);
      // 1 header + 1 rule + 2 rows
      expect(lines).toHaveLength(4);
      // Widths derived from longest cell per column:
      //   col0 max(ID=2, gpt-5=5, claude=6) = 6
      //   col1 max(Vendor=6, OpenAI=6, Anthropic=9) = 9
      //   col2 max(Tier=4, pro=3, pro=3) = 4
      expect(lines[0]).toBe('ID     Vendor    Tier');
      expect(lines[1]).toBe('────── ───────── ────');
      expect(lines[2]).toBe('gpt-5  OpenAI    pro ');
      expect(lines[3]).toBe('claude Anthropic pro ');
    });

    it('honours explicit per-column min width', () => {
      new PlainRenderer().table([['a', 'b']], [
        { header: 'X', width: 5 },
        { header: 'Y', width: 4 }
      ]);
      const lines = logSpy.mock.calls.map((c) => c[0]);
      expect(lines[0]).toBe('X     Y   ');
      expect(lines[2]).toBe('a     b   ');
    });

    it('no-ops on empty columns', () => {
      new PlainRenderer().table([['a']], []);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it('handles missing cells without throwing', () => {
      new PlainRenderer().table([[null]], [{ header: 'H' }]);
      const lines = logSpy.mock.calls.map((c) => c[0]);
      expect(lines).toHaveLength(3);
      expect(lines[2]).toBe(' '); // padded empty
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // statusList
  // ─────────────────────────────────────────────────────────────────────

  describe('statusList', () => {
    it('renders groups with bold-cyan title and globally-numbered items', () => {
      new PlainRenderer().statusList([
        {
          title: 'Core',
          items: [
            { status: 'ok', name: 'Node version', detail: 'v20.10' },
            { status: 'fail', name: 'Config file', help: 'Run ai-issue init' }
          ]
        },
        {
          title: 'Agents',
          items: [
            { status: 'warn', name: 'claude binary', detail: 'not on PATH' }
          ]
        }
      ]);
      const stdoutLines = logSpy.mock.calls.map((c) => c[0]);
      const stderrLines = errSpy.mock.calls.map((c) => c[0]);
      // Group 1: blank, title, item1 (ok→stdout), item2 (fail→stderr) + help→stdout
      // Group 2: blank, title, item3 (warn→stdout)
      expect(stdoutLines).toContain('');
      expect(stdoutLines).toContain('Core');
      expect(stdoutLines).toContain('1. ✅ Node version    [v20.10]');
      expect(stderrLines).toContain('2. ❌ Config file');
      expect(stdoutLines).toContain('   💡 Run ai-issue init');
      expect(stdoutLines).toContain('Agents');
      expect(stdoutLines).toContain('3. ⚠️  claude binary    [not on PATH]');
    });

    it('numbering is global across groups', () => {
      new PlainRenderer().statusList([
        { title: 'A', items: [{ status: 'ok', name: 'x' }] },
        { title: 'B', items: [{ status: 'ok', name: 'y' }] },
        { title: 'C', items: [{ status: 'ok', name: 'z' }] }
      ]);
      const lines = logSpy.mock.calls.map((c) => c[0]);
      expect(lines).toContain('1. ✅ x');
      expect(lines).toContain('2. ✅ y');
      expect(lines).toContain('3. ✅ z');
    });

    it('skip status uses ⏭ icon and gray colour', () => {
      new PlainRenderer().statusList([
        { title: 'X', items: [{ status: 'skip', name: 'KB', detail: 'optional' }] }
      ]);
      const lines = logSpy.mock.calls.map((c) => c[0]);
      expect(lines).toContain('1. ⏭  KB    [optional]');
    });

    it('non-array argument is a no-op', () => {
      // @ts-ignore - testing runtime defensive guard
      new PlainRenderer().statusList(null);
      // @ts-ignore
      new PlainRenderer().statusList('garbage');
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    });

    it('group with non-array items is silently skipped', () => {
      // @ts-ignore - testing defensive guard
      new PlainRenderer().statusList([{ title: 'X', items: null }]);
      // Note: 0 lines because group's items isn't an array
      expect(logSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // emit (orchestration events)
  // ─────────────────────────────────────────────────────────────────────

  describe('emit', () => {
    it('task:start prints "📚 label"', () => {
      new PlainRenderer().emit({ type: 'task:start', taskId: 'phase1', label: 'Phase 1: Research' });
      expect(logSpy.mock.calls[0][0]).toBe('📚 Phase 1: Research');
    });

    it('task:start without label falls back to taskId', () => {
      new PlainRenderer().emit({ type: 'task:start', taskId: 'evaluate' });
      expect(logSpy.mock.calls[0][0]).toBe('📚 evaluate');
    });

    it('task:finish (success) prints "✅ label (1.5s)"', () => {
      new PlainRenderer().emit({
        type: 'task:finish',
        taskId: 'phase1',
        label: 'Phase 1',
        durationMs: 1500,
        success: true
      });
      expect(logSpy.mock.calls[0][0]).toBe('✅ Phase 1 (1.5s)');
    });

    it('task:finish (failure) goes to stderr with ❌ icon', () => {
      new PlainRenderer().emit({
        type: 'task:finish',
        taskId: 'phase2',
        label: 'Phase 2',
        durationMs: 2200,
        success: false
      });
      expect(errSpy.mock.calls[0][0]).toBe('❌ Phase 2 (2.2s)');
    });

    it('task:finish without durationMs omits the time suffix', () => {
      new PlainRenderer().emit({ type: 'task:finish', taskId: 'rubber-duck' });
      expect(logSpy.mock.calls[0][0]).toBe('✅ rubber-duck');
    });

    it('unknown event types are silently ignored (forward-compat)', () => {
      // @ts-ignore - testing defensive guard
      new PlainRenderer().emit({ type: 'task:progress', taskId: 'x', progress: 0.5 });
      // @ts-ignore
      new PlainRenderer().emit(null);
      // @ts-ignore
      new PlainRenderer().emit('not an object');
      expect(logSpy).not.toHaveBeenCalled();
      expect(errSpy).not.toHaveBeenCalled();
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  // _statusIcon helper
  // ─────────────────────────────────────────────────────────────────────

  describe('_statusIcon', () => {
    it.each([
      ['ok', '✅'],
      ['fail', '❌'],
      ['warn', '⚠️ '],
      ['skip', '⏭ ']
    ])('returns %s icon for %s', (status, expected) => {
      expect(_statusIcon(status)).toBe(expected);
    });

    it('returns "•" for unknown status', () => {
      expect(_statusIcon('weird')).toBe('•');
      expect(_statusIcon(undefined)).toBe('•');
    });
  });
});
