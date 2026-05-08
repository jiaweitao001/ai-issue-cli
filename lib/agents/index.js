// @ts-check

const { CopilotAgent } = require('./copilot-agent');
const { ClaudeCodeAgent } = require('./claude-code-agent');

const REGISTRY = {
  copilot: (config) => new CopilotAgent(config),
  'claude-code': (config) => new ClaudeCodeAgent(config)
};

/**
 * @param {import('../types').Config} config
 * @returns {import('./base-agent').BaseAgent}
 */
function createAgent(config) {
  const agentName = config.agent || 'copilot';
  const factory = REGISTRY[agentName];
  if (!factory) {
    throw new Error(`Unknown agent: ${agentName}. Available agents: ${Object.keys(REGISTRY).join(', ')}`);
  }
  return factory(config);
}

/**
 * @param {import('../types').Config} _config
 * @param {import('../types').TaskRequest['taskType']} _taskType
 * @returns {string}
 */
function selectAgentForTask(_config, _taskType) {
  return 'copilot';
}

/**
 * @param {import('../types').Config} config
 * @param {import('../types').TaskRequest} request
 * @returns {Promise<import('../types').TaskResult>}
 */
async function runTask(config, request) {
  const agentName = selectAgentForTask(config, request.taskType);
  const agent = createAgent({ ...config, agent: agentName });
  return agent.runTask(request);
}

module.exports = {
  REGISTRY,
  createAgent,
  selectAgentForTask,
  runTask
};
