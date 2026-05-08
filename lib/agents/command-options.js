// @ts-check

const { selectAgentForTask, resolveModelForTask } = require('.');
const { validateAndWarnModelOnce } = require('../model-catalog');

/**
 * Apply command-line agent/model overrides without rewriting persisted config
 * semantics. `modelOverride` is a run-scoped override consumed by AgentRunner.
 *
 * @param {import('../types').Config} config
 * @param {{ agent?: string, model?: string }} [options]
 * @returns {import('../types').Config}
 */
function applyAgentCommandOptions(config, options = {}) {
  if (options.agent) config.agent = options.agent;
  if (options.model) config.modelOverride = options.model;
  return config;
}

/**
 * @param {import('../types').Config} config
 * @param {import('../types').TaskRequest['taskType']} taskType
 * @returns {{ agentName: string, model: string }}
 */
function resolveAgentCommandSelection(config, taskType) {
  return {
    agentName: selectAgentForTask(config, taskType),
    model: resolveModelForTask(config, taskType)
  };
}

/**
 * @param {import('../types').Config} config
 * @param {import('../types').TaskRequest['taskType']} taskType
 * @returns {{ agentName: string, model: string }}
 */
function validateTaskModel(config, taskType) {
  const selection = resolveAgentCommandSelection(config, taskType);
  validateAndWarnModelOnce(selection.model, selection.agentName);
  return selection;
}

module.exports = {
  applyAgentCommandOptions,
  resolveAgentCommandSelection,
  validateTaskModel
};
