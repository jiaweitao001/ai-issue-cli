// @ts-check

const { spawn, execSync } = require('child_process');
const { BaseAgent } = require('./base-agent');
const { collectArtifacts } = require('./artifact-collector');
const { buildAgentEnv } = require('./env-builder');
const {
  toClaudeMcpConfigFile,
  cleanupTempMcpConfig
} = require('./mcp-normalizer');
const {
  snapshotGitState,
  collectGitMetadata,
  enforceForbidCommit
} = require('./git-policy');
const { resolveModelForAgent } = require('./model-resolver');
const { mapPermissionProfile } = require('./permission-mapper');
const { wrapPromptWithArtifactInstructions } = require('./prompt-wrapper');

class ClaudeCodeAgent extends BaseAgent {
  get name() {
    return 'claude-code';
  }

  get displayName() {
    return 'Claude Code CLI';
  }

  getCapabilities() {
    return { supportsMcp: true, supportsReadOnlyMode: true, gitDefault: 'no-commit' };
  }

  validateInstallationSync() {
    try {
      const version = execSync('claude --version', { stdio: 'pipe', encoding: 'utf8' }).trim();
      return { installed: true, version, errors: [] };
    } catch (_err) {
      return {
        installed: false,
        version: null,
        errors: [
          'Claude Code CLI not found. Run: npm install -g @anthropic-ai/claude-code',
          'Configure auth: https://docs.claude.com/claude-code'
        ]
      };
    }
  }

  /**
   * @param {import('../types').TaskRequest} req
   * @returns {Promise<import('../types').TaskResult>}
   */
  async runTask(req) {
    const gitSnapshot = snapshotGitState(req.repoPath);
    const warnings = [];
    let artifacts = {};
    let stderr = '';
    let runError = null;
    let mcpConfigPath = null;

    try {
      const runtimeEnv = buildAgentEnv(this.config);
      mcpConfigPath = req.mcpProfile ? toClaudeMcpConfigFile(req.mcpProfile, { debugMode: req.debugMode, runtimeEnv }) : null;
      const model = resolveModelForAgent(this.config, 'claude-code', req.model);
      const args = [
        '--print',
        '--model',
        model,
        ...mapPermissionProfile(req.permissionProfile, 'claude-code')
      ];

      if (req.reportPath && req.reportPath !== req.repoPath) {
        args.push('--add-dir', req.reportPath);
      }

      if (mcpConfigPath) {
        args.push('--mcp-config', mcpConfigPath, '--strict-mcp-config');
      }

      const prompt = wrapPromptWithArtifactInstructions(req.prompt, req.expectedArtifacts);
      const output = await spawnClaudeAndCollectStdout('claude', args, prompt, {
        cwd: req.repoPath,
        env: runtimeEnv,
        silent: req.silent
      });
      stderr = output.stderr;

      const collected = collectArtifacts(req.expectedArtifacts, {
        stdout: output.stdout,
        repoPath: req.repoPath
      });
      artifacts = collected.artifacts;
      warnings.push(...collected.warnings);
    } catch (err) {
      runError = err;
    } finally {
      if (mcpConfigPath && !req.debugMode) {
        cleanupTempMcpConfig(mcpConfigPath);
      }
      const cleanup = enforceForbidCommit(req, gitSnapshot);
      warnings.push(...cleanup.warnings);
    }

    if (runError) throw runError;

    return {
      success: true,
      artifacts,
      warnings,
      stderr,
      git: collectGitMetadata(req.repoPath, gitSnapshot.head)
    };
  }
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {string} stdin
 * @param {{ cwd: string, env: NodeJS.ProcessEnv, silent?: boolean }} options
 * @returns {Promise<{ stdout: string, stderr: string }>}
 */
function spawnClaudeAndCollectStdout(command, args, stdin, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const suffix = stderr.trim() ? `: ${stderr.trim()}` : '';
      reject(new Error(`Claude Code exited with code ${code}${suffix}`));
    });

    child.stdin.end(stdin);
  });
}

module.exports = {
  ClaudeCodeAgent,
  spawnClaudeAndCollectStdout
};
