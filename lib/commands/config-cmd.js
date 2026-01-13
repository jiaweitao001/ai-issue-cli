/**
 * Config command implementation
 */

const { loadConfig, saveConfig, DEFAULT_CONFIG, CONFIG_FILE } = require('../config');
const { log, error, success, info, chalk } = require('../logger');

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
    config[key] = value;
    saveConfig(config);

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
  cmdConfig
};
