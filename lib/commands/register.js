/**
 * Register command — register GitHub PAT with ai-issue-service for PR creation.
 */

const { loadConfig } = require('../config');
const { log, error, info, success, chalk } = require('../logger');
const { serviceRequest } = require('../service-client');
const { enableDebugIfRequested } = require('../utils');

/**
 * Execute register command: send PAT to service for encrypted storage.
 * @param {object} options - { pat, owner, trelloMemberId, debug }
 */
async function cmdRegister(options = {}) {
  const config = loadConfig();

  enableDebugIfRequested(options);

  const pat = options.pat;
  if (!pat) {
    error('--pat is required');
    return;
  }

  // Determine owner from option, config, or env
  const owner = options.owner
    || config.owner
    || process.env.AI_ISSUE_OWNER
    || process.env.USER
    || '';

  if (!owner) {
    error('Could not determine owner. Use --owner or set AI_ISSUE_OWNER.');
    return;
  }

  info(`Registering GitHub PAT for owner: ${owner}`);

  try {
    const { status, data } = await serviceRequest('POST', '/engineers/register', {
      owner,
      github_pat: pat,
      trello_member_id: options.trelloMemberId || '',
    });

    if (status !== 200) {
      error(`Registration failed (HTTP ${status}): ${JSON.stringify(data)}`);
      return;
    }

    log('');
    success('Registration successful!');
    log(`  Owner:       ${data.owner}`);
    log(`  GitHub user: ${data.github_user}`);
    log('');
    info('Your PAT is encrypted and stored on the server.');
    info('It will be used to create PRs on your behalf when you approve issues.');

  } catch (err) {
    error(`Registration failed: ${err.message}`);
  }
}

module.exports = { cmdRegister };
