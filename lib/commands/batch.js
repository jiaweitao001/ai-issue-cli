// @ts-check
/**
 * Batch command implementation
 */

const fs = require('fs');
const path = require('path');
const { log, error, success, info, chalk, debug } = require('../logger');
const { loadConfig } = require('../config');
const { cmdSolve } = require('./solve');
const { enableDebugIfRequested } = require('../utils');
const { applyAgentCommandOptions, validateTaskModel } = require('../agents/command-options');
const { validateConfiguredAgents } = require('../agents/installation-validator');

const SEPARATOR = '='.repeat(80);
const THIN_SEPARATOR = '-'.repeat(80);

/**
 * Simple batch log writer that wraps a log file path.
 * All writes go through a single append method to eliminate repetition.
 */
class BatchLogger {
  constructor(filePath) {
    this.filePath = filePath;
  }

  /** Append one or more lines to the batch log file. */
  append(...lines) {
    fs.appendFileSync(this.filePath, lines.join('\n') + '\n');
  }

  /** Write the file header at the start of a batch run. */
  writeHeader(issues, concurrency) {
    fs.writeFileSync(this.filePath, `Batch Processing Log - ${new Date().toISOString()}\n`);
    this.append(
      `Issues: ${issues.join(', ')}`,
      `Concurrency: ${concurrency}`,
      `${SEPARATOR}\n`
    );
  }

  /** Write an issue start block. */
  writeIssueStart(issue, index, total, options) {
    this.append(
      `\n${SEPARATOR}`,
      `ISSUE #${issue} [${index}/${total}]`,
      SEPARATOR,
      `Started at: ${new Date().toISOString()}`,
      `Options: ${JSON.stringify(options)}`,
      THIN_SEPARATOR
    );
  }

  /** Write an issue completion (success or failure). */
  writeIssueResult(duration, succeeded) {
    this.append(
      THIN_SEPARATOR,
      `Completed at: ${new Date().toISOString()}`,
      `Duration: ${duration}s`,
      `Status: ${succeeded ? '✅ SUCCESS' : '❌ FAILED'}`
    );
  }

  /** Write failure details (error message, stack, generated files). */
  writeFailureDetails(err, config, issue) {
    this.append(`\nError Message:\n${err.message}`);
    if (err.stack) {
      this.append(`\nStack Trace:\n${err.stack}`);
    }
    const researchFile = path.join(config.reportPath, `issue-${issue}-research.md`);
    const analysisFile = path.join(config.reportPath, `issue-${issue}-analysis-and-solution.md`);
    this.append(
      '\nGenerated Files:',
      `  Research: ${fs.existsSync(researchFile) ? '✅ EXISTS' : '❌ MISSING'} (${researchFile})`,
      `  Analysis: ${fs.existsSync(analysisFile) ? '✅ EXISTS' : '❌ MISSING'} (${analysisFile})`
    );
  }

  /** Write the final summary block. */
  writeSummary(total, successCount, failedCount) {
    this.append(
      `\n${SEPARATOR}`,
      '\nBatch Processing Summary',
      `Total: ${total}`,
      `Success: ${successCount}`,
      `Failed: ${failedCount}`,
      `Completed at: ${new Date().toISOString()}`
    );
  }
}

// Command: batch
async function cmdBatch(issues, options) {
  const config = loadConfig();
  applyAgentCommandOptions(config, options);
  try { validateTaskModel(config, 'research'); } catch (_) {}
  validateConfiguredAgents(config, { taskType: 'research' });

  enableDebugIfRequested(options);
  if (options.debug) {
    debug('Debug mode enabled for batch processing');
    debug(`Processing ${issues.length} issues with concurrency ${options.concurrency || 3}`);
  }

  const concurrency = options.concurrency || 3;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const logDir = path.join(config.reportPath, 'logs');
  const batchLogFile = path.join(logDir, `batch-${timestamp}.log`);

  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const batchLog = new BatchLogger(batchLogFile);
  batchLog.writeHeader(issues, concurrency);

  log('');
  log(chalk.bold.cyan('📦 Batch Processing Mode (Parallel)'));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  info(`Total ${issues.length} Issues to process (${concurrency} concurrent)`);
  info(`Log file: ${batchLogFile}`);
  log('');

  const results = {
    success: [],
    failed: [],
    processing: new Set(),
    completed: 0
  };

  async function processIssue(issue) {
    results.processing.add(issue);
    const startTime = Date.now();
    const issueIndex = issues.indexOf(issue) + 1;

    batchLog.writeIssueStart(issue, issueIndex, issues.length, options);

    try {
      log('');
      log(chalk.bold.cyan(`[${issueIndex}/${issues.length}] 🚀 Starting Issue #${issue}`));

      await cmdSolve(issue, { ...options, skipHeader: true, quiet: true, silent: true });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      results.success.push(issue);
      success(`[${issueIndex}/${issues.length}] Issue #${issue} ✅ completed in ${duration}s`);
      batchLog.writeIssueResult(duration, true);

    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      error(`[${issueIndex}/${issues.length}] Issue #${issue} ❌ failed after ${duration}s`);
      error(`  Error: ${err.message}`);
      results.failed.push({ issue, error: err.message, stack: err.stack, duration });

      batchLog.writeIssueResult(duration, false);
      batchLog.writeFailureDetails(err, config, issue);

    } finally {
      results.processing.delete(issue);
      results.completed++;

      const activeIssues = Array.from(results.processing).join(', #');
      if (results.processing.size > 0) {
        info(`Progress: ${results.completed}/${issues.length} | Active: #${activeIssues}`);
      }
    }
  }

  // Process issues with concurrency limit
  const queue = [...issues];
  const activePromises = new Set();

  while (queue.length > 0 || activePromises.size > 0) {
    while (queue.length > 0 && activePromises.size < concurrency) {
      const issue = queue.shift();
      const promise = processIssue(issue).finally(() => {
        activePromises.delete(promise);
      });
      activePromises.add(promise);
    }

    if (activePromises.size > 0) {
      await Promise.race(activePromises).catch(() => {});
      await Promise.resolve();
    }
  }

  // Final summary
  batchLog.writeSummary(issues.length, results.success.length, results.failed.length);

  log('');
  log(chalk.bold.grey('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log(chalk.bold.cyan('📊 Batch Processing Statistics'));
  log(chalk.bold.grey('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');
  log(`Total: ${issues.length}`);
  success(`Success: ${results.success.length}`);
  if (results.failed.length > 0) {
    error(`Failed: ${results.failed.length}`);
  } else {
    log(`Failed: ${results.failed.length}`);
  }
  log(`Concurrency: ${concurrency}`);

  if (results.failed.length > 0) {
    log('');
    error('Failed Issues:');
    results.failed.forEach(item => {
      log(chalk.red(`   - #${item.issue}: ${item.error}`));
    });
    log('');
    info(`Detailed error logs: ${batchLogFile}`);
  }

  if (results.success.length > 0) {
    log('');
    success('Successful Issues:');
    results.success.forEach(issue => log(chalk.green(`   - #${issue}`)));
  }

  log('');
}

module.exports = {
  cmdBatch
};
