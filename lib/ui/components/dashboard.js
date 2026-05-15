// @ts-check

/**
 * @typedef {import('../events').DashboardState} DashboardState
 */

/**
 * @param {number | undefined} durationMs
 * @returns {string}
 */
function formatDuration(durationMs) {
  return typeof durationMs === 'number' ? `${(durationMs / 1000).toFixed(1)}s` : '-';
}

/**
 * @param {DashboardState} state
 * @returns {string[]}
 */
function renderDashboardLines(state) {
  if (!state || !Array.isArray(state.order)) return [];
  return state.order.map((taskId) => {
    const row = state.rows[taskId];
    if (!row) return '';
    const icon = row.status === 'running'
      ? '▶'
      : row.status === 'success'
        ? '✓'
        : row.status === 'failure'
          ? '✗'
          : '•';
    const agent = row.agent || '-';
    const lastStep = row.lastStep || '-';
    return `${icon} #${row.issue}  ${row.status}  ${formatDuration(row.durationMs)}  ${agent}  ${lastStep}`;
  });
}

module.exports = {
  renderDashboardLines
};
