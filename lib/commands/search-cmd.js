// @ts-check
/**
 * Search command — search issues and solutions from ai-issue-service.
 */

const { loadConfig } = require('../config');
const { log, error, info, chalk, debug } = require('../logger');
const { serviceRequest, getServiceUrl } = require('../service-client');
const { enableDebugIfRequested, getRepoFromConfig } = require('../utils');

/**
 * Execute search command: call GET /search/pipeline/{repo} and display results.
 * @param {string} query - Search query string
 * @param {object} options - { owner, status, limit, debug }
 */
async function cmdSearch(query, options = {}) {
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

  info(`Searching for "${query}"...`);

  try {
    const { status, data } = await serviceRequest('GET', `/search/pipeline/${repo}`, null, {
      q: query,
      owner: options.owner || undefined,
      status: options.status || undefined,
      limit: options.limit || 20,
    });

    if (status === 403) {
      error('Permission denied. Only managers can search pipeline.');
      return;
    }

    if (status !== 200) {
      error(`Search failed (HTTP ${status}): ${JSON.stringify(data)}`);
      return;
    }

    displaySearchResults(query, data);
  } catch (err) {
    error(`Search failed: ${err.message}`);
    if (options.debug && err.stack) {
      debug(err.stack);
    }
  }
}

/**
 * Display search results in the terminal.
 * @param {string} query
 * @param {{ results: Array, total: number }} data
 */
function displaySearchResults(query, data) {
  const { results, total } = data;

  log('');

  if (!results || results.length === 0) {
    info(`No results found for "${query}".`);
    return;
  }

  log(chalk.bold.cyan(`🔍 Search results for "${query}" (${total} match${total !== 1 ? 'es' : ''})`));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  for (const result of results) {
    const statusColor = result.status === 'solved' ? 'green'
      : result.status === 'failed' ? 'red'
      : 'cyan';

    log(`  ${chalk.bold(`#${result.issue}`)}  ${result.title || '(untitled)'}`);
    log(`        Status: ${chalk[statusColor](result.status)}  │  ` +
        `Owner: ${formatSearchOwner(result)}  │  ` +
        `Score: ${result.match_score != null ? result.match_score.toFixed(2) : '-'}`);

    if (result.solution_summary) {
      log(`        Solution: ${result.solution_summary.slice(0, 120)}`);
    } else {
      log(chalk.dim('        Solution: (in progress)'));
    }

    if (result.pr_url) {
      log(`        PR: ${chalk.dim(result.pr_url)}`);
    }

    log('');
  }
}

/**
 * Render the assignee for the search Owner field.
 *
 * Mirrors {@link module:lib/commands/pipeline.formatOwner}: prefer
 * `alias (Name)` when both fields are present, fall back to alias-only
 * if the friendly name is missing or identical. No length cap here —
 * the search line wraps freely.
 *
 * @param {object} result - Search result row from the service
 * @returns {string}
 */
function formatSearchOwner(result) {
  const alias = result.assigned_to || '';
  const name = result.assigned_to_name || '';
  if (!alias) return '-';
  if (!name || name === alias) return alias;
  return `${alias} (${name})`;
}

module.exports = {
  cmdSearch,
  displaySearchResults,
  formatSearchOwner,
};
