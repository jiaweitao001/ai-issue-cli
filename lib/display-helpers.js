/**
 * Shared display style constants for pipeline and triage commands
 */

// Status display styles for pipeline entries
const STATUS_STYLE = {
  triaged: { emoji: '📥', color: 'grey' },
  queued: { emoji: '🔄', color: 'blue' },
  solving: { emoji: '🔨', color: 'cyan' },
  solved: { emoji: '✅', color: 'green' },
  pr_created: { emoji: '🚀', color: 'greenBright' },
  rejected: { emoji: '❌', color: 'red' },
  failed: { emoji: '❌', color: 'red' },
};

// Recommendation display styles for triage results
const RECOMMENDATION_STYLE = {
  PROCEED: { emoji: '🟢', color: 'green' },
  SKIP: { emoji: '⏭️', color: 'yellow' },
  NEEDS_HUMAN: { emoji: '🟡', color: 'red' },
};

module.exports = {
  STATUS_STYLE,
  RECOMMENDATION_STYLE
};
