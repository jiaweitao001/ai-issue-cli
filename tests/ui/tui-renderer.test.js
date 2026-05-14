/**
 * Tests for lib/ui/tui-renderer.js (PR-3 terminal-kit renderer).
 *
 * terminal-kit is mocked so tests validate our facade contract without relying
 * on a real terminal or ANSI byte sequences.
 */

function createTerminalMock() {
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
  return term;
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
});
