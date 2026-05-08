// @ts-check

const { CopilotAgent } = require('./copilot-agent');
const { ClaudeCodeAgent } = require('./claude-code-agent');
const { collectGitMetadata, readHead } = require('./git-policy');
const { resolveModelForAgent } = require('./model-resolver');

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
 * @param {import('../types').Config} config
 * @param {import('../types').TaskRequest['taskType']} taskType
 * @returns {string}
 */
function selectAgentForTask(config, taskType) {
  if (taskType === 'auto_review') return 'copilot';
  if (taskType === 'rubber_duck_critique' || taskType === 'rubber_duck_fix') {
    return config.rubberDuckAgent || config.agent || 'copilot';
  }
  return config.agent || 'copilot';
}

/**
 * @param {import('../types').Config} config
 * @param {import('../types').TaskRequest['taskType']} taskType
 * @returns {string}
 */
function resolveModelForTask(config, taskType) {
  const agentName = selectAgentForTask(config, taskType);
  return resolveModelForAgent(config, agentName, config.modelOverride);
}

/**
 * Treat a request model that equals the top-level config model as legacy
 * fallback input; resolve it against the routed agent to avoid passing Copilot
 * defaults to non-Copilot agents.
 *
 * @param {import('../types').Config} config
 * @param {string} agentName
 * @param {import('../types').TaskRequest} request
 * @returns {string}
 */
function resolveRequestModel(config, agentName, request) {
  if (config.modelOverride) {
    return resolveModelForAgent(config, agentName, config.modelOverride);
  }
  const resolved = resolveModelForAgent(config, agentName);
  if (!request.model || request.model === config.model) {
    return resolved;
  }
  return request.model;
}

/**
 * @param {string} repoPath
 * @returns {{ beforeHead: string, afterHead: string, commits: string[], changedFiles: string[] }}
 */
function safeGitMetadata(repoPath) {
  try {
    const head = readHead(repoPath);
    return collectGitMetadata(repoPath, head, head);
  } catch (_err) {
    return { beforeHead: '', afterHead: '', commits: [], changedFiles: [] };
  }
}

/**
 * @param {string} repoPath
 * @param {string} reason
 * @returns {import('../types').TaskResult}
 */
function createSkippedResult(repoPath, reason) {
  return {
    success: true,
    skipped: true,
    reason,
    artifacts: {},
    warnings: [reason],
    git: safeGitMetadata(repoPath)
  };
}

/**
 * @param {import('../types').Config} config
 * @param {import('../types').TaskRequest} request
 * @returns {Promise<import('../types').TaskResult>}
 */
async function runTask(config, request) {
  const agentName = selectAgentForTask(config, request.taskType);
  const agent = createAgent({ ...config, agent: agentName });
  if (request.taskType === 'auto_review' && agent && typeof agent.validateInstallationSync === 'function') {
    const installation = agent.validateInstallationSync();
    if (!installation.installed) {
      const details = installation.errors && installation.errors.length > 0
        ? ` ${installation.errors.join('; ')}`
        : '';
      return createSkippedResult(request.repoPath, `Auto review skipped: Copilot CLI is not installed.${details}`);
    }
  }
  const routedRequest = {
    ...request,
    model: resolveRequestModel(config, agentName, request)
  };
  return agent.runTask(routedRequest);
}

module.exports = {
  REGISTRY,
  createAgent,
  selectAgentForTask,
  resolveModelForTask,
  runTask
};
