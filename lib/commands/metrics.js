// @ts-check
/**
 * Metrics command — display team performance metrics from ai-issue-service.
 */

const { loadConfig } = require('../config');
const { log, error, info, warning, chalk, debug } = require('../logger');
const { serviceRequest, getServiceUrl } = require('../service-client');
const { enableDebugIfRequested, getRepoFromConfig } = require('../utils');
const { renderMetricsTable, renderMetricsList } = require('../display-helpers');
const { createUi } = require('../ui');

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

    const ui = createMetricsUi(config, options);
    await displayMetrics(data, { ...options, ui: shouldUseTableUi(config, options, ui) ? ui : undefined });
  } catch (err) {
    error(`Metrics query failed: ${err.message}`);
    if (options.debug && err.stack) {
      debug(err.stack);
    }
  }
}

/**
 * @param {object} config
 * @param {object} options
 */
function createMetricsUi(config, options) {
  if (options && options.ui) return options.ui;
  return createUi({
    flagPlain: !!(options && options.plain),
    flagTui: !!(options && options.tui),
    debug: !!(options && options.debug),
    config,
    env: (options && options.env) || process.env,
    stdout: (options && options.stdout) || process.stdout,
    stdin: (options && options.stdin) || process.stdin
  });
}

/**
 * @param {object} config
 * @param {object} options
 * @param {{ mode?: string }} ui
 */
function shouldUseTableUi(config, options, ui) {
  if (!ui || ui.mode !== 'tui') return false;
  return !!(options && (options.ui || options.tui || (options.env && options.env.AI_ISSUE_UI_MODE === 'tui'))) ||
    !!(config && config.uiMode === 'tui');
}

/**
 * @param {{ mode?: string, table?: Function }} ui
 * @param {object[]} engineers
 */
async function displayEngineerTable(ui, engineers) {
  if (!ui.table) return;
  await ui.table((engineers || []).map((eng) => [
    eng.owner || '-',
    eng.total_issues,
    eng.solved,
    eng.failed,
    formatPercent(eng.solve_rate),
    formatHours(eng.avg_response_time_hours),
    formatHours(eng.avg_solve_time_hours)
  ]), [
    { header: 'Engineer', width: 14 },
    { header: 'Total', width: 5 },
    { header: 'Solved', width: 6 },
    { header: 'Failed', width: 6 },
    { header: 'Solve Rate', width: 10 },
    { header: 'Avg Response', width: 12 },
    { header: 'Avg Solve', width: 9 }
  ], { pageSize: 20 });
}

/**
 * Display metrics in the terminal.
 * @param {object} data - Metrics response from the service
 * @param {object} options
 */
async function displayMetrics(data, options) {
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
    if (options && options.ui && options.ui.mode === 'tui') {
      await displayEngineerTable(options.ui, by_engineer);
    } else if (getTerminalWidth() < 80) {
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
  createMetricsUi,
  displayEngineerTable,
  shouldUseTableUi,
  getTerminalWidth,
};
