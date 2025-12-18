/**
 * Help text
 */

const { log, colors } = require('./logger');

// Show help
function showHelp() {
  log('');
  log('🤖 AI Issue CLI - Automated Issue Resolution and Evaluation Tool', colors.cyan);
  log('   Two-Phase Approach: Research → Solution', colors.cyan);
  log('');
  log('Usage: ai-issue <command> [options]', colors.bright);
  log('');
  log('Commands:', colors.bright);
  log('  solve <number>          Solve specified Issue (2-phase: research + solution)');
  log('  evaluate <number>       Evaluate solved Issue');
  log('  batch <numbers...>      Batch process multiple Issues');
  log('  config <action>         Manage configuration');
  log('  check                   Check environment configuration');
  log('  version                 Show version information');
  log('  help                    Show this help message');
  log('');
  log('Options:', colors.bright);
  log('  --no-eval               Only solve Issue, do not evaluate');
  log('  --model <model>         Specify AI model (gpt-5 or claude-sonnet-4.5)');
  log('  --concurrency <number>  Parallel instances for batch (default: 3)');
  log('');
  log('Two-Phase Process:', colors.bright);
  log('  Phase 1: Deep Research  - Find similar implementations, SDK tools, code history');
  log('  Phase 2: Solution       - Design and implement based on research findings');
  log('');
  log('Examples:', colors.bright);
  log('  ai-issue solve 30340');
  log('  ai-issue solve 30340 --no-eval');
  log('  ai-issue evaluate 30340');
  log('  ai-issue batch 30340 31316 31500');
  log('  ai-issue batch 30340 31316 31500 --concurrency 5');
  log('  ai-issue config show');
  log('  ai-issue config set model gpt-5');
  log('  ai-issue check');
  log('');
  log('Configuration:', colors.bright);
  log('  Config file: ~/.ai-issue/config.json');
  log('  Environment variables:');
  log('    AI_ISSUE_REPO_PATH      Repository path');
  log('    AI_ISSUE_REPORT_PATH    Report path');
  log('    AI_ISSUE_MODEL          AI model');
  log('    AI_ISSUE_LOG_LEVEL      Log level');
  log('');
}

module.exports = {
  showHelp
};
