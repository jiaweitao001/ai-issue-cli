/**
 * Triage command — view or trigger triage for an issue via ai-issue-service.
 */

const { loadConfig } = require('../config');
const { log, error, info, success, warning, chalk, debug } = require('../logger');
const { serviceRequest } = require('../service-client');

// Recommendation display helpers
const RECOMMENDATION_STYLE = {
  PROCEED: { emoji: '🟢', color: 'green' },
  SKIP: { emoji: '⏭️', color: 'yellow' },
  NEEDS_HUMAN: { emoji: '🟡', color: 'red' },
};

/**
 * Display triage result in a readable format.
 * @param {object} result - TriageResult from the service
 * @param {number} issueNumber
 */
function displayTriageResult(result, issueNumber) {
  const style = RECOMMENDATION_STYLE[result.recommendation] || { emoji: '❓', color: 'white' };

  log('');
  log(chalk.bold.cyan(`📋 Triage Result for Issue #${issueNumber}`));
  log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');
  log(`  Recommendation:  ${style.emoji} ${result.recommendation}`);
  log(`  Type:            ${result.issue_type}`);
  log(`  Complexity:      ${result.complexity}`);
  log(`  AI Solvability:  ${result.ai_solvability}`);
  log(`  Confidence:      ${(result.confidence * 100).toFixed(0)}%`);

  if (result.resource_name) {
    log(`  Resource:        ${result.resource_name}`);
  }
  if (result.assigned_to) {
    log(`  Assigned to:     ${result.assigned_to_name || result.assigned_to}`);
  }
  if (result.duplicate_of) {
    log(`  Duplicate of:    #${result.duplicate_of} (score: ${result.duplicate_score})`);
  }
  if (result.reasoning) {
    log(`  Reasoning:       ${result.reasoning}`);
  }
  log('');
}

/**
 * Execute triage command: call POST /triage and display result.
 * @param {number|string} issueNumber
 * @param {object} options
 */
async function cmdTriage(issueNumber, options = {}) {
  const config = loadConfig();

  if (options.debug) {
    process.env.AI_ISSUE_DEBUG = 'true';
  }

  info(`Triaging Issue #${issueNumber}...`);

  try {
    const repo = config.repo || process.env.AI_ISSUE_REPO || undefined;
    const { status, data } = await serviceRequest('POST', '/triage', {
      repo,
      issue_number: parseInt(issueNumber, 10),
      title: `Issue #${issueNumber}`,  // Placeholder; service fetches real data
      body: '',
    });

    if (status !== 200) {
      error(`Triage failed (HTTP ${status}): ${JSON.stringify(data)}`);
      return;
    }

    displayTriageResult(data, issueNumber);

  } catch (err) {
    error(`Triage failed: ${err.message}`);
    if (options.debug && err.stack) {
      debug(err.stack);
    }
  }
}

module.exports = {
  cmdTriage,
  displayTriageResult,
};
