// @ts-check

const fs = require('fs');
const path = require('path');
const { expandHome } = require('../config');
const { rotateIfNeeded } = require('./metrics-rotation');

const SKILLS_METRICS_ENV_VAR = 'AI_ISSUE_SKILLS_METRICS_PATH';

/**
 * Build an agent subprocess environment without mutating process.env.
 *
 * Pure function. Side effects (mkdir, rotation) live in
 * `prepareSkillsMetrics(config)`, which the agent runtime calls explicitly
 * before spawning.
 *
 * @param {import('../types').Config} config
 * @param {NodeJS.ProcessEnv} [baseEnv]
 * @returns {NodeJS.ProcessEnv}
 */
function buildAgentEnv(config, baseEnv = process.env) {
  const env = { ...baseEnv };
  if (config.serviceUrl && !env.AI_ISSUE_SERVICE_URL) {
    env.AI_ISSUE_SERVICE_URL = config.serviceUrl;
  }
  if (config.serviceApiKey && !env.AI_ISSUE_SERVICE_API_KEY) {
    env.AI_ISSUE_SERVICE_API_KEY = config.serviceApiKey;
  }
  if (config.knowledgeBasePath && !env.AI_ISSUE_KB_PATH) {
    env.AI_ISSUE_KB_PATH = expandHome(config.knowledgeBasePath);
  }
  if (config.skillsMetricsEnabled && !env[SKILLS_METRICS_ENV_VAR]) {
    const target = expandHome(config.skillsMetricsPath || '');
    if (target) {
      env[SKILLS_METRICS_ENV_VAR] = target;
    }
  }
  return env;
}

/**
 * Side-effecting prep: ensure parent directory exists and rotate the active
 * metrics file if it exceeds the configured cap. Called by the agent runtime
 * once per agent.runTask before spawning the subprocess.
 *
 * Best-effort: any I/O error is swallowed so a metrics misconfiguration can
 * never block an agent run.
 *
 * @param {import('../types').Config} config
 */
function prepareSkillsMetrics(config) {
  if (!config || !config.skillsMetricsEnabled) return;
  const target = expandHome(config.skillsMetricsPath || '');
  if (!target) return;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
  } catch (_e) {
    return; // can't create dir → can't rotate either
  }
  try {
    rotateIfNeeded(target);
  } catch (_e) {
    // swallow — rotateIfNeeded is itself best-effort
  }
}

module.exports = {
  buildAgentEnv,
  prepareSkillsMetrics,
  SKILLS_METRICS_ENV_VAR
};
