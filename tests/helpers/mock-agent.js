const mockRunTask = jest.fn();
const mockCreateAgent = jest.fn();
const mockSelectAgentForTask = jest.fn(() => 'copilot');
const mockResolveModelForTask = jest.fn((config) => config.modelOverride || config.model || 'gpt-4');

function mockCreateAgentModule() {
  return {
    runTask: mockRunTask,
    createAgent: mockCreateAgent,
    selectAgentForTask: mockSelectAgentForTask,
    resolveModelForTask: mockResolveModelForTask
  };
}

function mockResetAgentMocks() {
  mockRunTask.mockReset();
  mockCreateAgent.mockReset();
  mockSelectAgentForTask.mockReset();
  mockResolveModelForTask.mockReset();
  mockSelectAgentForTask.mockReturnValue('copilot');
  mockResolveModelForTask.mockImplementation((config) => config.modelOverride || config.model || 'gpt-4');
}

module.exports = {
  mockRunTask,
  mockCreateAgent,
  mockSelectAgentForTask,
  mockResolveModelForTask,
  mockCreateAgentModule,
  mockResetAgentMocks
};
