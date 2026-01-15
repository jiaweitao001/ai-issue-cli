#!/usr/bin/env node
/**
 * AI Issue CLI - Automated Issue Resolution and Evaluation Tool
 * Based on GitHub Copilot CLI
 * Main entry point
 */

const { program } = require('commander');
const { VERSION, loadConfig, isConfigured, validateConfig, CONFIG_FILE } = require('./lib/config');
const { info, error, chalk } = require('./lib/logger');
const fs = require('fs');
const { cmdSolve } = require('./lib/commands/solve');
const { cmdEvaluate } = require('./lib/commands/evaluate');
const { cmdBatch } = require('./lib/commands/batch');
const { cmdConfig } = require('./lib/commands/config-cmd');
const { cmdCheck } = require('./lib/commands/check');
const { cmdInit } = require('./lib/commands/init');

// Basic metadata
program
  .name('ai-issue')
  .description('AI-powered automated Issue resolution and evaluation tool')
  .version(VERSION);

// Global options
program
  .option('-m, --model <model>', 'Specify AI model')
  .option('--no-eval', 'Skip evaluation phase after solving')
  .option('--concurrency <number>', 'Parallel instances for batch processing', '3')
  .option('--debug', 'Enable debug logging');

// Check configuration for relevant commands
function ensureConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    error('Configuration file not found.');
    error('Please run: ai-issue init');
    process.exit(1);
  }
  
  const config = loadConfig();
  const { valid, errors } = validateConfig(config);
  
  if (!valid) {
    error('Configuration validation failed:');
    errors.forEach(err => error(`  - ${err}`));
    info('\nFix with: ai-issue config set <key> <value>');
    info('Example: ai-issue config set repoPath /path/to/repo');
    process.exit(1);
  }
}

// Command: init
program
  .command('init')
  .description('Initialize configuration and directories')
  .action(async () => {
    await cmdInit();
  });

// Command: solve
program
  .command('solve <issue_number>')
  .description('Solve specified Issue (2-phase: research + solution)')
  .action(async (issueNumber) => {
    ensureConfig();
    const options = program.opts();
    await cmdSolve(issueNumber, {
      ...options,
      concurrency: parseInt(options.concurrency)
    });
  });

// Command: evaluate
program
  .command('evaluate <issue_number>')
  .alias('eval')
  .description('Evaluate solved Issue')
  .action(async (issueNumber) => {
    ensureConfig();
    await cmdEvaluate(issueNumber, program.opts());
  });

// Command: batch
program
  .command('batch <issues...>')
  .description('Batch process multiple Issues')
  .action(async (issues) => {
    ensureConfig();
    const options = program.opts();
    await cmdBatch(issues, {
      ...options,
      concurrency: parseInt(options.concurrency)
    });
  });

// Command: config
program
  .command('config [action] [key] [value]')
  .description('Manage configuration (actions: show, set, get, reset)')
  .action((action, key, value) => {
    cmdConfig(action || 'show', key, value);
  });

// Command: check
program
  .command('check')
  .description('Check environment configuration')
  .action(() => {
    cmdCheck();
  });

// Error handling
program.on('command:*', () => {
  error(`Invalid command: ${program.args.join(' ')}\nSee --help for a list of available commands.`);
  process.exit(1);
});

// Run
async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    if (program.opts().debug && err.stack) {
      console.error(chalk.grey(err.stack));
    }
    process.exit(1);
  }
}

main();
