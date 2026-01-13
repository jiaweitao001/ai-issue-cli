/**
 * Logger utilities
 */

const chalk = require('chalk');

function log(message) {
  console.log(message);
}

function error(message) {
  console.error(chalk.red(`❌ ${message}`));
}

function success(message) {
  console.log(chalk.green(`✅ ${message}`));
}

function info(message) {
  console.log(chalk.blue(`ℹ️  ${message}`));
}

function warning(message) {
  console.log(chalk.yellow(`⚠️  ${message}`));
}

function highlight(message) {
  return chalk.bold.cyan(message);
}

module.exports = {
  log,
  error,
  success,
  info,
  warning,
  highlight,
  chalk
};
