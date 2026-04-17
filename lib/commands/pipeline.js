/**
 * Pipeline command — query and display pipeline status from ai-issue-service.
 */

const { loadConfig } = require('../config');
const { log, error, info, chalk, debug } = require('../logger');
const { serviceRequest } = require('../service-client');
const { STATUS_STYLE, RECOMMENDATION_STYLE } = require('../display-helpers');
const { enableDebugIfRequested } = require('../utils');

/**
 * Format a pipeline entry as a table row string.
 * @param {object} entry - PipelineEntry from the service
 * @returns {string}
 */
function formatEntry(entry) {
  const ss = STATUS_STYLE[entry.status] || { emoji: '❓', color: 'white' };
  const rec = entry.recommendation
    ? (RECOMMENDATION_STYLE[entry.recommendation] || { emoji: '' }).emoji
    : '';

  const issue = `#${String(entry.issue).padEnd(6)}`;
  const status = `${ss.emoji} ${entry.status.padEnd(11)}`;
  const title = (entry.title || '').slice(0, 45).padEnd(45);
  const owner = (entry.assigned_to || '-').padEnd(10);
  const resource = (entry.resource_name || '-').slice(0, 25);

  return `  ${chalk[ss.color](issue)} ${status} ${rec}  ${title} ${chalk.dim(owner)} ${chalk.dim(resource)}`;
}

/**
 * Execute pipeline command: call GET /pipeline and display results.
 * @param {object} options - { owner, status, limit, debug }
 */
async function cmdPipeline(options = {}) {
  const config = loadConfig();

  enableDebugIfRequested(options);

  const repo = config.repo || process.env.AI_ISSUE_REPO || undefined;

  const filters = [];
  if (options.owner) filters.push(`owner=${options.owner}`);
  if (options.status) filters.push(`status=${options.status}`);
  info(`Querying pipeline${filters.length ? ` (${filters.join(', ')})` : ''}...`);

  try {
    const { status, data } = await serviceRequest('GET', '/pipeline', null, {
      repo,
      owner: options.owner || undefined,
      status: options.status || undefined,
      limit: options.limit || 20,
    });

    if (status !== 200) {
      error(`Pipeline query failed (HTTP ${status}): ${JSON.stringify(data)}`);
      return;
    }

    const entries = Array.isArray(data) ? data : [];

    log('');
    log(chalk.bold.cyan('📋 Issue Pipeline'));
    log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    log(chalk.dim('  Issue   Status            Title                                          Owner      Resource'));
    log(chalk.dim('  ──────  ───────────  ──   ─────────────────────────────────────────────  ──────────  ─────────────────────────'));

    if (entries.length === 0) {
      log('');
      info('No pipeline entries found.');
    } else {
      for (const entry of entries) {
        log(formatEntry(entry));
      }
    }

    log('');

    // Summary counts
    const counts = {};
    for (const entry of entries) {
      counts[entry.status] = (counts[entry.status] || 0) + 1;
    }
    const summary = Object.entries(counts)
      .map(([s, c]) => {
        const style = STATUS_STYLE[s] || { emoji: '' };
        return `${style.emoji} ${s}: ${c}`;
      })
      .join('  │  ');
    if (summary) {
      log(chalk.dim(`  ${summary}  │  total: ${entries.length}`));
      log('');
    }

  } catch (err) {
    error(`Pipeline query failed: ${err.message}`);
    if (options.debug && err.stack) {
      debug(err.stack);
    }
  }
}

module.exports = { cmdPipeline };
