// @ts-check

const os = require('os');
const { spawnSync } = require('child_process');

/**
 * The actual gates intentionally run CI-equivalent commands (including
 * `make tools` where upstream does). This preflight only captures environment
 * diagnostics and warns early for obviously missing base tools.
 *
 * @param {string[]} commands
 * @returns {{ warnings: string[], diagnostics: Record<string, string> }}
 */
function collectToolPreflight(commands = ['git', 'go', 'make', 'bash']) {
  const warnings = [];
  for (const command of commands) {
    const result = spawnSync(command, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    /** @type {NodeJS.ErrnoException|undefined} */
    const err = result.error;
    if (err && err.code === 'ENOENT') {
      warnings.push(`verify-loop prerequisite not found on PATH: ${command}`);
    }
  }
  return {
    warnings,
    diagnostics: {
      platform: process.platform,
      arch: process.arch,
      cpus: String(os.cpus().length)
    }
  };
}

module.exports = {
  collectToolPreflight
};
