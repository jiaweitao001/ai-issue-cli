#!/usr/bin/env node
/**
 * AI Issue CLI - Automated Issue Resolution and Evaluation Tool
 * Based on GitHub Copilot CLI
 * Main entry point
 */

const { VERSION, loadConfig } = require('./lib/config');
const { log, error } = require('./lib/logger');
const { cmdSolve } = require('./lib/commands/solve');
const { cmdEvaluate } = require('./lib/commands/evaluate');
const { cmdBatch } = require('./lib/commands/batch');
const { cmdConfig } = require('./lib/commands/config-cmd');
const { cmdCheck } = require('./lib/commands/check');
const { showHelp } = require('./lib/help');

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }
  
  const command = args[0];
  const options = {
    noEval: args.includes('--no-eval'),
    model: args.includes('--model') ? args[args.indexOf('--model') + 1] : null,
    concurrency: args.includes('--concurrency') ? parseInt(args[args.indexOf('--concurrency') + 1]) : 3
  };
  
  // Update config if model is specified
  if (options.model) {
    const config = loadConfig();
    config.model = options.model;
  }
  
  try {
    switch (command) {
      case 'solve':
        if (args.length < 2) {
          error('Usage: ai-issue solve <issue_number>');
          process.exit(1);
        }
        await cmdSolve(args[1], options);
        break;
        
      case 'evaluate':
      case 'eval':
        if (args.length < 2) {
          error('Usage: ai-issue evaluate <issue_number>');
          process.exit(1);
        }
        await cmdEvaluate(args[1], options);
        break;
        
      case 'batch':
        if (args.length < 2) {
          error('Usage: ai-issue batch <issue1> [issue2] [issue3] ...');
          process.exit(1);
        }
        // Filter out options and their values
        const issues = args.slice(1).filter((arg, index, arr) => {
          // Skip if starts with --
          if (arg.startsWith('--')) return false;
          // Skip if previous arg was an option flag (like --model, --concurrency)
          if (index > 0 && arr[index - 1].startsWith('--')) return false;
          return true;
        });
        await cmdBatch(issues, options);
        break;
        
      case 'config':
        if (args.length < 2) {
          cmdConfig('show');
        } else {
          cmdConfig(args[1], args[2], args[3]);
        }
        break;
        
      case 'check':
        cmdCheck();
        break;
        
      case 'version':
      case '--version':
      case '-v':
        log(`ai-issue v${VERSION}`);
        break;
        
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;
        
      default:
        error(`Unknown command: ${command}`);
        log('Run "ai-issue help" to see available commands');
        process.exit(1);
    }
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    if (err.stack && process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  main().catch(err => {
    error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
