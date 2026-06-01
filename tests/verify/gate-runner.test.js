const EventEmitter = require('events');
const fs = require('fs');

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: mockSpawn
}));

const mockRunGit = jest.fn();
const mockRunGitArgs = jest.fn();
jest.mock('../../lib/git-utils', () => ({
  runGit: mockRunGit,
  runGitArgs: mockRunGitArgs
}));

const { runGate } = require('../../lib/verify/gate-runner');

function spawnResult(code, stdout = '', stderr = '') {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = jest.fn();
  process.nextTick(() => {
    if (stdout) child.stdout.emit('data', Buffer.from(stdout));
    if (stderr) child.stderr.emit('data', Buffer.from(stderr));
    child.emit('close', code);
  });
  return child;
}

describe('verify gate-runner', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(fs, 'mkdtempSync').mockReturnValue('/tmp/ai-issue-verify-test');
    mockRunGitArgs.mockReturnValue('');
  });

  afterEach(() => {
    fs.mkdtempSync.mockRestore();
  });

  it('runs gates in a disposable worktree and captures mutating side effects on failure', async () => {
    mockSpawn.mockReturnValue(spawnResult(1, '', 'failed'));
    mockRunGit.mockImplementation((repoPath, command) => {
      if (command === 'git status --porcelain=v1 -z') {
        return repoPath === '/repo' ? '' : ' M go.mod\0';
      }
      if (command === 'git status --porcelain') return ' M go.mod';
      if (command === 'git diff --compact-summary') return ' go.mod | 2 +-\n';
      if (command === 'git diff -- .') return 'diff --git a/go.mod b/go.mod\n';
      return '';
    });

    const result = await runGate('/repo', {
      id: 'depscheck',
      sourceWorkflow: 'depscheck.yaml',
      phase: 'A',
      paths: ['**.go'],
      commands: [{ cmd: 'make', args: ['depscheck'] }],
      guidance: 'guidance',
      timeoutSec: 1,
      mutates: true
    }, 1);

    expect(result.passed).toBe(false);
    expect(result.generatedDiff).toContain('go.mod');
    expect(mockRunGitArgs).toHaveBeenCalledWith('/repo', ['worktree', 'add', '--detach', '/tmp/ai-issue-verify-test', 'HEAD']);
    expect(mockRunGitArgs).toHaveBeenCalledWith('/repo', ['worktree', 'remove', '--force', '/tmp/ai-issue-verify-test']);
  });

  it('skips rather than running when the tree is dirty before a gate', async () => {
    mockRunGit.mockReturnValue(' M file.go\0');

    const result = await runGate('/repo', {
      id: 'unit-test',
      sourceWorkflow: 'unit-test.yaml',
      phase: 'B',
      paths: ['**.go'],
      commands: [{ cmd: 'gotestsum', args: [] }],
      guidance: 'guidance',
      timeoutSec: 1,
      mutates: false
    }, 1);

    expect(result.skipped).toBe(true);
    expect(mockSpawn).not.toHaveBeenCalled();
    expect(mockRunGitArgs).not.toHaveBeenCalled();
  });
});
