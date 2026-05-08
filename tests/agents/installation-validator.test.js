const mockCreateAgent = jest.fn();
const mockSelectAgentForTask = jest.fn(() => 'copilot');

jest.mock('../../lib/agents', () => ({
  createAgent: mockCreateAgent,
  selectAgentForTask: mockSelectAgentForTask
}));

const { validateConfiguredAgents } = require('../../lib/agents/installation-validator');

describe('installation-validator', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSelectAgentForTask.mockReturnValue('copilot');
    mockCreateAgent.mockImplementation((config) => ({
      name: config.agent,
      displayName: config.agent === 'claude-code' ? 'Claude Code' : 'Copilot CLI',
      validateInstallationSync: jest.fn(() => ({ installed: true, version: '1.0.0', errors: [] }))
    }));
  });

  it('validates the agent selected for the command task', () => {
    mockSelectAgentForTask.mockReturnValue('claude-code');

    validateConfiguredAgents({ agent: 'claude-code' }, { taskType: 'evaluation', includeRubberDuck: false });

    expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude-code' }));
  });

  it('also validates rubberDuckAgent when configured', () => {
    mockSelectAgentForTask.mockReturnValue('claude-code');

    validateConfiguredAgents({
      agent: 'claude-code',
      rubberDuckAgent: 'copilot'
    }, { taskType: 'research' });

    expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude-code' }));
    expect(mockCreateAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
  });

  it('throws with installation details when a required agent is missing', () => {
    mockCreateAgent.mockReturnValue({
      name: 'claude-code',
      displayName: 'Claude Code',
      validateInstallationSync: jest.fn(() => ({
        installed: false,
        version: null,
        errors: ['Claude Code CLI not found. Run: npm install -g @anthropic-ai/claude-code']
      }))
    });

    expect(() => validateConfiguredAgents({ agent: 'claude-code' }, { taskType: 'research' }))
      .toThrow('Claude Code is not installed. Claude Code CLI not found');
  });
});
