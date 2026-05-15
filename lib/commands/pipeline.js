// @ts-check
/**
 * Pipeline command — query and display pipeline status from ai-issue-service.
 */

const { loadConfig } = require('../config');
const { log, error, info, success, warning, chalk, debug } = require('../logger');
const { serviceRequest, getServiceUrl } = require('../service-client');
const { STATUS_STYLE, RECOMMENDATION_STYLE } = require('../display-helpers');
const { enableDebugIfRequested, getRepoFromConfig } = require('../utils');
const { createUi } = require('../ui');

/**
 * Normalize the service response into an array of pipeline entries.
 * Returns an empty array for any non-array payload.
 * @param {*} data - Raw response body from the pipeline service
 * @returns {object[]}
 */
function normalizePipelineEntries(data) {
  return Array.isArray(data) ? data : [];
}

/**
 * Stable sort pipeline entries by numeric issue number, ascending.
 *
 * Newer issues (with larger numbers) end up at the bottom of the list so
 * users can scan from oldest to newest. Entries whose issue number is
 * missing or non-numeric are pushed to the end while preserving their
 * original relative order.
 *
 * Does not mutate the input array.
 *
 * @param {object[]} entries
 * @returns {object[]}
 */
function sortPipelineEntriesByIssue(entries) {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => {
      const rawA = a.entry == null ? undefined : a.entry.issue;
      const rawB = b.entry == null ? undefined : b.entry.issue;
      const issueA = Number(rawA);
      const issueB = Number(rawB);
      const validA = rawA != null && rawA !== '' && Number.isFinite(issueA);
      const validB = rawB != null && rawB !== '' && Number.isFinite(issueB);

      if (validA && validB && issueA !== issueB) {
        return issueA - issueB;
      }
      if (validA !== validB) {
        return validA ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map(({ entry }) => entry);
}

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
  const owner = formatOwner(entry).padEnd(22);
  const resource = (entry.resource_name || '-').slice(0, 25);

  return `  ${chalk[ss.color](issue)} ${status} ${rec}  ${title} ${chalk.dim(owner)} ${chalk.dim(resource)}`;
}

/**
 * @param {object} config
 * @param {object} options
 */
function createPipelineUi(config, options) {
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
 * PR-8 keeps data-browser commands plain by default; table mode is explicit or
 * test-injected so existing grep-friendly output remains stable.
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
 * @param {{ mode?: string, header?: Function, table?: Function }} ui
 * @param {object[]} entries
 */
function displayPipelineTable(ui, entries) {
  ui.header && ui.header('📋 Issue Pipeline');
  ui.table && ui.table(entries.map((entry) => {
    const ss = STATUS_STYLE[entry.status] || { emoji: '❓' };
    const rec = entry.recommendation
      ? (RECOMMENDATION_STYLE[entry.recommendation] || { emoji: '' }).emoji
      : '';
    return [
      `#${entry.issue}`,
      `${ss.emoji} ${entry.status || '-'}`,
      rec || '-',
      entry.title || '',
      formatOwner(entry),
      entry.resource_name || '-'
    ];
  }), [
    { header: 'Issue', width: 8 },
    { header: 'Status', width: 14 },
    { header: 'Rec', width: 4 },
    { header: 'Title', width: 45 },
    { header: 'Owner', width: 22 },
    { header: 'Resource', width: 25 }
  ], { pageSize: 20 });
}

/**
 * Render the assignee for display.
 *
 * The service emits two fields: `assigned_to` (canonical corporate alias
 * post §5 of OWNER_ALIAS_UNIFICATION_PLAN) and `assigned_to_name` (friendly
 * display name from `resource_owners.owner_name`). Show both as
 * `alias (Name)` when available, fall back to alias-only otherwise. Caps
 * length so the overall row stays readable; over-long names are truncated
 * to alias-only.
 *
 * @param {object} entry - PipelineEntry from the service
 * @returns {string}
 */
function formatOwner(entry) {
  const alias = entry.assigned_to || '';
  const name = entry.assigned_to_name || '';
  if (!alias) return '-';
  if (!name || name === alias) return alias;
  const combined = `${alias} (${name})`;
  return combined.length <= 22 ? combined : alias;
}


/**
 * Parse and validate a GitHub pull request URL.
 * @param {string} prUrl
 * @returns {{ prNumber: number, owner: string, repo: string }}
 */
function parseGitHubPrUrl(prUrl) {
  if (!prUrl || typeof prUrl !== 'string') {
    throw new Error('--pr-url is required');
  }

  let parsed;
  try {
    parsed = new URL(prUrl);
  } catch (_) {
    throw new Error('--pr-url must be a valid GitHub pull request URL');
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com') {
    throw new Error('--pr-url must be an https://github.com/<owner>/<repo>/pull/<number> URL');
  }

  const match = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/([1-9]\d*)\/?$/);
  if (!match) {
    throw new Error('--pr-url must be an https://github.com/<owner>/<repo>/pull/<number> URL');
  }

  return {
    owner: match[1],
    repo: match[2],
    prNumber: parseInt(match[3], 10),
  };
}

/**
 * Parse a positive integer option.
 * @param {string|number|undefined} value
 * @param {string} label
 * @returns {number|undefined}
 */
function parsePositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const stringValue = String(value).trim();
  if (!/^[1-9]\d*$/.test(stringValue)) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parseInt(stringValue, 10);
}

