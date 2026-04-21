/**
 * Import command — import historical issues into the pipeline.
 */

const { loadConfig } = require('../config');
const { log, error, info, chalk, debug } = require('../logger');
const { serviceRequest, serviceRequestStream, getServiceUrl } = require('../service-client');
const { enableDebugIfRequested, getRepoFromConfig } = require('../utils');
const { STATUS_STYLE } = require('../display-helpers');

/**
 * Parse --since value: supports relative (30d) and ISO date formats.
 * @param {string} since
 * @returns {string} ISO date string
 */
function parseSince(since) {
  if (!since) return '';
  const match = since.match(/^(\d+)d$/);
  if (match) {
    const days = parseInt(match[1], 10);
    const date = new Date(Date.now() - days * 86400000);
    return date.toISOString().split('T')[0];
  }
  return since;
}

/**
 * Render a single NDJSON line to the terminal.
 * @param {object} line - Parsed NDJSON object
 * @param {boolean} dryRun - Whether this is a dry run
 */
function renderLine(line, dryRun) {
  switch (line.type) {
    case 'progress':
      if (line.total > 0) {
        const pct = ((line.current / line.total) * 100).toFixed(1);
        info(`  ${line.message || ''} [${line.current}/${line.total}] ${pct}%`);
      } else {
        info(`  ${line.message || ''}`);
      }
      break;

    case 'issue': {
      const ss = STATUS_STYLE[line.status] || { emoji: '❓', color: 'white' };
      const pr = line.pr ? ` PR #${line.pr}` : '';
      log(`  #${String(line.number).padEnd(6)} → ${ss.emoji} ${chalk[ss.color](line.status.padEnd(8))} ${chalk.dim(`(${line.reason}${pr})`)}`);
      break;
    }

    case 'skipped':
      log(`  #${String(line.number).padEnd(6)} → ${chalk.dim('skipped')}  ${chalk.dim(`(${line.reason})`)}`);
      break;

    case 'error':
      error(`  #${String(line.number).padEnd(6)} → ${chalk.red('ERROR')}   ${line.message}`);
      break;

    case 'summary':
      renderSummary(line, dryRun);
      break;

    default:
      debug(`Unknown NDJSON type: ${line.type}`);
  }
}

/**
 * Render the final import summary.
 * @param {object} summary
 * @param {boolean} dryRun
 */
function renderSummary(summary, dryRun) {
  log('');
  log(chalk.bold('━'.repeat(50)));
  log(chalk.bold.green(dryRun ? '📋 Dry run complete' : '✅ Import complete'));
  log('');
  log(`  Imported: ${chalk.green(summary.imported)}`);
  log(`  Skipped:  ${chalk.yellow(summary.skipped)}`);
  log(`  Errors:   ${summary.errors > 0 ? chalk.red(summary.errors) : chalk.dim('0')}`);

  if (summary.by_status && Object.keys(summary.by_status).length > 0) {
    log('');
    log('  By Status:');
    for (const [status, count] of Object.entries(summary.by_status).sort((a, b) => b[1] - a[1])) {
      const ss = STATUS_STYLE[status] || { emoji: '❓', color: 'white' };
      const bar = '█'.repeat(Math.min(Math.ceil(count / 5), 30));
      log(`    ${ss.emoji} ${status.padEnd(10)} ${String(count).padStart(4)}  ${chalk[ss.color](bar)}`);
    }
  }
  log('');
}

/**
 * Execute import command.
 * @param {object} options
 */
async function cmdImport(options = {}) {
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

  // --status mode: query import progress
  if (options.status) {
    return showImportStatus(repo);
  }

  // Import mode
  const mode = options.mode || 'incremental';
  const dryRun = !!options.dryRun;
  const title = dryRun ? `📥 Import (DRY RUN) — ${mode}` : `📥 Importing issues — ${mode}`;

  log('');
  log(chalk.bold(title));
  log(chalk.dim('━'.repeat(50)));

  const queryParams = {
    mode,
    state: options.state || 'all',
    since: parseSince(options.since),
    labels: options.labels || '',
    limit: options.limit || '',
    skip_triage: options.skipTriage ? 'true' : '',
    dry_run: dryRun ? 'true' : '',
    force: options.force ? 'true' : '',
  };

  try {
    await serviceRequestStream(
      'POST',
      `/import/${repo}`,
      queryParams,
      (line) => renderLine(line, dryRun),
    );
  } catch (err) {
    error(`Import failed: ${err.message}`);
  }
}

/**
 * Show import progress/status.
 * @param {string} repo
 */
async function showImportStatus(repo) {
  try {
    const { status, data } = await serviceRequest('GET', `/import/${repo}/status`);
    if (status === 404) {
      info('No import jobs found for this repository.');
      return;
    }
    if (status !== 200) {
      error(`Failed to get import status (HTTP ${status})`);
      return;
    }

    log('');
    log(chalk.bold('📥 Import Status'));
    log(chalk.dim('━'.repeat(40)));
    log(`  State:     ${data.state === 'running' ? chalk.cyan(data.state) : chalk.green(data.state)}`);
    log(`  Mode:      ${data.mode}`);
    log(`  Total:     ${data.total_issues}`);
    log(`  Processed: ${data.processed}`);
    log(`  Imported:  ${chalk.green(data.imported)}`);
    log(`  Skipped:   ${chalk.yellow(data.skipped)}`);
    log(`  Errors:    ${data.errors > 0 ? chalk.red(data.errors) : '0'}`);
    if (data.started_at) {
      log(`  Started:   ${data.started_at}`);
    }
    if (data.completed_at) {
      log(`  Completed: ${data.completed_at}`);
    }
    log('');
  } catch (err) {
    error(`Failed to get import status: ${err.message}`);
  }
}

module.exports = { cmdImport, parseSince, renderLine, renderSummary };
