// @ts-check

/**
 * Build an agent subprocess environment without mutating process.env.
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
  return env;
}

module.exports = {
  buildAgentEnv
};
