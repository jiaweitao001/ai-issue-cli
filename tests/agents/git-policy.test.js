jest.mock('../../lib/git-utils', () => ({
  runGitArgs: jest.fn()
}));

const { runGitArgs } = require('../../lib/git-utils');
const {
  snapshotGitState,
  collectGitMetadata,
  enforceGitPolicy
} = require('../../lib/agents/git-policy');

describe('git-policy', () => {
  function mockGitState({
    branch = 'main',
    head = 'beforehead',
    commits = '',
    changedFiles = '',
    checkoutError = null
  } = {}) {
    let currentBranch = branch;
    let currentHead = head;

    runGitArgs.mockImplementation((_repoPath, argv) => {
      if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref') return `${currentBranch}\n`;
      if (argv[0] === 'rev-parse' && argv[1] === 'HEAD') return `${currentHead}\n`;
      if (argv[0] === 'log') return commits;
      if (argv[0] === 'diff') return changedFiles;
      if (argv[0] === 'checkout') {
        if (checkoutError) throw checkoutError;
        currentBranch = argv[1];
        return '';
      }
      if (argv[0] === 'reset' && argv[1] === '--soft') {
        currentHead = argv[2];
        return '';
      }
      return '';
    });

    return {
      setBranch: value => { currentBranch = value; },
      setHead: value => { currentHead = value; }
    };
  }

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  it('captures branch and HEAD snapshots with trimmed git output', () => {
    mockGitState({ branch: 'main', head: 'abc123' });

    expect(snapshotGitState('/repo')).toEqual({ branch: 'main', head: 'abc123' });
  });

  it('collects commits and changed files', () => {
    mockGitState({ head: 'newhead', commits: 'c1\nc2\n', changedFiles: 'a.js\nb.js\n' });

    const metadata = collectGitMetadata('/repo', 'oldhead', 'newhead');

    expect(metadata).toEqual({
      beforeHead: 'oldhead',
      afterHead: 'newhead',
      commits: ['c1', 'c2'],
      changedFiles: ['a.js', 'b.js']
    });
  });

  it('does nothing for non-forbid policies', () => {
    mockGitState({ head: 'newhead', commits: 'c1\n' });

    const result = enforceGitPolicy('/repo', { branch: 'main', head: 'oldhead' }, { commitBehavior: 'may-commit' }, 'solution');

    expect(result.warnings).toEqual([]);
    expect(runGitArgs).not.toHaveBeenCalledWith('/repo', ['reset', '--soft', 'oldhead']);
  });

  it('soft-resets unexpected commits in forbid-commit mode', () => {
    const state = mockGitState({ head: 'oldhead', commits: 'c1\nc2\n' });
    const snapshot = snapshotGitState('/repo');
    state.setHead('newhead');

    const result = enforceGitPolicy('/repo', snapshot, { commitBehavior: 'forbid-commit' }, 'evaluation');

    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['reset', '--soft', 'oldhead']);
    expect(result.warnings[0]).toContain('Detected 2 unexpected commit');
  });

  it('checks out the task-start branch before reset when branch drifted', () => {
    const state = mockGitState({ branch: 'main', head: 'oldhead', commits: 'c1\n' });
    const snapshot = snapshotGitState('/repo');
    state.setBranch('feature');
    state.setHead('newhead');

    enforceGitPolicy('/repo', snapshot, { commitBehavior: 'forbid-commit' }, 'rubber_duck_critique');

    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['checkout', 'main']);
    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['reset', '--soft', 'oldhead']);
  });

  it('does not reset on the wrong branch when checkout fails', () => {
    const state = mockGitState({
      branch: 'main',
      head: 'oldhead',
      commits: 'c1\n',
      checkoutError: new Error('checkout failed')
    });
    const snapshot = snapshotGitState('/repo');
    state.setBranch('feature');
    state.setHead('newhead');

    const result = enforceGitPolicy('/repo', snapshot, { commitBehavior: 'forbid-commit' }, 'auto_review');

    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['checkout', 'main']);
    expect(runGitArgs).not.toHaveBeenCalledWith('/repo', ['reset', '--soft', 'oldhead']);
    expect(result.warnings.join('\n')).toContain('Failed to restore branch');
  });
});
