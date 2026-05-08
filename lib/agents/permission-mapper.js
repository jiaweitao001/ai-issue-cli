// @ts-check

const MAPS = {
  copilot: {
    'read-only': ['--allow-all-tools'],
    'noninteractive-full-auto': ['--allow-all-tools']
  },
  'claude-code': {
    'read-only': ['--permission-mode', 'plan'],
    'noninteractive-full-auto': ['--permission-mode', 'bypassPermissions']
  }
};

/**
 * @param {import('../types').PermissionProfile} profile
 * @param {string} agentName
 * @returns {string[]}
 */
function mapPermissionProfile(profile, agentName = 'copilot') {
  const map = MAPS[agentName];
  if (!map) {
    throw new Error(`Unknown agent for permission mapping: ${agentName}`);
  }
  const flags = map[profile];
  if (!flags) {
    throw new Error(`Unknown permission profile: ${profile}`);
  }
  return [...flags];
}

module.exports = {
  mapPermissionProfile
};
