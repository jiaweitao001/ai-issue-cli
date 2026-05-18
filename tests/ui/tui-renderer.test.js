/**
 * Tests for lib/ui/tui-renderer.js (PR-3 terminal-kit renderer).
 *
 * terminal-kit is mocked so tests validate our facade contract without relying
 * on a real terminal or ANSI byte sequences.
 */

function createTerminalMock() {
  const EventEmitter = require('events');
  const emitter = new EventEmitter();
  const calls = [];
  const term = jest.fn((text) => calls.push(['plain', text]));
  for (const color of ['green', 'red', 'blue', 'yellow', 'gray', 'white', 'cyan']) {
    term[color] = jest.fn((text) => calls.push([color, text]));
  }
  term.bold = {};
  for (const color of ['green', 'red', 'blue', 'yellow', 'gray', 'white', 'cyan']) {
    term.bold[color] = jest.fn((text) => calls.push([`bold.${color}`, text]));
  }
  term._calls = calls;
  term.grabInput = jest.fn();
  term.on = emitter.on.bind(emitter);
  term.once = emitter.once.bind(emitter);
  term.emit = emitter.emit.bind(emitter);
  term.removeListener = emitter.removeListener.bind(emitter);
  return term;
}

class FakeStdin extends require('events').EventEmitter {
  constructor() {
    super();
    this.isTTY = true;
    this.isRaw = false;
    this.readable = true;
    this.paused = true;
    this.setEncoding = jest.fn();
    this.setRawMode = jest.fn((enabled) => {
      this.isRaw = enabled;
    });
    this.resume = jest.fn(() => {
      this.paused = false;
    });
    this.pause = jest.fn(() => {
      this.paused = true;
    });
  }

  isPaused() {
    return this.paused;
  }
}

function loadWithMock(term) {
  const mockCreateTerminal = jest.fn(() => term);
  jest.doMock('terminal-kit', () => ({ createTerminal: mockCreateTerminal }));
  const { TuiRenderer } = require('../../lib/ui/tui-renderer');
  return { TuiRenderer, mockCreateTerminal };
}

