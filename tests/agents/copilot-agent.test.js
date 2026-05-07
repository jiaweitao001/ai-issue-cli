const fs = require('fs');
const { execSync } = require('child_process');

jest.mock('fs');
jest.mock('child_process', () => ({
  execSync: jest.fn()
}));
jest.mock('../../lib/copilot', () => ({
  runCopilot: jest.fn()
}));
jest.mock('../../lib/utils', () => ({
  waitForFile: jest.fn()
}));
jest.mock('../../lib/git-utils', () => ({
  runGitArgs: jest.fn()
}));

const { runCopilot } = require('../../lib/copilot');
const { waitForFile } = require('../../lib/utils');
const { runGitArgs } = require('../../lib/git-utils');
const { CopilotAgent } = require('../../lib/agents/copilot-agent');
const { UnsupportedArtifactKind, ArtifactValidationError } = require('../../lib/agents/errors');

describe('CopilotAgent', () => {
  const config = {
    model: 'claude-sonnet-4.5',
    repoPath: '/repo',
    reportPath: '/reports',
    logLevel: 'info'
  };

  function baseRequest(overrides = {}) {
    return {
      taskType: 'research',
      prompt: 'prompt',
      repoPath: '/repo',
      reportPath: '/reports',
      model: 'gpt-5',
      mcpProfile: 'phase1',
      permissionProfile: 'noninteractive-full-auto',
      gitPolicy: { commitBehavior: 'no-commit' },
      expectedArtifacts: [],
      debugMode: false,
      silent: true,
      ...overrides
    };
  }

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
      if (argv[0] === 'rev-parse' && argv[1] === '--abbrev-ref') return currentBranch;
      if (argv[0] === 'rev-parse' && argv[1] === 'HEAD') return currentHead;
      if (argv[0] === 'log') return commits;
      if (argv[0] === 'diff') return changedFiles;
      if (argv[0] === 'reset' && argv[1] === '--soft') {
        currentHead = argv[2];
        return '';
      }
      if (argv[0] === 'checkout') {
        if (checkoutError) throw checkoutError;
        currentBranch = argv[1];
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
    mockGitState();
    runCopilot.mockResolvedValue(undefined);
    waitForFile.mockResolvedValue(true);
    fs.readFileSync.mockReturnValue('## Summary\ncontent');
  });

  afterEach(() => {
    console.warn.mockRestore();
  });

  describe('validateInstallationSync', () => {
    it('returns installed true with version when copilot is available', () => {
      execSync.mockReturnValue('copilot version 1.0.0\n');

      const result = new CopilotAgent(config).validateInstallationSync();

      expect(execSync).toHaveBeenCalledWith('copilot --version', { stdio: 'pipe', encoding: 'utf8' });
      expect(result).toEqual({ installed: true, version: 'copilot version 1.0.0', errors: [] });
    });

    it('returns installed false when copilot is unavailable', () => {
      execSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = new CopilotAgent(config).validateInstallationSync();

      expect(result.installed).toBe(false);
      expect(result.version).toBeNull();
      expect(result.errors[0]).toContain('Copilot CLI not found');
    });
  });

  it('passes request values through to runCopilot', async () => {
    const request = baseRequest({ expectedArtifacts: [] });

    await new CopilotAgent(config).runTask(request);

    expect(runCopilot).toHaveBeenCalledWith(
      'prompt',
      expect.objectContaining({
        ...config,
        model: 'gpt-5',
        repoPath: '/repo',
        reportPath: '/reports'
      }),
      {
        silent: true,
        debugMode: false,
        phase: 'phase1'
      }
    );
  });

  it('throws UnsupportedArtifactKind for non-file artifacts', async () => {
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'stdout', path: 'stdout' }]
    });

    await expect(new CopilotAgent(config).runTask(request)).rejects.toBeInstanceOf(UnsupportedArtifactKind);
  });

  it('throws when a required artifact is missing', async () => {
    waitForFile.mockResolvedValue(false);
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'file', path: '/reports/a.md' }]
    });

    await expect(new CopilotAgent(config).runTask(request)).rejects.toThrow('Expected artifact missing');
  });

  it('warns when a warn-mode artifact is missing', async () => {
    waitForFile.mockResolvedValue(false);
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'file', path: '/reports/a.md', failureMode: 'warn' }]
    });

    const result = await new CopilotAgent(config).runTask(request);

    expect(result.artifacts).toEqual({});
    expect(result.warnings[0]).toContain('Expected artifact missing');
  });

  it('warns when a warn-mode artifact cannot be read', async () => {
    fs.readFileSync.mockImplementation(() => {
      throw new Error('permission denied');
    });
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'file', path: '/reports/a.md', failureMode: 'warn' }]
    });

    const result = await new CopilotAgent(config).runTask(request);

    expect(result.warnings[0]).toContain('Cannot read artifact');
  });

  it('throws validation errors in throw mode', async () => {
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'file', path: '/reports/a.md', requiredSection: /^## Missing/m }]
    });

    await expect(new CopilotAgent(config).runTask(request)).rejects.toBeInstanceOf(ArtifactValidationError);
  });

  it('records validation warnings in warn mode', async () => {
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'file', path: '/reports/a.md', requiredSection: /^## Missing/m, failureMode: 'warn' }]
    });

    const result = await new CopilotAgent(config).runTask(request);

    expect(result.artifacts).toEqual({});
    expect(result.warnings[0]).toContain('Missing required section');
  });

  it('passes onArtifactWaitProgress to waitForFile', async () => {
    const onArtifactWaitProgress = jest.fn();
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'file', path: '/reports/a.md' }],
      onArtifactWaitProgress
    });

    await new CopilotAgent(config).runTask(request);

    expect(waitForFile).toHaveBeenCalledWith('/reports/a.md', 60000, onArtifactWaitProgress);
  });

  it('soft-resets unexpected commits in forbid-commit mode', async () => {
    const state = mockGitState({ head: 'abcdef123456', commits: 'commit1\ncommit2\n' });
    runCopilot.mockImplementation(async () => {
      state.setHead('fedcba654321');
    });
    const request = baseRequest({
      taskType: 'evaluation',
      gitPolicy: { commitBehavior: 'forbid-commit' }
    });

    const result = await new CopilotAgent(config).runTask(request);

    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['reset', '--soft', 'abcdef123456']);
    expect(result.warnings[0]).toContain('Detected 2 unexpected commit');
  });

  it('checks out the task-start branch before forbid-commit reset when branch drifted', async () => {
    const state = mockGitState({ branch: 'main', head: 'abcdef123456', commits: 'commit1\n' });
    runCopilot.mockImplementation(async () => {
      state.setBranch('feature');
      state.setHead('fedcba654321');
    });
    const request = baseRequest({
      taskType: 'auto_review',
      gitPolicy: { commitBehavior: 'forbid-commit' }
    });

    await new CopilotAgent(config).runTask(request);

    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['checkout', 'main']);
    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['reset', '--soft', 'abcdef123456']);
  });

  it('does not reset on the wrong branch when checkout back fails', async () => {
    const state = mockGitState({
      branch: 'main',
      head: 'abcdef123456',
      commits: 'commit1\n',
      checkoutError: new Error('checkout failed')
    });
    runCopilot.mockImplementation(async () => {
      state.setBranch('feature');
      state.setHead('fedcba654321');
    });
    const request = baseRequest({
      taskType: 'auto_review',
      gitPolicy: { commitBehavior: 'forbid-commit' }
    });

    const result = await new CopilotAgent(config).runTask(request);

    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['checkout', 'main']);
    expect(runGitArgs).not.toHaveBeenCalledWith('/repo', ['reset', '--soft', 'abcdef123456']);
    expect(result.warnings.join('\n')).toContain('Failed to restore branch');
  });

  it('runs forbid-commit cleanup when runCopilot throws, then rethrows the original error', async () => {
    const state = mockGitState({ head: 'abcdef123456', commits: 'commit1\n' });
    runCopilot.mockImplementation(async () => {
      state.setHead('fedcba654321');
      throw new Error('copilot failed');
    });
    const request = baseRequest({
      taskType: 'rubber_duck_critique',
      gitPolicy: { commitBehavior: 'forbid-commit' }
    });

    await expect(new CopilotAgent(config).runTask(request)).rejects.toThrow('copilot failed');
    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['reset', '--soft', 'abcdef123456']);
  });
});
