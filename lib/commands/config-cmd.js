/**
 * Config command implementation
 */

const { loadConfig, saveConfig, DEFAULT_CONFIG, CONFIG_FILE } = require('../config');
const { log, error, success, info, chalk } = require('../logger');

// Per UPDATE_COMMAND_PROPOSAL.md §4.7 (v3.4):
// The `set` handler must validate the *key* before the *value*, otherwise
// typos like `config set updateChnnel branch` are silently accepted and
// downstream commands keep using defaults.
//
// ALLOWED_CONFIG_KEYS is derived from DEFAULT_CONFIG so any field added there
// is automatically settable. Adding a new key without a default makes it un-settable
// on purpose - defaults document the schema.
const ALLOWED_CONFIG_KEYS = Object.keys(DEFAULT_CONFIG);
const SUPPORTED_AGENTS = ['copilot', 'claude-code'];

// Keys whose values must come from a fixed enum.
const ENUM_VALUES = {
  updateChannel: ['auto', 'tag', 'branch'],
  agent: SUPPORTED_AGENTS,
  rubberDuckAgent: SUPPORTED_AGENTS
};

/**
 * @param {string} key
 * @returns {string|null}
 */
function getAgentModelKeyAgent(key) {
  const match = /^agents\.([^.]+)\.model$/.exec(key);
  return match ? match[1] : null;
}

function validateConfigSet(key, value) {
  const agentName = getAgentModelKeyAgent(key);
  if (agentName) {
    if (!SUPPORTED_AGENTS.includes(agentName)) {
      throw new Error(`Unknown agent "${agentName}". Allowed agents: ${SUPPORTED_AGENTS.join(', ')}`);
    }
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error(`${key} must be a non-empty string`);
    }
    return;
  }

  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    throw new Error(
      `Unknown config key "${key}". Allowed keys: ${ALLOWED_CONFIG_KEYS.join(', ')}, agents.<agent>.model`
    );
  }
  const allowedValues = ENUM_VALUES[key];
  if (allowedValues && !allowedValues.includes(value)) {
    throw new Error(
      `Invalid ${key} "${value}". Allowed: ${allowedValues.join(', ')}`
    );
  }
}

/**
 * @param {object} config
 * @param {string} key
 * @returns {any}
 */
function getConfigValue(config, key) {
  return key.split('.').reduce((current, part) => {
    if (current === undefined || current === null) return undefined;
    return current[part];
  }, config);
}

/**
 * @param {object} config
 * @param {string} key
 * @param {string} value
 */
function setConfigValue(config, key, value) {
  const parts = key.split('.');
  let current = config;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = value;
}

/**
 * @param {any} value
 * @returns {string}
 */
function formatConfigValue(value) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// Command: config
function cmdConfig(action, key, value) {
  const config = loadConfig();

  if (action === 'show') {
    log('');
    log(chalk.bold.cyan('⚙️  Current Configuration'));
    log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    log('');
    Object.entries(config).forEach(([k, v]) => {
      log(`${k}: ${formatConfigValue(v)}`);
    });
    log('');
    info(`Config file: ${CONFIG_FILE}`);
    log('');

  } else if (action === 'set') {
    if (!key || value === undefined) {
      error('Usage: ai-issue config set <key> <value>');
      process.exit(1);
    }
    try {
      validateConfigSet(key, value);
    } catch (e) {
      error(e.message);
      process.exit(2);
    }
    setConfigValue(config, key, value);
    saveConfig(config);
    const agentName = getAgentModelKeyAgent(key);
    if (key === 'model' || agentName) {
      try { require('../model-catalog').validateAndWarnModelOnce(value, agentName || 'copilot'); } catch (_) {}
    }

  } else if (action === 'get') {
    if (!key) {
      error('Usage: ai-issue config get <key>');
      process.exit(1);
    }
    log(formatConfigValue(getConfigValue(config, key)));

  } else if (action === 'reset') {
    saveConfig(DEFAULT_CONFIG);
    success('Configuration reset to default values');

  } else {
    error(`Unknown action: ${action}`);
    error('Available actions: show, set, get, reset');
    process.exit(1);
  }
}

module.exports = {
  cmdConfig,
  validateConfigSet,
  getConfigValue,
  setConfigValue,
  ALLOWED_CONFIG_KEYS,
  ENUM_VALUES
};