describe('lib/ui/tui-renderer — TuiRenderer (PR-3)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock('terminal-kit');
  });

  it('lazy-loads terminal-kit through createTerminal with provided streams', () => {
    const term = createTerminalMock();
    const { TuiRenderer, mockCreateTerminal } = loadWithMock(term);
    const stdout = { isTTY: true };
    const stdin = { isTTY: true };
    const stderr = {};

    const ui = new TuiRenderer({ stdout, stdin, stderr });

    expect(ui.mode).toBe('tui');
    expect(mockCreateTerminal).toHaveBeenCalledWith({
      stdin,
      stdout,
      stderr,
      generic: 'xterm'
    });
  });

  it('throws before requiring terminal-kit when stdout is not a TTY', () => {
    const term = createTerminalMock();
    const { TuiRenderer, mockCreateTerminal } = loadWithMock(term);

    expect(() => new TuiRenderer({ stdout: { isTTY: false } })).toThrow('TUI requires a TTY stdout');
    expect(mockCreateTerminal).not.toHaveBeenCalled();
  });

  it('surfaces a helpful install hint when terminal-kit is missing', () => {
    jest.doMock('terminal-kit', () => {
      const err = new Error('Cannot find module terminal-kit');
      err.code = 'MODULE_NOT_FOUND';
      throw err;
    });
    const { TuiRenderer } = require('../../lib/ui/tui-renderer');

    expect(() => new TuiRenderer({ stdout: { isTTY: true } })).toThrow('terminal-kit is not installed');
  });

  it('restores prior raw mode only if construction changed it before failing', () => {
    const stdin = { isTTY: true, isRaw: false, setRawMode: jest.fn() };
    jest.doMock('terminal-kit', () => {
      stdin.isRaw = true;
      throw new Error('terminal init failed');
    });
    const { TuiRenderer } = require('../../lib/ui/tui-renderer');

    expect(() => new TuiRenderer({ stdout: { isTTY: true }, stdin })).toThrow('terminal init failed');
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });

  it('does not call setRawMode when construction fails without changing raw mode', () => {
    jest.doMock('terminal-kit', () => {
      throw new Error('terminal init failed');
    });
    const { TuiRenderer } = require('../../lib/ui/tui-renderer');
    const stdin = { isTTY: true, isRaw: false, setRawMode: jest.fn() };

    expect(() => new TuiRenderer({ stdout: { isTTY: true }, stdin })).toThrow('terminal init failed');
    expect(stdin.setRawMode).not.toHaveBeenCalled();
  });

  it('renders core methods through terminal-kit colors', () => {
    const term = createTerminalMock();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true } });

    ui.success('done');
    ui.error('boom');
    ui.info('note');
    ui.warn('careful');

    expect(term._calls).toEqual([
      ['green', '✅ done\n'],
      ['red', '❌ boom\n'],
      ['blue', 'ℹ️  note\n'],
      ['yellow', '⚠️  careful\n']
    ]);
  });

  it('renders grouped status lists with help and command lines', () => {
    const term = createTerminalMock();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true } });

    ui.statusList([
      {
        title: 'Core',
        items: [
          { status: 'ok', name: 'Node.js', detail: 'v20' },
          { status: 'fail', name: 'GITHUB_TOKEN', help: 'Set token', command: 'export GITHUB_TOKEN=...' }
        ]
      }
    ]);

    expect(term._calls).toContainEqual(['bold.cyan', 'Core\n']);
    expect(term._calls).toContainEqual(['green', '1. ✅ Node.js    [v20]\n']);
    expect(term._calls).toContainEqual(['red', '2. ❌ GITHUB_TOKEN\n']);
    expect(term._calls).toContainEqual(['yellow', '   💡 Set token\n']);
    expect(term._calls).toContainEqual(['gray', '   $ export GITHUB_TOKEN=...\n']);
  });

  it('renders task events as timeline lines', () => {
    const term = createTerminalMock();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true } });

    ui.emit({ type: 'task:start', taskId: 'phase1', label: 'Phase 1', startedAt: 100 });
    ui.emit({ type: 'task:finish', taskId: 'phase1', label: 'Phase 1', endedAt: 1600, success: true });

    expect(term._calls).toContainEqual(['bold.cyan', '\nTimeline\n']);
    expect(term._calls).toContainEqual(['yellow', '▶ Phase 1\n']);
    expect(term._calls).toContainEqual(['green', '✓ Phase 1 (1.5s)\n']);
    expect(term._calls.filter(([style, text]) => style === 'bold.cyan' && text === '\nTimeline\n')).toHaveLength(1);
  });

  it('renders parent task events as dashboard rows', () => {
    const term = createTerminalMock();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true } });

    ui.emit({
      type: 'task:start',
      taskId: 'issue-123',
      parentTaskId: 'issue-123',
      label: 'Issue #123',
      startedAt: 100,
      agent: 'copilot'
    });
    ui.emit({
      type: 'task:start',
      taskId: 'issue-123:phase1',
      parentTaskId: 'issue-123',
      label: 'Phase 1',
      startedAt: 150,
      agent: 'copilot'
    });
    ui.emit({
      type: 'task:finish',
      taskId: 'issue-123',
      parentTaskId: 'issue-123',
      endedAt: 1600,
      success: true,
      agent: 'copilot'
    });

    expect(term._calls).toContainEqual(['bold.cyan', '\nBatch Dashboard\n']);
    expect(term._calls).toContainEqual(['gray', '#issue  status  duration  agent  lastStep\n']);
    expect(term._calls).toContainEqual(['yellow', '▶ #123  running  -  copilot  Starting\n']);
    expect(term._calls).toContainEqual(['yellow', '▶ #123  running  -  copilot  Phase 1\n']);
    expect(term._calls).toContainEqual(['green', '✓ #123  success  1.5s  copilot  Phase 1\n']);
    expect(term._calls.filter(([style, text]) => style === 'bold.cyan' && text === '\nBatch Dashboard\n')).toHaveLength(1);
  });

  it('uses custom dashboard title for watch events', () => {
    const term = createTerminalMock();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true } });

    ui.emit({
      type: 'task:start',
      taskId: 'issue-123',
      parentTaskId: 'issue-123',
      label: 'Issue #123',
      dashboardTitle: 'Watch Dashboard'
    });

    expect(term._calls).toContainEqual(['bold.cyan', '\nWatch Dashboard\n']);
  });

  it('lets TUI tables move to the next page and quit with terminal-kit key events', async () => {
    const term = createTerminalMock();
    const stdin = new FakeStdin();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true }, stdin });
    const rows = Array.from({ length: 25 }, (_v, i) => [`row-${i + 1}`]);

    const tablePromise = ui.table(rows, [{ header: 'Name', width: 6 }], { pageSize: 20 });
    setImmediate(() => {
      term.emit('key', 'n');
      setImmediate(() => term.emit('key', 'q'));
    });
    await tablePromise;

    const renderedText = term._calls.map(([_style, text]) => text).join('');
    expect(renderedText).toContain('row-21');
    expect(renderedText).toContain('Page 2/2  Rows 25');
    expect(term.grabInput).toHaveBeenCalledWith(true);
    expect(term.grabInput).toHaveBeenLastCalledWith(false);
  });

  it('handles table filter and detail commands with terminal-kit key events', async () => {
    const term = createTerminalMock();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true }, stdin: new FakeStdin() });
    ui._readLine = jest.fn()
      .mockResolvedValueOnce('row-25')
      .mockResolvedValueOnce('1');
    const rows = Array.from({ length: 25 }, (_v, i) => [`row-${i + 1}`, `title-${i + 1}`]);
    const columns = [{ header: 'Name', width: 6 }, { header: 'Title', width: 8 }];

    const tablePromise = ui.table(rows, columns, { pageSize: 20 });
    setImmediate(() => {
      term.emit('key', 'f');
      setImmediate(() => {
        term.emit('key', 'd');
        setImmediate(() => term.emit('key', 'q'));
      });
    });
    await tablePromise;

    const renderedText = term._calls.map(([_style, text]) => text).join('');
    expect(ui._readLine).toHaveBeenCalledWith('Filter: ');
    expect(renderedText).toContain('Enter text to filter the already-loaded rows, or press Enter to clear the filter.');
    expect(ui._readLine).toHaveBeenCalledWith('Row number: ');
    expect(renderedText).toContain('Enter current-page row number (1-1) to show details, or press Enter to clear.');
    expect(renderedText).toContain('filter="row-25"');
    expect(renderedText).toContain('Details\n');
    expect(renderedText).toContain('Name: row-25');
  });

  it('falls back to raw stdin data when terminal-kit key events are unavailable', async () => {
    const term = createTerminalMock();
    delete term.grabInput;
    delete term.once;
    delete term.removeListener;
    const stdin = new FakeStdin();
    const { TuiRenderer } = loadWithMock(term);
    const ui = new TuiRenderer({ stdout: { isTTY: true }, stdin });
    const rows = Array.from({ length: 25 }, (_v, i) => [`row-${i + 1}`]);

    const tablePromise = ui.table(rows, [{ header: 'Name', width: 6 }], { pageSize: 20 });
    setImmediate(() => {
      stdin.emit('data', 'n');
      setImmediate(() => stdin.emit('data', 'q'));
    });
    await tablePromise;

    const renderedText = term._calls.map(([_style, text]) => text).join('');
    expect(renderedText).toContain('row-21');
    expect(stdin.setRawMode).toHaveBeenCalledWith(true);
    expect(stdin.setRawMode).toHaveBeenCalledWith(false);
  });
});
