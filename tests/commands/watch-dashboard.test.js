/**
 * Tests for watch dashboard UI selection and rendering (PR-7).
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

describe('commands/watch dashboard (PR-7)', () => {
  beforeEach(() => {
    jest.resetModules();
  });

  afterEach(() => {
    jest.dontMock('terminal-kit');
  });

  function loadWatchWithTerminal(term) {
    jest.doMock('terminal-kit', () => ({ createTerminal: jest.fn(() => term) }));
    return require('../../lib/commands/watch');
  }

  it('uses TUI dashboard for foreground TTY watch', () => {
    const term = createTerminalMock();
    const { _internal } = loadWatchWithTerminal(term);
    const ui = _internal.createWatchUi(
      { uiMode: 'auto' },
      { stdout: { isTTY: true }, stdin: { isTTY: true }, env: {} }
    );

    ui.emit({
      type: 'task:start',
      taskId: 'issue-42',
      parentTaskId: 'issue-42',
      issue: '42',
      label: 'Issue #42',
      dashboardTitle: 'Watch Dashboard',
      agent: 'copilot'
    });

    expect(term._calls).toContainEqual(['bold.cyan', '\nWatch Dashboard\n']);
    expect(term._calls).toContainEqual(['yellow', '▶ #42  running  -  copilot  Starting\n']);
  });

  it('falls back to plain when stdout is not a TTY', () => {
    const term = createTerminalMock();
    const { _internal } = loadWatchWithTerminal(term);
    const ui = _internal.createWatchUi(
      { uiMode: 'auto' },
      { stdout: { isTTY: false }, stdin: { isTTY: true }, env: {} }
    );

    ui.emit({
      type: 'task:start',
      taskId: 'issue-42',
      parentTaskId: 'issue-42',
      issue: '42',
      label: 'Issue #42',
      dashboardTitle: 'Watch Dashboard',
      plain: false
    });

    expect(ui.mode).toBe('plain');
    expect(term._calls).toEqual([]);
  });

  it('falls back to plain in CI even with TTY streams', () => {
    const term = createTerminalMock();
    const { _internal } = loadWatchWithTerminal(term);
    const ui = _internal.createWatchUi(
      { uiMode: 'auto' },
      { stdout: { isTTY: true }, stdin: { isTTY: true }, env: { CI: 'true' } }
    );

    expect(ui.mode).toBe('plain');
    expect(term._calls).toEqual([]);
  });
});
