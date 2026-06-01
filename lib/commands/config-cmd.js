// @ts-check
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

// Keys whose values must be coerced from CLI strings to booleans.
// Pre-existing booleans (knowledgeBaseEnabled, knowledgeBaseAutoUpdate) are
// not yet handled here — that's a long-standing CLI gap. New booleans added
// after SKILLS_ENHANCEMENT_PLAN §C2 use this list so `ai-issue config set X true`
// produces a real boolean and round-trips through validateConfig().
const BOOLEAN_KEYS = new Set([
  'skillsMetricsEnabled',
  'verifyLoop.enabled'
]);

const NUMBER_KEYS = new Set([
  'verifyLoop.maxAttempts',
  'verifyLoop.phaseATimeoutSec',
  'verifyLoop.phaseBTimeoutSec'
]);

const STRING_ARRAY_KEYS = new Set([
  'verifyLoop.skipGates'
]);

const VERIFY_LOOP_KEYS = new Set([
  'enabled',
  'maxAttempts',
  'phaseATimeoutSec',
  'phaseBTimeoutSec',
  'parallelism',
  'skipGates'
]);

// Keys whose values must come from a fixed enum.
const ENUM_VALUES = {
  updateChannel: ['auto', 'tag', 'branch'],
  agent: SUPPORTED_AGENTS,
  rubberDuckAgent: SUPPORTED_AGENTS,
  // TUI proposal §4.2 v1.1 N8: reuse the existing v3.4 ENUM_VALUES framework
  // by appending one row. Source of truth is lib/ui/config-keys.js.
  uiMode: require('../ui/config-keys').UI_MODE_VALUES
};

/**
 * @param {string} key
 * @returns {string|null}
 */
function getAgentModelKeyAgent(key) {
  const match = /^agents\.([^.]+)\.model$/.exec(key);
  return match ? match[1] : null;
}

/**
 * @param {string} key
 * @returns {string|null}
 */
function getVerifyLoopKey(key) {
  const match = /^verifyLoop\.([^.]+)$/.exec(key);
  return match ? match[1] : null;
}

/**
 * @param {string} value
 * @returns {string[]}
 */
function parseStringArray(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return [];
  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.some(v => typeof v !== 'string' || !v.trim())) {
      throw new Error('array must contain only non-empty strings');
    }
    return parsed.map(v => v.trim());
  }
  return trimmed.split(',').map(v => v.trim()).filter(Boolean);
}

function validateConfigSet(key, value) {
  if (key === 'verifyLoop') {
    throw new Error('Use verifyLoop.<key> (for example verifyLoop.enabled) instead of setting verifyLoop directly');
  }

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

  const verifyLoopKey = getVerifyLoopKey(key);
  if (verifyLoopKey) {
    if (!VERIFY_LOOP_KEYS.has(verifyLoopKey)) {
      throw new Error(`Unknown verifyLoop key "${verifyLoopKey}". Allowed: ${Array.from(VERIFY_LOOP_KEYS).join(', ')}`);
    }
    if (BOOLEAN_KEYS.has(key)) {
      if (value !== 'true' && value !== 'false') {
        throw new Error(`${key} must be "true" or "false" (got "${value}")`);
      }
      return;
    }
    if (NUMBER_KEYS.has(key)) {
      const numberValue = Number(value);
      if (!Number.isInteger(numberValue) || numberValue <= 0) {
        throw new Error(`${key} must be a positive integer (got "${value}")`);
      }
      return;
    }
    if (key === 'verifyLoop.parallelism') {
      const numberValue = Number(value);
      if (value !== 'auto' && (!Number.isInteger(numberValue) || numberValue <= 0)) {
        throw new Error(`${key} must be "auto" or a positive integer (got "${value}")`);
      }
      return;
    }
    if (STRING_ARRAY_KEYS.has(key)) {
      try {
        parseStringArray(value);
      } catch (err) {
        throw new Error(`${key} ${err.message}`);
      }
      return;
    }
  }

  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    throw new Error(
      `Unknown config key "${key}". Allowed keys: ${ALLOWED_CONFIG_KEYS.join(', ')}, agents.<agent>.model, verifyLoop.<key>`
    );
  }
  if (BOOLEAN_KEYS.has(key)) {
    if (value !== 'true' && value !== 'false') {
      throw new Error(
        `${key} must be "true" or "false" (got "${value}")`
      );
    }
    return;
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
  // Coerce CLI string to native type for known boolean keys.
  /** @type {string | boolean | number | string[]} */
  let storedValue = value;
  if (BOOLEAN_KEYS.has(key)) {
    storedValue = value === 'true';
  } else if (NUMBER_KEYS.has(key)) {
    storedValue = Number(value);
  } else if (key === 'verifyLoop.parallelism') {
    storedValue = value === 'auto' ? 'auto' : Number(value);
  } else if (STRING_ARRAY_KEYS.has(key)) {
    storedValue = parseStringArray(value);
  }
  const parts = key.split('.');
  let current = config;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  }
  current[parts[parts.length - 1]] = storedValue;
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
  ENUM_VALUES,
  BOOLEAN_KEYS
};
