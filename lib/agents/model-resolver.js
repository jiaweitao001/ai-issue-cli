// @ts-check

const DEFAULT_MODELS = {
  copilot: 'claude-sonnet-4.5',
  'claude-code': 'sonnet'
};

/**
 * @param {string} agentName
 * @returns {string}
 */
function getAgentDefaultModel(agentName) {
  const model = DEFAULT_MODELS[agentName];
  if (!model) {
    throw new Error(`Unknown agent for model resolution: ${agentName}`);
  }
  return model;
}

/**
 * Resolve the model for an agent. explicitOverride represents a command-line
 * --model override and applies to the selected agent for the current run.
 *
 * @param {import('../types').Config} config
 * @param {string} agentName
 * @param {string} [explicitOverride]
 * @returns {string}
 */
function resolveModelForAgent(config, agentName, explicitOverride) {
  if (explicitOverride) return explicitOverride;

  const perAgent = config.agents && config.agents[agentName] && config.agents[agentName].model;
  if (perAgent) return perAgent;

  if (agentName === 'copilot' && config.model) return config.model;

  return getAgentDefaultModel(agentName);
}

module.exports = {
  DEFAULT_MODELS,
  getAgentDefaultModel,
  resolveModelForAgent
};
