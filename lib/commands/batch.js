/**
 * Batch command implementation
 */

const fs = require('fs');
const path = require('path');
const { log, error, success, info, chalk } = require('../logger');
const { loadConfig } = require('../config');
const { cmdSolve } = require('./solve');

// Command: batch
async function cmdBatch(issues, options) {
  const config = loadConfig();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
  const logDir = path.join(config.reportPath, 'logs');
  const batchLogFile = path.join(logDir, `batch-${timestamp}.log`);

  // Create log directory
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  // Initialize batch log
  fs.writeFileSync(batchLogFile, `Batch Processing Log - ${new Date().toISOString()}\n`);
  fs.appendFileSync(batchLogFile, `Issues: ${issues.join(', ')}\n`);
  fs.appendFileSync(batchLogFile, `Concurrency: ${options.concurrency || 3}\n`);
  fs.appendFileSync(batchLogFile, `${'='.repeat(80)}\n\n`);

  log('');
  log(chalk.bold.cyan('📦 Batch Processing Mode (Parallel)'));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  // Concurrency limit (default: 3 parallel instances)
  const concurrency = options.concurrency || 3;

  info(`Total ${issues.length} Issues to process (${concurrency} concurrent)`);
  info(`Log file: ${batchLogFile}`);
  log('');

  const results = {
    success: [],
    failed: [],
    processing: new Set(),
    completed: 0
  };

  // Process issue with progress tracking
  async function processIssue(issue) {
    results.processing.add(issue);
    const startTime = Date.now();
    const issueIndex = issues.indexOf(issue) + 1;

    // Write issue header to log
    const logHeader = `\n${'='.repeat(80)}\n`;
    fs.appendFileSync(batchLogFile, logHeader);
    fs.appendFileSync(batchLogFile, `ISSUE #${issue} [${issueIndex}/${issues.length}]\n`);
    fs.appendFileSync(batchLogFile, `${'='.repeat(80)}\n`);
    fs.appendFileSync(batchLogFile, `Started at: ${new Date().toISOString()}\n`);
    fs.appendFileSync(batchLogFile, `Options: ${JSON.stringify(options)}\n`);
    fs.appendFileSync(batchLogFile, `${'-'.repeat(80)}\n`);

    try {
      log('');
      log(chalk.bold.cyan(`[${issueIndex}/${issues.length}] 🚀 Starting Issue #${issue}`));

      await cmdSolve(issue, { ...options, skipHeader: true, quiet: true, silent: true });

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      results.success.push(issue);
      success(`[${issueIndex}/${issues.length}] Issue #${issue} ✅ completed in ${duration}s`);

      // Write success to log
      fs.appendFileSync(batchLogFile, `${'-'.repeat(80)}\n`);
      fs.appendFileSync(batchLogFile, `Completed at: ${new Date().toISOString()}\n`);
      fs.appendFileSync(batchLogFile, `Duration: ${duration}s\n`);
      fs.appendFileSync(batchLogFile, `Status: ✅ SUCCESS\n`);

    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      error(`[${issueIndex}/${issues.length}] Issue #${issue} ❌ failed after ${duration}s`);
      error(`  Error: ${err.message}`);
      results.failed.push({ issue, error: err.message, stack: err.stack, duration });

      // Write failure to log
      fs.appendFileSync(batchLogFile, `${'-'.repeat(80)}\n`);
      fs.appendFileSync(batchLogFile, `Completed at: ${new Date().toISOString()}\n`);
      fs.appendFileSync(batchLogFile, `Duration: ${duration}s\n`);
      fs.appendFileSync(batchLogFile, `Status: ❌ FAILED\n`);
      fs.appendFileSync(batchLogFile, `\nError Message:\n${err.message}\n`);

      if (err.stack) {
        fs.appendFileSync(batchLogFile, `\nStack Trace:\n${err.stack}\n`);
      }

      // Check file status
      const researchFile = path.join(config.reportPath, `issue-${issue}-research.md`);
      const analysisFile = path.join(config.reportPath, `issue-${issue}-analysis-and-solution.md`);
      fs.appendFileSync(batchLogFile, `\nGenerated Files:\n`);
      fs.appendFileSync(batchLogFile, `  Research: ${fs.existsSync(researchFile) ? '✅ EXISTS' : '❌ MISSING'} (${researchFile})\n`);
      fs.appendFileSync(batchLogFile, `  Analysis: ${fs.existsSync(analysisFile) ? '✅ EXISTS' : '❌ MISSING'} (${analysisFile})\n`);

    } finally {
      results.processing.delete(issue);
      results.completed++;

      // Show progress
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
    // Start new tasks up to concurrency limit
    while (queue.length > 0 && activePromises.size < concurrency) {
      const issue = queue.shift();
      const promise = processIssue(issue)
        .then(() => activePromises.delete(promise))
        .catch(() => activePromises.delete(promise));
      activePromises.add(promise);
    }

    // Wait for at least one task to complete
    if (activePromises.size > 0) {
      await Promise.race(activePromises);
    }
  }

  // Write final summary to log
  fs.appendFileSync(batchLogFile, `\n${'='.repeat(80)}\n`);
  fs.appendFileSync(batchLogFile, `\nBatch Processing Summary\n`);
  fs.appendFileSync(batchLogFile, `Total: ${issues.length}\n`);
  fs.appendFileSync(batchLogFile, `Success: ${results.success.length}\n`);
  fs.appendFileSync(batchLogFile, `Failed: ${results.failed.length}\n`);
  fs.appendFileSync(batchLogFile, `Completed at: ${new Date().toISOString()}\n`);

  // Statistics
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
