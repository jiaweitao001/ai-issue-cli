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
const { cmdValidate } = require('./lib/commands/validate');
const { cmdTriage } = require('./lib/commands/triage');
const { cmdWatch } = require('./lib/commands/watch');
const { cmdPipeline } = require('./lib/commands/pipeline');
const { cmdRegister } = require('./lib/commands/register');
const { cmdMetrics } = require('./lib/commands/metrics');
const { cmdSearch } = require('./lib/commands/search-cmd');

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
  .option('--branch', 'Create a git branch fix/issue-<N> before solving')
  .option('--push-fork', 'Push branch to fork remote after solving')
  .option('--force', 'Override triage SKIP/NEEDS_HUMAN recommendation')
  .action(async (issueNumber, cmdOpts) => {
    ensureConfig();
    const options = { ...program.opts(), ...cmdOpts };
    await cmdSolve(issueNumber, {
      ...options,
      concurrency: parseInt(options.concurrency || '3')
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

// Command: validate
program
  .command('validate [target]')
  .description('Validate report format (target: issue number or file path)')
  .option('--no-warnings', 'Hide warnings, show only errors')
  .action(async (target, options) => {
    const result = await cmdValidate(target, { showWarnings: options.warnings });
    if (!result.allValid) {
      process.exit(1);
    }
  });

// Command: triage
program
  .command('triage <issue_number>')
  .description('View or trigger triage for an issue via ai-issue-service')
  .action(async (issueNumber) => {
    await cmdTriage(issueNumber, program.opts());
  });

// Command: pipeline
program
  .command('pipeline')
  .description('View issue pipeline status from ai-issue-service')
  .option('--owner <owner>', 'Filter by assigned owner')
  .option('--status <status>', 'Filter by status (triaged, queued, solving, solved, failed)')
  .option('--limit <number>', 'Max entries to return', '20')
  .action(async (cmdOpts) => {
    const options = { ...program.opts(), ...cmdOpts };
    await cmdPipeline({
      ...options,
      limit: parseInt(options.limit || '20'),
    });
  });

// Command: register
program
  .command('register')
  .description('Register your GitHub PAT with ai-issue-service for PR creation')
  .requiredOption('--pat <token>', 'GitHub Personal Access Token (scope: repo)')
  .option('--owner <owner>', 'Your owner identifier (defaults to $USER)')
  .option('--trello-member-id <id>', 'Your Trello member ID (optional)')
  .action(async (cmdOpts) => {
    const options = { ...program.opts(), ...cmdOpts };
    await cmdRegister(options);
  });

// Command: metrics
program
  .command('metrics')
  .description('View team metrics (response time, solve rate, etc.)')
  .option('--owner <name>', 'Filter by engineer')
  .option('--since <period>', 'Start of time range (e.g. 7d, 30d, 2026-01-01)', '30d')
  .option('--until <date>', 'End of time range')
  .action(async (cmdOpts) => {
    const options = { ...program.opts(), ...cmdOpts };
    await cmdMetrics(options);
  });

// Command: search
program
  .command('search <query>')
  .description('Search issues and solutions')
  .option('--owner <name>', 'Filter by engineer')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results', '20')
  .action(async (query, cmdOpts) => {
    const options = { ...program.opts(), ...cmdOpts };
    await cmdSearch(query, {
      ...options,
      limit: parseInt(options.limit || '20'),
    });
  });

// Command: watch
program
  .command('watch')
  .description('Watch daemon: auto-solve queued issues assigned to you')
  .requiredOption('--owner <owner>', 'Your owner identifier (as configured in resource_owners)')
  .option('--interval <seconds>', 'Poll interval in seconds', '300')
  .option('--push-fork', 'Push branches to fork remote after solving')
  .action(async (cmdOpts) => {
    const options = { ...program.opts(), ...cmdOpts };
    await cmdWatch({
      ...options,
      interval: parseInt(options.interval || '300'),
    });
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
