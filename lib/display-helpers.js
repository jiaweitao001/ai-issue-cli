// @ts-check
/**
 * Shared display style constants for pipeline and triage commands
 * @typedef {import('./types').StyleEntry} StyleEntry
 */

/** @type {Record<import('./types').PipelineStatus|'pr_created'|'rejected', StyleEntry>} */
const STATUS_STYLE = {
  triaged: { emoji: '📥', color: 'grey' },
  queued: { emoji: '🔄', color: 'blue' },
  solving: { emoji: '🔨', color: 'cyan' },
  solved: { emoji: '✅', color: 'green' },
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

module.exports = {
  STATUS_STYLE,
  RECOMMENDATION_STYLE
};
