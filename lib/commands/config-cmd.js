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

// Keys whose values must come from a fixed enum.
const ENUM_VALUES = {
  updateChannel: ['auto', 'tag', 'branch']
};

function validateConfigSet(key, value) {
  if (!ALLOWED_CONFIG_KEYS.includes(key)) {
    throw new Error(
      `Unknown config key "${key}". Allowed keys: ${ALLOWED_CONFIG_KEYS.join(', ')}`
    );
  }
  const allowedValues = ENUM_VALUES[key];
  if (allowedValues && !allowedValues.includes(value)) {
    throw new Error(
      `Invalid ${key} "${value}". Allowed: ${allowedValues.join(', ')}`
    );
  }
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
      log(`${k}: ${v}`);
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
    config[key] = value;
    saveConfig(config);
    if (key === 'model') {
      try { require('../model-catalog').validateAndWarnModelOnce(value); } catch (_) {}
    }

  } else if (action === 'get') {
    if (!key) {
      error('Usage: ai-issue config get <key>');
      process.exit(1);
    }
    log(config[key] || '');

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
  ALLOWED_CONFIG_KEYS,
  ENUM_VALUES
};
