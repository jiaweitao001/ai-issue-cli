// @ts-check
/**
 * Git command utilities
 */

const { execSync, execFileSync } = require('child_process');

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

/**
 * Execute git with explicit argv list (no shell interpolation).
 *
 * Use this whenever an argument contains untrusted content (e.g. an LLM-generated
 * commit message body that may include backticks, `$()`, quotes, or newlines).
 * The shell-string variant (`runGit`) would let those characters be reinterpreted
 * by /bin/sh; `execFileSync` passes argv directly to git and is safe.
 *
 * @param {string} repoPath - Path to the git repository
 * @param {string[]} argv - Git subcommand and arguments (e.g. ['commit','-m','title'])
 * @param {object} [opts] - Extra child_process options merged into the spawn call
 * @returns {string} - Trimmed stdout output
 */
function runGitArgs(repoPath, argv, opts = {}) {
  return execFileSync('git', ['-C', repoPath, ...argv], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    ...opts
  }).trim();
}

module.exports = {
  runGit,
  runGitArgs
};
