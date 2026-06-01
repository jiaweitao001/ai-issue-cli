const mockRunTask = jest.fn();
const mockCopilotValidateInstallationSync = jest.fn(() => ({ installed: true, version: '1.0.0', errors: [] }));
const mockClaudeValidateInstallationSync = jest.fn(() => ({ installed: true, version: '1.0.0', errors: [] }));
const mockCopilotAgent = jest.fn(() => ({
  runTask: mockRunTask,
  validateInstallationSync: mockCopilotValidateInstallationSync
}));
const mockClaudeCodeAgent = jest.fn(() => ({
  runTask: mockRunTask,
  validateInstallationSync: mockClaudeValidateInstallationSync
}));

jest.mock('../../lib/agents/copilot-agent', () => ({
  CopilotAgent: mockCopilotAgent
}));
jest.mock('../../lib/agents/claude-code-agent', () => ({
  ClaudeCodeAgent: mockClaudeCodeAgent
}));

const { createAgent, runTask, selectAgentForTask, REGISTRY } = require('../../lib/agents');

describe('agents index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunTask.mockResolvedValue({ success: true, artifacts: {}, git: {} });
    mockCopilotValidateInstallationSync.mockReturnValue({ installed: true, version: '1.0.0', errors: [] });
    mockClaudeValidateInstallationSync.mockReturnValue({ installed: true, version: '1.0.0', errors: [] });
  });

  it('registers Copilot and Claude Code agents', () => {
    expect(Object.keys(REGISTRY)).toEqual(['copilot', 'claude-code']);
  });

  it.each([
    'research',
    'solution',
    'verify_fix',
    'evaluation'
  ])('selectAgentForTask uses the configured agent for %s', (taskType) => {
    expect(selectAgentForTask({ agent: 'claude-code' }, taskType)).toBe('claude-code');
  });

  it('selectAgentForTask pins auto_review to copilot', () => {
    expect(selectAgentForTask({ agent: 'claude-code' }, 'auto_review')).toBe('copilot');
  });

  it('selectAgentForTask honors rubberDuckAgent for rubber-duck tasks', () => {
    expect(selectAgentForTask({
      agent: 'claude-code',
      rubberDuckAgent: 'copilot'
    }, 'rubber_duck_critique')).toBe('copilot');
  });

  it('createAgent creates a CopilotAgent by default', () => {
    const config = { model: 'm', repoPath: '/repo', reportPath: '/reports' };
    const agent = createAgent(config);

    expect(mockCopilotAgent).toHaveBeenCalledWith(config);
    expect(agent).toEqual(expect.objectContaining({ runTask: mockRunTask }));
  });

  it('createAgent creates a ClaudeCodeAgent when requested', () => {
    const config = { agent: 'claude-code', model: 'm', repoPath: '/repo', reportPath: '/reports' };
    const agent = createAgent(config);

    expect(mockClaudeCodeAgent).toHaveBeenCalledWith(config);
    expect(agent).toEqual(expect.objectContaining({ runTask: mockRunTask }));
  });

  it('createAgent throws for unknown agents', () => {
    expect(() => createAgent({ agent: 'unknown' })).toThrow('Unknown agent: unknown');
  });

  it('runTask routes through selectAgentForTask and invokes agent.runTask', async () => {
    const config = { agent: 'claude-code', model: 'copilot-model', agents: { 'claude-code': { model: 'sonnet' } }, repoPath: '/repo', reportPath: '/reports' };
    const request = { taskType: 'research', prompt: 'p' };
    const result = await runTask(config, request);

    expect(mockClaudeCodeAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude-code' }));
    expect(mockRunTask).toHaveBeenCalledWith(expect.objectContaining({ model: 'sonnet' }));
    expect(result).toEqual({ success: true, artifacts: {}, git: {} });
  });

  it('runTask returns a skipped result when auto-review Copilot is unavailable', async () => {
    mockCopilotValidateInstallationSync.mockReturnValue({
      installed: false,
      version: null,
      errors: ['Copilot CLI not found']
    });

    const result = await runTask(
      { agent: 'claude-code', model: 'm', repoPath: '/repo', reportPath: '/reports' },
      { taskType: 'auto_review', prompt: 'p', repoPath: '/repo' }
    );

    expect(result.skipped).toBe(true);
    expect(result.reason).toContain('Auto review skipped');
    expect(mockRunTask).not.toHaveBeenCalled();
  });
});
