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
 * @param {{ type?: string, taskId?: string, label?: string, startedAt?: number, endedAt?: number, durationMs?: number, success?: boolean, parentTaskId?: string }} event
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

/**
 * @typedef {Object} DashboardRow
 * @property {string} taskId
 * @property {string} issue
 * @property {string} label
 * @property {TaskStatus} status
 * @property {string} [lastStep]
 * @property {string} [agent]
 * @property {number} [startedAt]
 * @property {number} [endedAt]
 * @property {number} [durationMs]
 * @property {string} [error]
 */

/**
 * @typedef {Object} DashboardState
 * @property {Record<string, DashboardRow>} rows
 * @property {string[]} order
 */

/**
 * @param {string} parentTaskId
 * @param {string | undefined} label
 * @returns {DashboardRow}
 */
function createDashboardRow(parentTaskId, label) {
  const issue = parentTaskId.startsWith('issue-') ? parentTaskId.slice('issue-'.length) : parentTaskId;
  return {
    taskId: parentTaskId,
    issue,
    label: label || `Issue #${issue}`,
    status: 'pending'
  };
}

/**
 * @param {DashboardState | null | undefined} state
 * @param {{ type?: string, taskId?: string, parentTaskId?: string, label?: string, startedAt?: number, endedAt?: number, durationMs?: number, success?: boolean, agent?: string, error?: string }} event
 * @returns {DashboardState}
 */
function reduceDashboardEvent(state, event) {
  const next = state
    ? { rows: { ...state.rows }, order: [...state.order] }
    : { rows: {}, order: [] };
  if (!event || !event.parentTaskId) return next;

  const parentTaskId = event.parentTaskId;
  const isParentEvent = event.taskId === parentTaskId;
  const existing = next.rows[parentTaskId] || createDashboardRow(parentTaskId, event.label);
  if (!next.rows[parentTaskId]) next.order.push(parentTaskId);

  if (isParentEvent && event.type === 'task:start') {
    next.rows[parentTaskId] = {
      ...existing,
      label: event.label || existing.label,
      status: 'running',
      startedAt: event.startedAt || existing.startedAt || Date.now(),
      agent: event.agent || existing.agent,
      lastStep: existing.lastStep || 'Starting'
    };
    return next;
  }

  if (!isParentEvent && (event.type === 'task:start' || event.type === 'task:finish')) {
    next.rows[parentTaskId] = {
      ...existing,
      status: event.success === false ? 'failure' : 'running',
      lastStep: event.label || event.taskId || existing.lastStep,
      agent: event.agent || existing.agent,
      error: event.error || existing.error
    };
    return next;
  }

  if (isParentEvent && event.type === 'task:finish') {
    const endedAt = event.endedAt || Date.now();
    const startedAt = existing.startedAt;
    next.rows[parentTaskId] = {
      ...existing,
      status: event.success === false ? 'failure' : 'success',
      endedAt,
      durationMs: typeof event.durationMs === 'number'
        ? event.durationMs
        : (typeof startedAt === 'number' ? endedAt - startedAt : undefined),
      agent: event.agent || existing.agent,
      error: event.error || existing.error
    };
  }
  return next;
}

module.exports = {
  reduceTaskEvent,
  reduceDashboardEvent
};
