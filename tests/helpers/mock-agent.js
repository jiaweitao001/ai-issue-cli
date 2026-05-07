const mockRunTask = jest.fn();
const mockCreateAgent = jest.fn();
const mockSelectAgentForTask = jest.fn(() => 'copilot');

function mockCreateAgentModule() {
  return {
    runTask: mockRunTask,
    createAgent: mockCreateAgent,
    selectAgentForTask: mockSelectAgentForTask
  };
}

function mockResetAgentMocks() {
  mockRunTask.mockReset();
  mockCreateAgent.mockReset();
  mockSelectAgentForTask.mockReset();
  mockSelectAgentForTask.mockReturnValue('copilot');
}

module.exports = {
  mockRunTask,
  mockCreateAgent,
  mockSelectAgentForTask,
  mockCreateAgentModule,
  mockResetAgentMocks
};
