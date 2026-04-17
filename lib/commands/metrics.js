/**
 * Metrics command — display team performance metrics from ai-issue-service.
 */

const { loadConfig } = require('../config');
const { log, error, info, warning, chalk, debug } = require('../logger');
const { serviceRequest, getServiceUrl } = require('../service-client');
const { enableDebugIfRequested, getRepoFromConfig } = require('../utils');
const { renderMetricsTable, renderMetricsList } = require('../display-helpers');

/**
 * Execute metrics command: call GET /metrics/{repo} and display results.
 * @param {object} options - { owner, since, until, debug }
 */
async function cmdMetrics(options = {}) {
  const config = loadConfig();

  enableDebugIfRequested(options);

  if (!getServiceUrl()) {
    error('Service URL not configured. Run: ai-issue config set serviceUrl <url>');
    return;
  }

  const repo = getRepoFromConfig(config);
  if (!repo) {
    error('Repository not configured. Set repo in config or AI_ISSUE_REPO env var.');
    return;
  }

  info('Fetching team metrics...');

  try {
    const { status, data } = await serviceRequest('GET', `/metrics/${repo}`, null, {
      owner: options.owner || undefined,
      since: options.since || '30d',
      until: options.until || undefined,
    });

    if (status === 403) {
      error('Permission denied. Only managers can view metrics.');
      return;
    }

    if (status !== 200) {
      error(`Metrics query failed (HTTP ${status}): ${JSON.stringify(data)}`);
      return;
    }

    displayMetrics(data, options);
  } catch (err) {
    error(`Metrics query failed: ${err.message}`);
    if (options.debug && err.stack) {
      debug(err.stack);
    }
  }
}

/**
 * Display metrics in the terminal.
 * @param {object} data - Metrics response from the service
 * @param {object} options
 */
function displayMetrics(data, options) {
  const { summary, by_engineer, by_status, by_complexity, period } = data;

  if (summary.total_issues === 0) {
    log('');
    info('No data for this period.');
    return;
  }

  const periodStr = formatPeriod(period);

  log('');
  log(chalk.bold.cyan(`📊 Team Metrics (${periodStr})`));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  // Summary line
  log(`  Total: ${chalk.bold(summary.total_issues)} issues  │  ` +
      `${chalk.green('Solved: ' + summary.solved)}  │  ` +
      `${chalk.red('Failed: ' + summary.failed)}  │  ` +
      `${chalk.cyan('In Progress: ' + summary.in_progress)}  │  ` +
      `Pending: ${summary.pending}`);
  log(`  Solve Rate: ${chalk.bold(formatPercent(summary.solve_rate))}`);
  log('');

  // Engineer table
  if (by_engineer && by_engineer.length > 0) {
    const termWidth = getTerminalWidth();
    if (termWidth < 80) {
      renderMetricsList(by_engineer);
    } else {
      renderMetricsTable(by_engineer);
    }
    log('');
  }

  // Status breakdown
  if (by_status && Object.keys(by_status).length > 0) {
    const statusLine = Object.entries(by_status)
      .map(([s, c]) => `${s}: ${c}`)
      .join('  │  ');
    log(chalk.dim(`  Status: ${statusLine}`));
  }

  // Complexity breakdown
  if (by_complexity && Object.keys(by_complexity).length > 0) {
    const complexityLine = Object.entries(by_complexity)
      .map(([c, n]) => `${c}: ${n}`)
      .join('  │  ');
    log(chalk.dim(`  Complexity: ${complexityLine}`));
  }

  log('');
}

/**
 * Format a period object into a readable date range string.
 * @param {{ since: string, until: string }} period
 * @returns {string}
 */
function formatPeriod(period) {
  const since = period.since ? period.since.split('T')[0] : '?';
  const until = period.until ? period.until.split('T')[0] : '?';
  return `${since} ~ ${until}`;
}

/**
 * Format a decimal rate as percentage string.
 * @param {number} rate - e.g. 0.714
 * @returns {string} - e.g. "71.4%"
 */
function formatPercent(rate) {
  if (rate == null) return 'N/A';
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Format hours with 1 decimal place, or '-' for null.
 * @param {number|null} hours
 * @returns {string}
 */
function formatHours(hours) {
  if (hours == null) return '-';
  return `${hours.toFixed(1)}h`;
}

/**
 * Get terminal width, with fallback.
 * @returns {number}
 */
function getTerminalWidth() {
  try {
    return process.stdout.columns || 80;
  } catch {
    return 80;
  }
}

module.exports = {
  cmdMetrics,
  displayMetrics,
  formatPercent,
  formatHours,
  formatPeriod,
  getTerminalWidth,
};