/**
 * Validate repository name.
 * @param {string} repo
 */
function validateRepo(repo) {
  if (!repo) {
    throw new Error('Repository not configured. Pass --repo owner/name, set repo in config, or set AI_ISSUE_REPO.');
  }
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    throw new Error('Repository must be in owner/name format');
  }
}

/**
 * Convert service error payloads into a readable message.
 * @param {number} status
 * @param {any} data
 * @returns {string}
 */
function formatServiceError(status, data) {
  let detail = '';
  if (data && typeof data === 'object') {
    if (typeof data.detail === 'string') {
      detail = data.detail;
    } else if (typeof data.message === 'string') {
      detail = data.message;
    } else if (typeof data.error === 'string') {
      detail = data.error;
    } else {
      detail = JSON.stringify(data);
    }
  } else if (data) {
    detail = String(data);
  }

  return `Mark PR-created failed (HTTP ${status})${detail ? `: ${detail}` : ''}`;
}

/**
 * Extract a Trello warning from the service response, if present.
 * @param {object} data
 * @returns {string}
 */
function getTrelloWarningMessage(data) {
  if (!data || typeof data !== 'object') {
    return '';
  }

  for (const key of ['trello_warning', 'trello_sync_warning', 'warning_message', 'warning']) {
    if (typeof data[key] === 'string' && data[key].trim()) {
      return data[key].trim();
    }
  }

  if (data.trello_warning === true || data.trello_sync_warning === true ||
      data.warning === true || data.trello_sync_failed === true ||
      data.trello_synced === false || data.trello_sync_ok === false) {
    return 'Trello sync failed or was incomplete; pipeline status was updated successfully.';
  }

  return '';
}

/**
 * Execute pipeline mark-pr-created command.
 * @param {number|string} issueNumber
 * @param {object} options - { prUrl, prNumber, repo, debug }
 * @returns {Promise<object>} Service response body
 */
async function cmdMarkPrCreated(issueNumber, options = {}) {
  const config = loadConfig();
  enableDebugIfRequested(options);

  const issue = parsePositiveInteger(issueNumber, 'Issue number');
  const prUrl = options.prUrl;
  const parsedPr = parseGitHubPrUrl(prUrl);
  const parsedPrNumber = parsedPr.prNumber;
  const explicitPrNumber = parsePositiveInteger(options.prNumber, '--pr-number');

  if (explicitPrNumber !== undefined && explicitPrNumber !== parsedPrNumber) {
    throw new Error(`--pr-number ${explicitPrNumber} does not match PR URL number ${parsedPrNumber}`);
  }

  const repo = options.repo || getRepoFromConfig(config);
  validateRepo(repo);

  if (!getServiceUrl()) {
    throw new Error('Service URL not configured. Run: ai-issue config set serviceUrl <url>');
  }

  const prNumber = explicitPrNumber || parsedPrNumber;
  const payload = {
    pr_url: prUrl,
    pr_number: prNumber,
  };

  info(`Marking Issue #${issue} as PR-created...`);

  try {
    const { status, data } = await serviceRequest('POST', `/pipeline/${repo}/${issue}/pr-created`, payload);

    if (status < 200 || status >= 300 || (data && data.ok === false)) {
      throw new Error(formatServiceError(status, data));
    }

    const responsePrUrl = (data && data.pr_url) || prUrl;
    const responseStatus = (data && data.status) || 'pr_created';
    const responsePrNumber = (data && data.pr_number) || prNumber;

    success(`Marked Issue #${issue} as PR-created`);
    log(`  PR:     ${responsePrUrl}`);
    log(`  Status: ${responseStatus}`);
    if (responsePrNumber) {
      log(`  PR #:   ${responsePrNumber}`);
    }

    const trelloWarning = getTrelloWarningMessage(data);
    if (trelloWarning) {
      warning(`Trello sync warning: ${trelloWarning}`);
    }

    return data;
  } catch (err) {
    if (options.debug && err.stack) {
      debug(err.stack);
    }
    throw err;
  }
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

    const entries = sortPipelineEntriesByIssue(normalizePipelineEntries(data));
    const ui = createPipelineUi(config, options);
    if (shouldUseTableUi(config, options, ui)) {
      if (entries.length === 0) {
        log('');
        info('No pipeline entries found.');
      } else {
        displayPipelineTable(ui, entries);
      }
      return;
    }

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

module.exports = {
  cmdPipeline,
  cmdMarkPrCreated,
  parseGitHubPrUrl,
  parsePositiveInteger,
  formatServiceError,
  getTrelloWarningMessage,
  formatEntry,
  formatOwner,
  displayPipelineTable,
  shouldUseTableUi,
  normalizePipelineEntries,
  sortPipelineEntriesByIssue,
};
