// @ts-check
/**
 * Code review tool installation, detection, and auto-review logic
 * @typedef {import('./types').Config} Config
 * @typedef {import('./types').SolveOptions} SolveOptions
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');
const { log, info, success, warning, chalk, debug } = require('./logger');
const { runGit } = require('./git-utils');
const { runCopilot } = require('./copilot');

// Internal constants for the integrated code review tool
const REVIEW_TOOL_REPO_URL = 'https://github.com/WodansSon/terraform-azurerm-ai-assisted-development.git';
const REVIEW_TOOL_INSTALLER_PATH = path.join(os.homedir(), '.terraform-azurerm-ai-installer');

/**
 * Check whether the review tool prompt/chatmode files are present in the repository
 * @param {string} repoPath
 * @returns {boolean}
 */
function isReviewToolInRepo(repoPath) {
  const repoCandidates = [
    path.join(repoPath, '.github', 'prompts', 'code-review-committed-changes.prompt.md'),
    path.join(repoPath, '.github', 'prompts', 'code-review-local-changes.prompt.md'),
    path.join(repoPath, '.github', 'chatmodes', 'code-review-committed-changes.chatmode.md')
  ];
  return repoCandidates.some(candidate => fs.existsSync(candidate));
}

/**
 * Check whether the installer script is available at the given path
 * @param {string} installerPath
 * @returns {string|null} Path to the install script, or null if not found
 */
function findInstallerScript(installerPath) {
  const isWin = os.platform() === 'win32';
  const candidates = isWin
    ? [
        path.join(installerPath, 'install-copilot-setup.ps1'),
        path.join(installerPath, 'install-copilot-setup.sh')
      ]
    : [
        path.join(installerPath, 'install-copilot-setup.sh'),
        path.join(installerPath, 'install-copilot-setup.ps1')
      ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

/**
 * Ensure the review tool is installed in the target repository.
 * Downloads the installer if absent, runs it to provision prompt/chatmode files.
 * @param {string} repoPath
 * @param {string} installerPath
 * @param {string} repoUrl - Git URL of the installer repository
 * @returns {boolean} true if tool is ready for use
 */
function ensureReviewToolInstalled(repoPath, installerPath, repoUrl) {
  // 1. Already in repo – nothing to do
  if (isReviewToolInRepo(repoPath)) {
    return true;
  }

  // 2. Installer not yet downloaded – clone it
  if (!findInstallerScript(installerPath)) {
    if (!repoUrl) {
      debug('No reviewToolRepoUrl configured, cannot auto-install review tool');
      return false;
    }
    // Guard against concurrent clones (e.g. batch mode with high concurrency)
    if (fs.existsSync(installerPath)) {
      debug(`Installer directory already exists at ${installerPath} but no script found, skipping clone`);
      return false;
    }
    try {
      debug(`Cloning review tool installer from ${repoUrl} to ${installerPath}`);
      execFileSync('git', ['clone', '--depth', '1', repoUrl, installerPath], {
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        timeout: 120000
      });
    } catch (err) {
      debug(`Failed to clone review tool installer: ${err.message}`);
      return false;
    }
  }

  // 3. Run the installer script against the target repo
  const script = findInstallerScript(installerPath);
  if (!script) {
    debug('Installer script not found after clone');
    return false;
  }

  try {
    const execArgs = script.endsWith('.ps1')
      ? ['powershell', ['-ExecutionPolicy', 'Bypass', '-File', script, repoPath]]
      : ['bash', [script, repoPath]];
    debug(`Running installer: ${execArgs[0]} ${execArgs[1].join(' ')}`);
    execFileSync(execArgs[0], execArgs[1], {
      cwd: installerPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
      timeout: 60000
    });
  } catch (err) {
    debug(`Installer script failed: ${err.message}`);
    return false;
  }

  // 4. Verify installation
  return isReviewToolInRepo(repoPath);
}

/**
 * Run code review on Phase 2 commit and commit any review-addressing changes.
 * Stashes unrelated working tree changes to avoid committing dirty files.
 * @param {string} issueNumber
 * @param {object} config
 * @param {object} options
 * @param {string} prePhase2Head - HEAD commit hash recorded before Phase 2 started
 */
async function runPostPhase2AutoReview(issueNumber, config, options, prePhase2Head) {
  const repoPath = config.repoPath;

  // Check if Phase 2 actually produced new commit(s)
  let currentHead = '';
  try {
    currentHead = runGit(repoPath, 'git rev-parse HEAD').trim();
  } catch (err) {
    warning(`Skip auto review: failed to get current HEAD (${err.message})`);
    return;
  }

  if (currentHead === prePhase2Head) {
    info('No new commits from Phase 2, skipping auto review.');
    return;
  }

  debug(`Phase 2 produced new commit(s): ${prePhase2Head.substring(0, 7)}..${currentHead.substring(0, 7)}`);

  // Stash any unrelated working tree changes to keep the review clean
  let stashed = false;
  try {
    const dirtyStatus = runGit(repoPath, 'git status --porcelain');
    if (dirtyStatus) {
      debug(`Stashing unrelated working tree changes:\n${dirtyStatus}`);
      runGit(repoPath, 'git stash push -u -m "ai-issue: stash before auto review"');
      stashed = true;
    }
  } catch (err) {
    warning(`Failed to stash working tree changes: ${err.message}`);
  }

  if (!options.silent) {
    log('');
    log(chalk.bold.magenta('🔍 Post-Phase2: Auto Code Review'));
    log(chalk.magenta('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    log('');
  }

  if (!isReviewToolInRepo(repoPath)) {
    info('Review tool not available, skipping auto review.');
    if (stashed) runGit(repoPath, 'git stash pop');
    return;
  }

  const reviewPrompt = `Review the latest commit in repository ${repoPath} using /code-review-committed-changes.\n\nThen address all actionable review comments with minimal, issue-scoped edits.\nDo not broaden scope.\n\nIf code changes are made while addressing review comments, leave them in working tree for automated git commit.\nIf no changes are needed, do nothing.\n`;

  try {
    info('Running terraform AI code review and addressing review comments...');
    await runCopilot(reviewPrompt, config, { silent: options.silent, debugMode: options.debug, phase: 'phase2' });
  } catch (err) {
    warning(`Auto review step failed, continue without blocking: ${err.message}`);
    if (stashed) runGit(repoPath, 'git stash pop');
    return;
  }

  // Commit only review-generated fixes (if any)
  let reviewFixStatus = '';
  try {
    reviewFixStatus = runGit(repoPath, 'git status --porcelain');
  } catch (err) {
    warning(`Could not inspect review fix status: ${err.message}`);
    if (stashed) runGit(repoPath, 'git stash pop');
    return;
  }

  if (!reviewFixStatus) {
    success('Auto review completed, no additional fixes required');
  } else {
    try {
      runGit(repoPath, 'git add -A');
      runGit(repoPath, `git commit -m "Fix #${issueNumber}: address AI review comments"`);
      success('Review comments addressed and committed');
    } catch (err) {
      warning(`Review fixes generated but commit failed: ${err.message}`);
    }
  }

  // Restore stashed changes
  if (stashed) {
    try {
      runGit(repoPath, 'git stash pop');
      debug('Restored stashed working tree changes');
    } catch (err) {
      warning(`Failed to restore stashed changes: ${err.message}. Run 'git stash pop' manually.`);
    }
  }
}

module.exports = {
  isReviewToolInRepo,
  findInstallerScript,
  ensureReviewToolInstalled,
  runPostPhase2AutoReview,
  REVIEW_TOOL_REPO_URL,
  REVIEW_TOOL_INSTALLER_PATH
};
