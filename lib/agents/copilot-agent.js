// @ts-check

const fs = require('fs');
const { execSync } = require('child_process');
const { runCopilot } = require('../copilot');
const { waitForFile } = require('../utils');
const { BaseAgent } = require('./base-agent');
const { UnsupportedArtifactKind } = require('./errors');
const { finalizeArtifact, handleArtifactIssue } = require('./artifact-finalizer');
const {
  snapshotGitState,
  collectGitMetadata,
  enforceForbidCommit: enforceForbidCommitPolicy
} = require('./git-policy');

const REPORT_WAIT_TIMEOUT_MS = 60000;

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
    const gitSnapshot = snapshotGitState(req.repoPath);
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
          handleArtifactIssue(spec, `Expected artifact missing: ${spec.path}`, warnings);
          continue;
        }

        let content = '';
        try {
          content = fs.readFileSync(spec.path, 'utf8');
        } catch (err) {
          const message = `Cannot read artifact ${spec.path}: ${err.message}`;
          handleArtifactIssue(spec, message, warnings, err);
          continue;
        }

        finalizeArtifact(spec, content, artifacts, warnings);
      }
    } catch (err) {
      runError = err;
    } finally {
      const cleanup = enforceForbidCommitPolicy(req, gitSnapshot);
      warnings.push(...cleanup.warnings);
    }

    if (runError) throw runError;

    return {
      success: true,
      artifacts,
      warnings,
      git: collectGitMetadata(req.repoPath, gitSnapshot.head)
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
  return enforceForbidCommitPolicy(req, { branch: beforeBranch, head: beforeHead });
}

module.exports = {
  CopilotAgent,
  REPORT_WAIT_TIMEOUT_MS,
  enforceForbidCommit
};
