const mockRunTask = jest.fn();
const mockCopilotAgent = jest.fn(() => ({ runTask: mockRunTask }));

jest.mock('../../lib/agents/copilot-agent', () => ({
  CopilotAgent: mockCopilotAgent
}));

const { createAgent, runTask, selectAgentForTask, REGISTRY } = require('../../lib/agents');

describe('agents index', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunTask.mockResolvedValue({ success: true, artifacts: {}, git: {} });
  });

  it('registers only copilot in 5A', () => {
    expect(Object.keys(REGISTRY)).toEqual(['copilot']);
  });

  it.each([
    'research',
    'solution',
    'rubber_duck_critique',
    'rubber_duck_fix',
    'auto_review',
    'evaluation'
  ])('selectAgentForTask returns copilot for %s', (taskType) => {
    expect(selectAgentForTask({ agent: 'copilot' }, taskType)).toBe('copilot');
  });

  it('createAgent creates a CopilotAgent by default', () => {
    const config = { model: 'm', repoPath: '/repo', reportPath: '/reports' };
    const agent = createAgent(config);

    expect(mockCopilotAgent).toHaveBeenCalledWith(config);
    expect(agent).toEqual({ runTask: mockRunTask });
  });

  it('createAgent throws for unknown agents', () => {
    expect(() => createAgent({ agent: 'claude-code' })).toThrow('Unknown agent: claude-code');
  });

  it('runTask routes through selectAgentForTask and invokes agent.runTask', async () => {
    const config = { agent: 'ignored-in-5a', model: 'm', repoPath: '/repo', reportPath: '/reports' };
    const request = { taskType: 'research', prompt: 'p' };
    const result = await runTask(config, request);

    expect(mockCopilotAgent).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
    expect(mockRunTask).toHaveBeenCalledWith(request);
    expect(result).toEqual({ success: true, artifacts: {}, git: {} });
  });
});
