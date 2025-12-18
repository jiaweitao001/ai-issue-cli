/**
 * Check command implementation
 */

const { loadConfig } = require('../config');
const { log, error, success, colors } = require('../logger');
const { checkEnvironment } = require('../environment');

// Command: check
function cmdCheck() {
  const config = loadConfig();
  
  log('');
  log('🔍 Environment Check', colors.cyan);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('');
  
  const checks = checkEnvironment(config);
  let allOk = true;
  
  checks.forEach((check, index) => {
    const prefix = check.status ? '✅' : '❌';
    const color = check.status ? colors.green : colors.red;
    log(`${index + 1}. ${prefix} ${check.name}`, color);
    if (!check.status && check.help) {
      log(`   💡 ${check.help}`, colors.yellow);
    }
    allOk = allOk && check.status;
  });
  
  log('');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', allOk ? colors.green : colors.red);
  
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
