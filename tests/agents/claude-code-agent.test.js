const { EventEmitter } = require('events');

const mockSpawn = jest.fn();
const mockExecSync = jest.fn();
jest.mock('child_process', () => ({
  spawn: mockSpawn,
  execSync: mockExecSync
}));

const mockToClaudeMcpConfigFile = jest.fn();
const mockCleanupTempMcpConfig = jest.fn();
jest.mock('../../lib/agents/mcp-normalizer', () => ({
  toClaudeMcpConfigFile: mockToClaudeMcpConfigFile,
  cleanupTempMcpConfig: mockCleanupTempMcpConfig
}));

jest.mock('../../lib/git-utils', () => ({
  runGitArgs: jest.fn()
}));

const { runGitArgs } = require('../../lib/git-utils');
const { ClaudeCodeAgent } = require('../../lib/agents/claude-code-agent');

describe('ClaudeCodeAgent', () => {
  const originalServiceUrl = process.env.AI_ISSUE_SERVICE_URL;
  const originalServiceApiKey = process.env.AI_ISSUE_SERVICE_API_KEY;
  const config = {
    agent: 'claude-code',
    model: 'copilot-model',
    repoPath: '/repo',
    reportPath: '/reports',
    serviceUrl: 'https://service.example.com',
    serviceApiKey: 'service-secret',
    agents: {
      'claude-code': { model: 'configured-claude-model' }
    }
  };

  function baseRequest(overrides = {}) {
    return {
      taskType: 'research',
      prompt: 'prompt',
      repoPath: '/repo',
      reportPath: '/reports',
      model: 'request-model',
      mcpProfile: 'phase1',
      permissionProfile: 'read-only',
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
    changedFiles = ''
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
      return '';
    });

    return {
      setHead: value => { currentHead = value; }
    };
  }

  function mockClaudeExit({ stdout = '', stderr = '', code = 0, onSpawn = null } = {}) {
    mockSpawn.mockImplementation(() => {
      if (onSpawn) onSpawn();
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { end: jest.fn() };
      process.nextTick(() => {
        if (stdout) child.stdout.emit('data', Buffer.from(stdout));
        if (stderr) child.stderr.emit('data', Buffer.from(stderr));
        child.emit('close', code);
      });
      return child;
    });
  }

  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_ISSUE_SERVICE_URL;
    delete process.env.AI_ISSUE_SERVICE_API_KEY;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockGitState();
    mockToClaudeMcpConfigFile.mockReturnValue('/tmp/mcp.json');
    mockClaudeExit({ stdout: 'plain stdout' });
  });

  afterEach(() => {
    console.warn.mockRestore();
    if (originalServiceUrl === undefined) {
      delete process.env.AI_ISSUE_SERVICE_URL;
    } else {
      process.env.AI_ISSUE_SERVICE_URL = originalServiceUrl;
    }
    if (originalServiceApiKey === undefined) {
      delete process.env.AI_ISSUE_SERVICE_API_KEY;
    } else {
      process.env.AI_ISSUE_SERVICE_API_KEY = originalServiceApiKey;
    }
  });

  describe('validateInstallationSync', () => {
    it('returns installed true with version when claude is available', () => {
      mockExecSync.mockReturnValue('claude 1.0.0\n');

      const result = new ClaudeCodeAgent(config).validateInstallationSync();

      expect(mockExecSync).toHaveBeenCalledWith('claude --version', { stdio: 'pipe', encoding: 'utf8' });
      expect(result).toEqual({ installed: true, version: 'claude 1.0.0', errors: [] });
    });

    it('returns installed false when claude is unavailable', () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('not found');
      });

      const result = new ClaudeCodeAgent(config).validateInstallationSync();

      expect(result.installed).toBe(false);
      expect(result.errors[0]).toContain('Claude Code CLI not found');
    });
  });

  it('spawns claude with expected args, cwd, env, and stdin', async () => {
    const request = baseRequest({
      expectedArtifacts: [{ kind: 'stdout', path: 'stdout' }]
    });

    const result = await new ClaudeCodeAgent(config).runTask(request);

    expect(mockSpawn).toHaveBeenCalledWith(
      'claude',
      expect.arrayContaining([
        '--print',
        '--model',
        'request-model',
        '--permission-mode',
        'plan',
        '--add-dir',
        '/reports',
        '--mcp-config',
        '/tmp/mcp.json',
        '--strict-mcp-config'
      ]),
      expect.objectContaining({
        cwd: '/repo',
        env: expect.objectContaining({
          AI_ISSUE_SERVICE_URL: 'https://service.example.com',
          AI_ISSUE_SERVICE_API_KEY: 'service-secret'
        }),
        stdio: ['pipe', 'pipe', 'pipe']
      })
    );
    const child = mockSpawn.mock.results[0].value;
    expect(child.stdin.end).toHaveBeenCalledWith('prompt');
    expect(result.artifacts).toEqual({ stdout: 'plain stdout' });
    expect(mockToClaudeMcpConfigFile).toHaveBeenCalledWith('phase1', {
      debugMode: false,
      runtimeEnv: expect.objectContaining({
        AI_ISSUE_SERVICE_URL: 'https://service.example.com',
        AI_ISSUE_SERVICE_API_KEY: 'service-secret'
      })
    });
    expect(mockCleanupTempMcpConfig).toHaveBeenCalledWith('/tmp/mcp.json');
  });

  it('uses configured Claude model when request model is absent', async () => {
    const request = baseRequest({ model: undefined });

    await new ClaudeCodeAgent(config).runTask(request);

    expect(mockSpawn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '--model',
      'configured-claude-model'
    ]));
  });

  it('uses bypassPermissions for full-auto tasks', async () => {
    await new ClaudeCodeAgent(config).runTask(baseRequest({
      permissionProfile: 'noninteractive-full-auto',
      mcpProfile: null
    }));

    expect(mockSpawn.mock.calls[0][1]).toEqual(expect.arrayContaining([
      '--permission-mode',
      'bypassPermissions'
    ]));
  });

  it('does not clean up debug MCP config files', async () => {
    await new ClaudeCodeAgent(config).runTask(baseRequest({ debugMode: true }));

    expect(mockCleanupTempMcpConfig).not.toHaveBeenCalled();
  });

  it('rejects when Claude exits non-zero', async () => {
    mockClaudeExit({ stderr: 'bad auth', code: 1 });

    await expect(new ClaudeCodeAgent(config).runTask(baseRequest())).rejects.toThrow('bad auth');
  });

  it('runs forbid-commit cleanup after Claude creates commits', async () => {
    const state = mockGitState({ head: 'oldhead', commits: 'c1\n' });
    mockClaudeExit({
      stdout: 'plain stdout',
      onSpawn: () => state.setHead('newhead')
    });

    const result = await new ClaudeCodeAgent(config).runTask(baseRequest({
      taskType: 'rubber_duck_critique',
      gitPolicy: { commitBehavior: 'forbid-commit' }
    }));

    expect(runGitArgs).toHaveBeenCalledWith('/repo', ['reset', '--soft', 'oldhead']);
    expect(result.warnings.join('\n')).toContain('Detected 1 unexpected commit');
  });
});
