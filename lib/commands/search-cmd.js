// @ts-check
/**
 * Search command — search issues and solutions from ai-issue-service.
 */

const { loadConfig } = require('../config');
const { log, error, info, chalk, debug } = require('../logger');
const { serviceRequest, getServiceUrl } = require('../service-client');
const { enableDebugIfRequested, getRepoFromConfig } = require('../utils');
const { createUi } = require('../ui');

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

    const ui = createSearchUi(config, options);
    await displaySearchResults(query, data, { ...options, ui: shouldUseTableUi(config, options, ui) ? ui : undefined });
  } catch (err) {
    error(`Search failed: ${err.message}`);
    if (options.debug && err.stack) {
      debug(err.stack);
    }
  }
}

/**
 * @param {object} config
 * @param {object} options
 */
function createSearchUi(config, options) {
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
 * @param {Array} results
 */
async function displaySearchTable(ui, results) {
  if (!ui.table) return;
  await ui.table((results || []).map((result) => [
    `#${result.issue}`,
    result.status || '-',
    formatSearchOwner(result),
    result.match_score != null ? result.match_score.toFixed(2) : '-',
    result.title || '(untitled)',
    result.solution_summary || '(in progress)'
  ]), [
    { header: 'Issue', width: 8 },
    { header: 'Status', width: 10 },
    { header: 'Owner', width: 18 },
    { header: 'Score', width: 6 },
    { header: 'Title', width: 45 },
    { header: 'Solution', width: 60 }
  ], { pageSize: 20, detailIndex: 0 });
}

/**
 * Display search results in the terminal.
 * @param {string} query
 * @param {{ results: Array, total: number }} data
 * @param {object} [options]
 */
async function displaySearchResults(query, data, options) {
  const { results, total } = data;

  log('');

  if (!results || results.length === 0) {
    info(`No results found for "${query}".`);
    return;
  }

  log(chalk.bold.cyan(`🔍 Search results for "${query}" (${total} match${total !== 1 ? 'es' : ''})`));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  if (options && options.ui && options.ui.mode === 'tui') {
    await displaySearchTable(options.ui, results);
    return;
  }

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
  createSearchUi,
  displaySearchTable,
  shouldUseTableUi,
  formatSearchOwner,
};
