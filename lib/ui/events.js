// @ts-check

/**
 * @typedef {'pending'|'running'|'success'|'failure'} TaskStatus
 */

/**
 * @typedef {Object} TaskState
 * @property {string} taskId
 * @property {string} label
 * @property {TaskStatus} status
 * @property {number} [startedAt]
 * @property {number} [endedAt]
 * @property {number} [durationMs]
 */

/**
 * @typedef {Object} TimelineState
 * @property {Record<string, TaskState>} tasks
 * @property {string[]} order
 */

/**
 * @param {TimelineState | null | undefined} state
 * @param {{ type?: string, taskId?: string, label?: string, startedAt?: number, endedAt?: number, durationMs?: number, success?: boolean }} event
 * @returns {TimelineState}
 */
function reduceTaskEvent(state, event) {
  const next = state
    ? { tasks: { ...state.tasks }, order: [...state.order] }
    : { tasks: {}, order: [] };
  if (!event || !event.taskId) return next;

  const existing = next.tasks[event.taskId];
  if (event.type === 'task:start') {
    if (!existing) next.order.push(event.taskId);
    next.tasks[event.taskId] = {
      taskId: event.taskId,
      label: event.label || (existing && existing.label) || event.taskId,
      status: 'running',
      startedAt: event.startedAt || Date.now()
    };
    return next;
  }

  if (event.type === 'task:finish') {
    if (!existing) next.order.push(event.taskId);
    const startedAt = existing && existing.startedAt;
    const endedAt = event.endedAt || Date.now();
    next.tasks[event.taskId] = {
      taskId: event.taskId,
      label: event.label || (existing && existing.label) || event.taskId,
      status: event.success === false ? 'failure' : 'success',
      startedAt,
      endedAt,
      durationMs: typeof event.durationMs === 'number'
        ? event.durationMs
        : (typeof startedAt === 'number' ? endedAt - startedAt : undefined)
    };
  }
  return next;
}

module.exports = {
  reduceTaskEvent
};
