// @ts-check

/**
 * @typedef {import('../events').TimelineState} TimelineState
 */

/**
 * @param {TimelineState} state
 * @returns {string[]}
 */
function renderTimelineLines(state) {
  if (!state || !Array.isArray(state.order)) return [];
  return state.order.map((taskId) => {
    const task = state.tasks[taskId];
    if (!task) return '';
    const icon = task.status === 'running'
      ? '▶'
      : task.status === 'success'
        ? '✓'
        : task.status === 'failure'
          ? '✗'
          : '•';
    const suffix = typeof task.durationMs === 'number'
      ? ` (${(task.durationMs / 1000).toFixed(1)}s)`
      : '';
    return `${icon} ${task.label}${suffix}`;
  });
}

module.exports = {
  renderTimelineLines
};
