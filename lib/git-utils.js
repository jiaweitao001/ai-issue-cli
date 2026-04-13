/**
 * Git command utilities
 */

const { execSync } = require('child_process');

/**
 * Execute git command in target repo
 * @param {string} repoPath - Path to the git repository
 * @param {string} command - Git command to execute
 * @returns {string} - Trimmed stdout output
 */
function runGit(repoPath, command) {
  return execSync(command, {
    cwd: repoPath,
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8'
  }).trim();
}

module.exports = {
  runGit
};
