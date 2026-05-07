// @ts-check

const fs = require('fs');
const { execSync } = require('child_process');
const { runCopilot } = require('../copilot');
const { waitForFile } = require('../utils');
const { runGitArgs } = require('../git-utils');
const { BaseAgent } = require('./base-agent');
const { UnsupportedArtifactKind } = require('./errors');
const { validateArtifact } = require('./artifact-validator');

const REPORT_WAIT_TIMEOUT_MS = 60000;

/**
 * @param {string} repoPath
 * @returns {string}
 */
function readHead(repoPath) {
  return runGitArgs(repoPath, ['rev-parse', 'HEAD']);
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
function readBranch(repoPath) {
  return runGitArgs(repoPath, ['rev-parse', '--abbrev-ref', 'HEAD']);
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

class CopilotAgent extends BaseAgent {
  get name() {
    return 'copilot';
  }

  get displayName() {
    return 'Copilot CLI';
  }

  getCapabilities() {
    return { supportsMcp: true, supportsReadOnlyMode: false, gitDefault: 'no-commit' };
  }

  validateInstallationSync() {
    try {
      const version = execSync('copilot --version', { stdio: 'pipe', encoding: 'utf8' }).trim();
      return { installed: true, version, errors: [] };
    } catch (_err) {
      return {
        installed: false,
        version: null,
        errors: ['Copilot CLI not found. Run: npm install -g @github/copilot']
      };
    }
  }

  /**
   * @param {import('../types').TaskRequest} req
   * @returns {Promise<import('../types').TaskResult>}
   */
  async runTask(req) {
    const beforeBranch = readBranch(req.repoPath);
    const beforeHead = readHead(req.repoPath);
    const artifacts = {};
    const warnings = [];
    let runError = null;

    try {
      await runCopilot(req.prompt, {
        ...this.config,
        model: req.model,
        repoPath: req.repoPath,
        reportPath: req.reportPath
      }, {
        silent: req.silent,
        debugMode: req.debugMode,
        phase: req.mcpProfile
      });

      for (const spec of req.expectedArtifacts) {
        if (spec.kind !== 'file') {
          throw new UnsupportedArtifactKind(`CopilotAgent does not support artifact kind '${spec.kind}' (5A only supports 'file')`);
        }

        const ok = await waitForFile(spec.path, REPORT_WAIT_TIMEOUT_MS, req.onArtifactWaitProgress);
        if (!ok) {
          const message = `Expected artifact missing: ${spec.path}`;
          if (spec.failureMode === 'warn') {
            warnings.push(message);
            continue;
          }
          throw new Error(message);
        }

        let content = '';
        try {
          content = fs.readFileSync(spec.path, 'utf8');
        } catch (err) {
          const message = `Cannot read artifact ${spec.path}: ${err.message}`;
          if (spec.failureMode === 'warn') {
            warnings.push(message);
            continue;
          }
          throw err;
        }

        const validation = validateArtifact(spec, content);
        if (validation) {
          if (spec.failureMode === 'warn') {
            warnings.push(validation.message);
            continue;
          }
          throw validation;
        }

        artifacts[spec.path] = content;
      }
    } catch (err) {
      runError = err;
    } finally {
      const cleanup = enforceForbidCommit(req, beforeBranch, beforeHead);
      warnings.push(...cleanup.warnings);
    }

    if (runError) throw runError;

    const afterHead = readHead(req.repoPath);
    return {
      success: true,
      artifacts,
      warnings,
      git: {
        beforeHead,
        afterHead,
        commits: listCommits(req.repoPath, beforeHead, afterHead),
        changedFiles: listChangedFiles(req.repoPath, beforeHead, afterHead)
      }
    };
  }
}

/**
 * @param {import('../types').TaskRequest} req
 * @param {string} beforeBranch
 * @param {string} beforeHead
 * @returns {{ warnings: string[] }}
 */
function enforceForbidCommit(req, beforeBranch, beforeHead) {
  if (req.gitPolicy.commitBehavior !== 'forbid-commit') return { warnings: [] };

  try {
    const currentBranch = readBranch(req.repoPath);
    if (currentBranch !== beforeBranch) {
      const message = `[${req.taskType}] Branch drifted ${beforeBranch} -> ${currentBranch}; returning to ${beforeBranch} before forbid-commit cleanup`;
      console.warn(message);
      try {
        runGitArgs(req.repoPath, ['checkout', beforeBranch]);
      } catch (err) {
        const checkoutMessage = `[${req.taskType}] Failed to restore branch before forbid-commit cleanup: ${err.message}`;
        console.warn(checkoutMessage);
        return { warnings: [message, checkoutMessage] };
      }
    }

    const afterHead = readHead(req.repoPath);
    const commits = listCommits(req.repoPath, beforeHead, afterHead);
    if (commits.length === 0) return { warnings: [] };

    const message = `[${req.taskType}] Detected ${commits.length} unexpected commit(s); auto-reverting to ${beforeHead.slice(0, 7)} (commitBehavior=forbid-commit)`;
    console.warn(message);
    runGitArgs(req.repoPath, ['reset', '--soft', beforeHead]);
    return { warnings: [message] };
  } catch (err) {
    const message = `[${req.taskType}] Failed to enforce forbid-commit cleanup: ${err.message}`;
    console.warn(message);
    return { warnings: [message] };
  }
}

module.exports = {
  CopilotAgent,
  REPORT_WAIT_TIMEOUT_MS,
  enforceForbidCommit
};
