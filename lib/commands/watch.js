/**
 * Watch command — daemon that polls pipeline for queued issues and auto-solves them.
 */

const { loadConfig } = require('../config');
const { log, error, info, success, warning, chalk, debug } = require('../logger');
const { serviceRequest, getServiceUrl } = require('../service-client');

/**
 * Poll the pipeline for queued issues assigned to the given owner.
 * @param {string} repo
 * @param {string} owner
 * @returns {Promise<Array>}
 */
async function fetchQueuedIssues(repo, owner) {
  const { status, data } = await serviceRequest('GET', '/pipeline', null, {
    repo,
    owner,
    status: 'queued',
    limit: 10,
  });

  if (status !== 200) {
    throw new Error(`Pipeline query failed (HTTP ${status})`);
  }

  return Array.isArray(data) ? data : [];
}

/**
 * Solve a single issue from the pipeline.
 * @param {number} issueNumber
 * @param {object} options - Solve options (branch, pushFork, etc.)
 * @returns {Promise<boolean>} - true if solved successfully
 */
async function solveIssue(issueNumber, options) {
  const { cmdSolve } = require('./solve');

  try {
    await cmdSolve(String(issueNumber), {
      ...options,
      branch: true,
      force: true,  // Override triage check since we already filtered by queued
      silent: true,
      noEval: options.noEval !== false,
    });
    return true;
  } catch (err) {
    warning(`Failed to solve issue #${issueNumber}: ${err.message}`);
    return false;
  }
}

/**
 * Execute one watch cycle: fetch queued issues → solve each.
 * @param {object} config
 * @param {string} owner
 * @param {object} options
 * @returns {Promise<{processed: number, solved: number, failed: number}>}
 */
async function watchCycle(config, owner, options) {
  const repo = config.repo || process.env.AI_ISSUE_REPO || '';

  const issues = await fetchQueuedIssues(repo, owner);

  if (issues.length === 0) {
    debug('No queued issues found');
    return { processed: 0, solved: 0, failed: 0 };
  }

  info(`Found ${issues.length} queued issue(s) for ${owner}`);

  let solved = 0;
  let failed = 0;

  for (const entry of issues) {
    const issueNumber = entry.issue;
    info(`Processing issue #${issueNumber}: ${entry.title || ''}`);

    // Report solving status to service
    try {
      await serviceRequest('POST', `/pipeline/${repo}/${issueNumber}/solving`);
    } catch (_) {
      debug(`Failed to report solving status for #${issueNumber}`);
    }

    const ok = await solveIssue(issueNumber, options);
    if (ok) {
      solved++;
      success(`Issue #${issueNumber} solved`);
    } else {
      failed++;
    }
  }

  return { processed: issues.length, solved, failed };
}

/**
 * Sleep helper.
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Execute the watch daemon.
 * @param {object} options - { owner, interval, pushFork, debug, ... }
 */
async function cmdWatch(options = {}) {
  const config = loadConfig();
  const owner = options.owner;
  const intervalSec = options.interval || 300;

  if (!owner) {
    error('--owner is required for watch mode');
    return;
  }

  if (!getServiceUrl()) {
    error('Service URL not configured. Set serviceUrl in config or AI_ISSUE_SERVICE_URL env var.');
    return;
  }

  if (options.debug) {
    process.env.AI_ISSUE_DEBUG = 'true';
  }

  log('');
  log(chalk.bold.cyan('👁️  AI Issue Watch Daemon'));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');
  info(`Owner: ${owner}`);
  info(`Poll interval: ${intervalSec}s`);
  info(`Push fork: ${options.pushFork ? 'yes' : 'no'}`);
  log('');

  // Run in a loop
  let running = true;

  // Handle graceful shutdown
  const shutdown = () => {
    info('Shutting down watch daemon...');
    running = false;
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  while (running) {
    try {
      const result = await watchCycle(config, owner, options);
      if (result.processed > 0) {
        info(`Cycle complete: ${result.solved} solved, ${result.failed} failed`);
      }
    } catch (err) {
      warning(`Watch cycle error: ${err.message}`);
      debug(err.stack || '');
    }

    if (!running) break;

    debug(`Sleeping ${intervalSec}s until next poll...`);
    await sleep(intervalSec * 1000);
  }

  info('Watch daemon stopped');
}

module.exports = {
  cmdWatch,
  watchCycle,
  fetchQueuedIssues,
  sleep,
};
