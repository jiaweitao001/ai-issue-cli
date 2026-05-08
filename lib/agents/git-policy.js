// @ts-check

const { runGitArgs } = require('../git-utils');

/**
 * @param {string} value
 * @returns {string}
 */
function normalizeGitOutput(value) {
  return String(value || '').trim();
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
function readHead(repoPath) {
  return normalizeGitOutput(runGitArgs(repoPath, ['rev-parse', 'HEAD']));
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
function readBranch(repoPath) {
  return normalizeGitOutput(runGitArgs(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']));
}

/**
 * @param {string} repoPath
 * @returns {{ branch: string, head: string }}
 */
function snapshotGitState(repoPath) {
  return {
    branch: readBranch(repoPath),
    head: readHead(repoPath)
  };
}

/**
 * @param {string} repoPath
 * @param {string} beforeHead
 * @param {string} afterHead
 * @returns {string[]}
 */
function listCommits(repoPath, beforeHead, afterHead) {
  if (!beforeHead || !afterHead || beforeHead === afterHead) return [];
  const output = runGitArgs(repoPath, ['log', '--format=%H', `${beforeHead}..${afterHead}`]);
  return output.split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * @param {string} repoPath
 * @param {string} beforeHead
 * @param {string} afterHead
 * @returns {string[]}
 */
function listChangedFiles(repoPath, beforeHead, afterHead) {
  if (!beforeHead || !afterHead || beforeHead === afterHead) return [];
  const output = runGitArgs(repoPath, ['diff', '--name-only', `${beforeHead}..${afterHead}`]);
  return output.split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * @param {string} repoPath
 * @param {string} beforeHead
 * @param {string} [afterHead]
 * @returns {{ beforeHead: string, afterHead: string, commits: string[], changedFiles: string[] }}
 */
function collectGitMetadata(repoPath, beforeHead, afterHead = readHead(repoPath)) {
  return {
    beforeHead,
    afterHead,
    commits: listCommits(repoPath, beforeHead, afterHead),
    changedFiles: listChangedFiles(repoPath, beforeHead, afterHead)
  };
}

/**
 * @param {string} repoPath
 * @param {{ branch: string, head: string }} snapshot
 * @param {import('../types').GitPolicy} gitPolicy
 * @param {string} taskType
 * @returns {{ warnings: string[] }}
 */
function enforceGitPolicy(repoPath, snapshot, gitPolicy, taskType) {
  if (!gitPolicy || gitPolicy.commitBehavior !== 'forbid-commit') return { warnings: [] };

  try {
    const currentBranch = readBranch(repoPath);
    if (currentBranch !== snapshot.branch) {
      const message = `[${taskType}] Branch drifted ${snapshot.branch} -> ${currentBranch}; returning to ${snapshot.branch} before forbid-commit cleanup`;
      console.warn(message);
      try {
        runGitArgs(repoPath, ['checkout', snapshot.branch]);
      } catch (err) {
        const checkoutMessage = `[${taskType}] Failed to restore branch before forbid-commit cleanup: ${err.message}`;
        console.warn(checkoutMessage);
        return { warnings: [message, checkoutMessage] };
      }
    }

    const afterHead = readHead(repoPath);
    const commits = listCommits(repoPath, snapshot.head, afterHead);
    if (commits.length === 0) return { warnings: [] };

    const message = `[${taskType}] Detected ${commits.length} unexpected commit(s); auto-reverting to ${snapshot.head.slice(0, 7)} (commitBehavior=forbid-commit)`;
    console.warn(message);
    runGitArgs(repoPath, ['reset', '--soft', snapshot.head]);
    return { warnings: [message] };
  } catch (err) {
    const message = `[${taskType}] Failed to enforce forbid-commit cleanup: ${err.message}`;
    console.warn(message);
    return { warnings: [message] };
  }
}

/**
 * @param {import('../types').TaskRequest} req
 * @param {{ branch: string, head: string }} snapshot
 * @returns {{ warnings: string[] }}
 */
function enforceForbidCommit(req, snapshot) {
  return enforceGitPolicy(req.repoPath, snapshot, req.gitPolicy, req.taskType);
}

module.exports = {
  readHead,
  readBranch,
  snapshotGitState,
  listCommits,
  listChangedFiles,
  collectGitMetadata,
  enforceGitPolicy,
  enforceForbidCommit
};
