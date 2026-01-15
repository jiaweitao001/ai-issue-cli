/**
 * Check command implementation
 */

const { loadConfig, validateConfig } = require('../config');
const { log, error, success, warning, chalk } = require('../logger');
const { checkEnvironment } = require('../environment');

// Command: check
function cmdCheck() {
  const config = loadConfig();

  log('');
  log(chalk.bold.cyan('🔍 Environment Check'));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  let allOk = true;

  // First check configuration validation
  const { valid, errors: configErrors } = validateConfig(config);
  if (!valid) {
    error('0. ❌ Configuration Validation');
    configErrors.forEach(err => warning(`   💡 ${err}`));
    allOk = false;
  } else {
    success('0. ✅ Configuration Validation');
  }

  const checks = checkEnvironment(config);

  checks.forEach((check, index) => {
    const prefix = check.status ? '✅' : '❌';
    if (check.status) {
      success(`${index + 1}. ${prefix} ${check.name}`);
    } else {
      error(`${index + 1}. ${prefix} ${check.name}`);
    }

    if (!check.status && check.help) {
      warning(`   💡 ${check.help}`);
    }
    allOk = allOk && check.status;
  });

  log('');
  log(chalk.grey('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));

  if (allOk) {
    success('All checks passed!');
  } else {
    error('Some checks failed, please fix the above issues');
    process.exit(1);
  }

  log('');
}

module.exports = {
  cmdCheck
};
