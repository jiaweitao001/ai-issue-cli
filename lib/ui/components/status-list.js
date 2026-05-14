// @ts-check

/**
 * Shared status-list formatting helpers for PlainRenderer and TuiRenderer.
 * Renderers own coloring / output streams; this module owns only stable line
 * shape so `ai-issue check` stays grep-friendly in plain and TUI modes.
 */

/**
 * @typedef {Object} StatusItem
 * @property {'ok'|'fail'|'warn'|'skip'} status
 * @property {string} name
 * @property {string} [detail]
 * @property {string} [help]
 * @property {string} [command]
 */

/**
 * @typedef {Object} StatusGroup
 * @property {string} title
 * @property {StatusItem[]} items
 */

/**
 * @param {string|undefined} status
 * @returns {string}
 */
function statusIcon(status) {
  switch (status) {
    case 'ok':   return '✅';
    case 'fail': return '❌';
    case 'warn': return '⚠️ ';
    case 'skip': return '⏭ ';
    default:     return '•';
  }
}

/**
 * @param {number} index
 * @param {StatusItem} item
 * @returns {string}
 */
function formatStatusLine(index, item) {
  const detail = item && item.detail ? `    [${item.detail}]` : '';
  return `${index}. ${statusIcon(item && item.status)} ${(item && item.name) || ''}${detail}`;
}

/**
 * @param {string|undefined} value
 * @returns {string[]}
 */
function splitHelpLines(value) {
  if (!value) return [];
  return String(value).split(/\r?\n/).filter(Boolean);
}

module.exports = {
  statusIcon,
  formatStatusLine,
  splitHelpLines
};
