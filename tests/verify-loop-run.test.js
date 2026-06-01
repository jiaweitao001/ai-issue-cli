const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());

const mockRunTask = jest.fn();
jest.mock('../lib/agents', () => ({ runTask: mockRunTask }));

jest.mock('../lib/agents/command-options', () => ({
  resolveAgentCommandSelection: jest.fn(() => ({ agentName: 'copilot', model: 'gpt-4' }))
}));

const mockRunGit = jest.fn();
jest.mock('../lib/git-utils', () => ({ runGit: mockRunGit }));

jest.mock('../lib/prompt-loader', () => ({
  loadPrompt: jest.fn(() => 'Verify fix template')
}));

jest.mock('../lib/verify/repo-detector', () => ({
  detectAzurermRepo: jest.fn(() => ({ supported: true }))
}));

jest.mock('../lib/verify/platform-detector', () => ({
  detectSupportedPlatform: jest.fn(() => ({ supported: true }))
}));

jest.mock('../lib/verify/tools-bootstrap', () => ({
  collectToolPreflight: jest.fn(() => ({ warnings: [], diagnostics: {} }))
}));

jest.mock('../lib/verify/gate-registry', () => ({
  getAllGates: jest.fn(() => [{
    id: 'unit-test',
    sourceWorkflow: 'unit-test.yaml',
    phase: 'A',
    paths: ['**.go'],
    commands: [],
    guidance: 'guidance',
    timeoutSec: 1,
    mutates: false
  }])
}));

const mockRunGate = jest.fn();
jest.mock('../lib/verify/gate-runner', () => ({
  runGate: mockRunGate
}));

const { runPostPhase2VerifyLoop } = require('../lib/verify-loop');

function config(overrides = {}) {
  return {
    repoPath: '/repo',
    reportPath: '/reports',
    model: 'gpt-4',
    verifyLoop: {
      enabled: true,
      maxAttempts: 2,
      phaseATimeoutSec: 10,
      phaseBTimeoutSec: 10,
      parallelism: 1,
      skipGates: []
    },
    ...overrides
  };
}

describe('runPostPhase2VerifyLoop dirty handling', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('marks the result dirty when the main worktree is dirty before verification', async () => {
    mockRunGit.mockImplementation((_repoPath, command) => {
      if (command === 'git status --porcelain') return ' M file.go';
      return 'newhead';
    });

    const result = await runPostPhase2VerifyLoop({
      issueNumber: '123',
      issueType: 'CODE_CHANGE',
      config: config(),
      prePhase2Head: 'oldhead'
    });

    expect(result.dirty).toBe(true);
    expect(result.skipped).toBe(true);
    expect(mockRunTask).not.toHaveBeenCalled();
  });

  it('marks the result dirty when verify_fix crashes after leaving changes', async () => {
    mockRunGate.mockResolvedValue({
      gateId: 'unit-test',
      passed: false,
      exitCode: 1,
      durationMs: 1,
      output: 'failed',
      guidance: 'guidance'
    });
    mockRunTask.mockRejectedValue(new Error('agent crashed'));
    mockRunGit.mockImplementation((_repoPath, command) => {
      if (command === 'git rev-parse HEAD') return 'newhead';
      if (command === 'git diff --name-only oldhead..HEAD') return 'file.go';
      if (command === 'git status --porcelain') {
        return mockRunGit.mock.calls.filter(c => c[1] === 'git status --porcelain').length >= 2
          ? ' M file.go'
          : '';
      }
      return '';
    });

    const result = await runPostPhase2VerifyLoop({
      issueNumber: '123',
      issueType: 'CODE_CHANGE',
      config: config(),
      prePhase2Head: 'oldhead',
      options: {}
    });

    expect(result.dirty).toBe(true);
    expect(result.warnings.join('\n')).toContain('agent crashed');
  });
});
