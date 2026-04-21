// @ts-check
/**
 * Shared display style constants for pipeline and triage commands
 * @typedef {import('./types').StyleEntry} StyleEntry
 */

const { log, chalk } = require('./logger');

/** @type {Record<import('./types').PipelineStatus|'pr_created'|'rejected', StyleEntry>} */
const STATUS_STYLE = {
  triaged: { emoji: '📥', color: 'grey' },
  queued: { emoji: '🔄', color: 'blue' },
  solving: { emoji: '🔨', color: 'cyan' },
  solved: { emoji: '✅', color: 'green' },
  skipped: { emoji: '⏭️', color: 'yellow' },
  pr_created: { emoji: '🚀', color: 'greenBright' },
  rejected: { emoji: '❌', color: 'red' },
  failed: { emoji: '❌', color: 'red' },
};

/** @type {Record<import('./types').TriageRecommendation, StyleEntry>} */
const RECOMMENDATION_STYLE = {
  PROCEED: { emoji: '🟢', color: 'green' },
  SKIP: { emoji: '⏭️', color: 'yellow' },
  NEEDS_HUMAN: { emoji: '🟡', color: 'red' },
};


// ── Metrics rendering ───────────────────────────────


/**
 * Format hours with 1 decimal place, or '-' for null.
 * @param {number|null} hours
 * @returns {string}
 */
function _fmtH(hours) {
  if (hours == null) return '-';
  return `${Number(hours).toFixed(1)}h`;
}

/**
 * Format a rate as percentage string.
 * @param {number} rate
 * @returns {string}
 */
function _fmtPct(rate) {
  if (rate == null) return 'N/A';
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Render metrics as a table (for wide terminals ≥ 80 cols).
 * @param {Array<object>} engineers
 */
function renderMetricsTable(engineers) {
  log(chalk.dim('  Engineer        Total  Solved  Failed  Solve Rate  Avg Response  Avg Solve'));
  log(chalk.dim('  ──────────────  ─────  ──────  ──────  ──────────  ────────────  ─────────'));

  for (const eng of engineers) {
    const name = (eng.owner || '-').padEnd(14);
    const total = String(eng.total_issues).padStart(5);
    const solved = String(eng.solved).padStart(6);
    const failed = String(eng.failed).padStart(6);
    const rate = _fmtPct(eng.solve_rate).padStart(10);
    const resp = _fmtH(eng.avg_response_time_hours).padStart(12);
    const solve = _fmtH(eng.avg_solve_time_hours).padStart(9);

    log(`  ${chalk.bold(name)}  ${total}  ${solved}  ${failed}  ${rate}  ${resp}  ${solve}`);
  }
}

/**
 * Render metrics as a list (for narrow terminals < 80 cols).
 * @param {Array<object>} engineers
 */
function renderMetricsList(engineers) {
  for (const eng of engineers) {
    log(`  ${chalk.bold(eng.owner || '-')}`);
    log(`    Issues: ${eng.total_issues}  Solved: ${eng.solved}  Failed: ${eng.failed}`);
    log(`    Solve Rate: ${_fmtPct(eng.solve_rate)}  Resp: ${_fmtH(eng.avg_response_time_hours)}  Solve: ${_fmtH(eng.avg_solve_time_hours)}`);
    log('');
  }
}

module.exports = {
  STATUS_STYLE,
  RECOMMENDATION_STYLE,
  renderMetricsTable,
  renderMetricsList,
};
