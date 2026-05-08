// @ts-check

const { createAgent, selectAgentForTask } = require('.');

/**
 * @param {import('../types').Config} config
 * @param {string} agentName
 * @returns {void}
 */
function validateAgentInstalled(config, agentName) {
  const agent = createAgent({ ...config, agent: agentName });
  if (!agent || typeof agent.validateInstallationSync !== 'function') return;

  const result = agent.validateInstallationSync();
  if (result.installed) return;

  const label = agent.displayName || agent.name || agentName;
  const details = result.errors && result.errors.length > 0
    ? ` ${result.errors.join('; ')}`
    : '';
  throw new Error(`${label} is not installed.${details}`);
}

/**
 * Validate CLI installation for the agent that will handle the command and,
 * when configured, the independent rubber-duck agent.
 *
 * @param {import('../types').Config} config
 * @param {{ taskType?: import('../types').TaskRequest['taskType'], includeRubberDuck?: boolean }} [options]
 * @returns {void}
 */
function validateConfiguredAgents(config, options = {}) {
  const taskType = options.taskType || 'research';
  const includeRubberDuck = options.includeRubberDuck !== false;
  const agentNames = new Set([selectAgentForTask(config, taskType)]);

  if (includeRubberDuck && config.rubberDuckAgent) {
    agentNames.add(config.rubberDuckAgent);
  }

  for (const agentName of agentNames) {
    validateAgentInstalled(config, agentName);
  }
}

module.exports = {
  validateAgentInstalled,
  validateConfiguredAgents
};
