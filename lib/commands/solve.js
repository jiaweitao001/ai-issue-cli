/**
 * Solve command implementation
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, execFileSync } = require('child_process');
const { loadConfig } = require('../config');
const { log, error, success, info, warning, chalk, highlight, debug } = require('../logger');
const { runCopilot } = require('../copilot');
const { serviceRequest, getServiceUrl } = require('../service-client');
const { waitForFile, parseBoolean, parseIssueType, enableDebugIfRequested } = require('../utils');
const { runGit } = require('../git-utils');

/**
 * Derive repo (owner/name) from config.repo, env var, or issueBaseUrl.
 * @param {object} config
 * @returns {string}
 */
function getRepoFromConfig(config) {
  if (config.repo) return config.repo;
  if (process.env.AI_ISSUE_REPO) return process.env.AI_ISSUE_REPO;
  // Extract from issueBaseUrl: https://github.com/owner/repo/issues → owner/repo
  if (config.issueBaseUrl) {
    const match = config.issueBaseUrl.match(/github\.com\/([^/]+\/[^/]+)\/issues/);
    if (match) return match[1];
  }
  return '';
}

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
    await runCopilot(reviewPrompt, config, [], options.silent || false, options.debug || false, { phase: 'phase2' });
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

// Command: solve (Two-Phase Approach)
async function cmdSolve(issueNumber, options) {
  const config = loadConfig();
  if (options.model) config.model = options.model;
  
  // Enable debug mode if --debug flag is set
  enableDebugIfRequested(options);
  if (options.debug) {
    debug('Debug mode enabled');
    debug(`Options: ${JSON.stringify(options, null, 2)}`);
    debug(`Config: ${JSON.stringify(config, null, 2)}`);
  }

  // Phase 3: Check pipeline status if service is configured
  if (getServiceUrl() && !options.force) {
    try {
      const repo = config.repo || process.env.AI_ISSUE_REPO;
      const { status, data } = await serviceRequest('GET', '/pipeline', null, {
        repo, status: 'triaged', limit: 100,
      });
      if (status === 200 && Array.isArray(data)) {
        const entry = data.find(e => e.issue === parseInt(issueNumber, 10));
        if (entry && (entry.recommendation === 'SKIP' || entry.recommendation === 'NEEDS_HUMAN')) {
          warning(`Issue #${issueNumber} was triaged as ${entry.recommendation}. Use --force to override.`);
          return;
        }
      }
    } catch {
      // Service unavailable — proceed without pipeline check
      debug('Pipeline check skipped (service unavailable)');
    }
  }

  // Phase 3: Create git branch if --branch is specified
  let branchName = null;
  if (options.branch) {
    branchName = `fix/issue-${issueNumber}`;
    try {
      runGit(config.repoPath, `git checkout -b ${branchName}`);
      info(`Created and switched to branch: ${branchName}`);
    } catch (err) {
      // Branch may already exist
      try {
        runGit(config.repoPath, `git checkout ${branchName}`);
        info(`Switched to existing branch: ${branchName}`);
      } catch {
        warning(`Failed to create branch ${branchName}: ${err.message}`);
        branchName = null;
      }
    }
  }

  if (!options.silent) {
    log('');
    log(chalk.bold.cyan('🚀 AI Issue Solver (Two-Phase Approach)'));
    log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    log('');
  }

  info(`Processing Issue #${issueNumber}`);

  const issueUrl = `${config.issueBaseUrl}/${issueNumber}`;
  const researchFile = path.join(config.reportPath, `issue-${issueNumber}-research.md`);
  const analysisFile = path.join(config.reportPath, `issue-${issueNumber}-analysis-and-solution.md`);

  if (!fs.existsSync(config.reportPath)) {
    fs.mkdirSync(config.reportPath, { recursive: true });
  }

  try {
    // ========================================
    // Phase 1: Deep Research
    // ========================================
    if (!options.silent) {
      log('');
      log(chalk.bold.blue('📚 Phase 1: Deep Research'));
      log(chalk.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      log('');
      info('Conducting comprehensive technical research...');
    }

    // Check if prompt file is in root or lib (supporting multiple structures)
    let phase1PromptFile = path.join(__dirname, '..', '..', 'prompts', 'PHASE1_RESEARCH_PROMPT.md');
    if (!fs.existsSync(phase1PromptFile)) {
      phase1PromptFile = path.join(__dirname, '..', 'prompts', 'PHASE1_RESEARCH_PROMPT.md');
    }

    if (!fs.existsSync(phase1PromptFile)) {
      throw new Error(`Phase 1 prompt file not found`);
    }

    const phase1Prompt = fs.readFileSync(phase1PromptFile, 'utf8');
    const researchPrompt = `${phase1Prompt}

---

**Issue URL**: ${issueUrl}
**Repository Path**: ${config.repoPath}
**Task**: Conduct deep research for Issue #${issueNumber}
**Output**: Save research report to: ${researchFile}

Start research now.
`;

    debug('Starting Phase 1: Research');
    debug(`Research file: ${researchFile}`);
    await runCopilot(researchPrompt, config, [], options.silent || false, options.debug || false, { phase: 'phase1' });

    // Wait for research file with progress feedback
    const researchExists = await waitForFile(researchFile, 60000, (elapsed) => {
      if (!options.silent) {
        info(`⏳ Waiting for research report... ${elapsed}s elapsed`);
      }
    });
    
    if (!researchExists) {
      throw new Error(`Research report not generated at ${researchFile} after 60s timeout`);
    }

    const researchContent = fs.readFileSync(researchFile, 'utf8');
    const issueType = parseIssueType(researchContent);

    if (!options.silent) {
      success('Research report generated');
      info(`Type: ${issueType === 'GUIDANCE' ? '📖 GUIDANCE' : '🔧 CODE_CHANGE'}`);
    }

    // ========================================
    // Phase 2: Solution Implementation
    // ========================================
    if (!options.silent) {
      log('');
      const phase2Title = issueType === 'GUIDANCE' ? '📖 Phase 2: Guidance & Explanation' : '🔧 Phase 2: Solution Implementation';
      log(chalk.bold.green(phase2Title));
      log(chalk.green('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      log('');
      info(issueType === 'GUIDANCE'
        ? 'Preparing guidance and explanation...'
        : 'Designing and implementing solution...');
    }

    const phase2PromptFileName = issueType === 'GUIDANCE'
      ? 'PHASE2_GUIDANCE_PROMPT.md'
      : 'PHASE2_SOLUTION_PROMPT.md';

    let phase2PromptFile = path.join(__dirname, '..', '..', 'prompts', phase2PromptFileName);
    if (!fs.existsSync(phase2PromptFile)) {
      phase2PromptFile = path.join(__dirname, '..', 'prompts', phase2PromptFileName);
    }

    if (!fs.existsSync(phase2PromptFile)) {
      throw new Error(`Phase 2 prompt file not found: ${phase2PromptFileName}`);
    }

    const phase2Prompt = fs.readFileSync(phase2PromptFile, 'utf8');

    let solutionPrompt = `${phase2Prompt}

---

**Issue URL**: ${issueUrl}
**Repository Path**: ${config.repoPath}
**Phase 1 Research Report**:
${researchContent}

**Task**: ${issueType === 'GUIDANCE' ? 'Provide guidance' : 'Implement solution'} for Issue #${issueNumber}
**Output**: Save analysis report to: ${analysisFile}

Start now.
`;

    // Ensure review tool is installed before Phase 2 so Copilot can leverage
    // its instructions, skills and prompts during code writing
    ensureReviewToolInstalled(config.repoPath, REVIEW_TOOL_INSTALLER_PATH, REVIEW_TOOL_REPO_URL);

    // Record HEAD before Phase 2 so auto-review can detect new commits
    let prePhase2Head = '';
    try {
      prePhase2Head = runGit(config.repoPath, 'git rev-parse HEAD').trim();
    } catch (_) { /* non-fatal */ }

    debug('Starting Phase 2: Solution');
    debug(`Analysis file: ${analysisFile}`);
    debug(`Issue type: ${issueType}`);
    await runCopilot(solutionPrompt, config, [], options.silent || false, options.debug || false, { phase: 'phase2' });

    // Wait for analysis file with progress feedback
    const analysisExists = await waitForFile(analysisFile, 60000, (elapsed) => {
      if (!options.silent) {
        info(`⏳ Waiting for solution report... ${elapsed}s elapsed`);
      }
    });
    
    if (!analysisExists) {
      throw new Error(`Analysis report not generated at ${analysisFile} after 60s timeout`);
    }

    if (!options.silent) {
      success('Analysis and solution report generated');
      info(`File: ${highlight(analysisFile)}`);
    }

    if (issueType === 'CODE_CHANGE') {
      await runPostPhase2AutoReview(issueNumber, config, options, prePhase2Head);
    }

    // Phase 3: Push to fork and report pipeline status
    if (options.pushFork && branchName) {
      const forkRemote = config.forkRemote || 'origin';
      try {
        info(`Pushing branch ${branchName} to ${forkRemote}...`);
        runGit(config.repoPath, `git push ${forkRemote} ${branchName}`);
        success(`Pushed ${branchName} to ${forkRemote}`);
      } catch (err) {
        warning(`Push failed: ${err.message}`);
      }
    }

    // Report solved to pipeline service
    if (getServiceUrl()) {
      try {
        const repo = getRepoFromConfig(config);
        await serviceRequest('POST', `/pipeline/${repo}/${issueNumber}/solved`, {
          branch: branchName || '',
          solved_by: process.env.USER || '',
        });
        debug('Pipeline status updated to solved');
      } catch {
        debug('Pipeline status update failed (non-fatal)');
      }
    }

    // Clean up
    if (fs.existsSync(researchFile)) {
      fs.unlinkSync(researchFile);
    }

    // Evaluation
    if (!options.noEval) {
      const { cmdEvaluate } = require('./evaluate');
      await cmdEvaluate(issueNumber, { ...options, skipHeader: true });
    } else if (!options.silent) {
      log('');
      success('Processing completed! (Evaluation skipped)');
    }

  } catch (err) {
    error(`Execution failed: ${err.message}`);

    // Report failure to pipeline service
    if (getServiceUrl()) {
      try {
        const repo = getRepoFromConfig(config);
        await serviceRequest('POST', `/pipeline/${repo}/${issueNumber}/failed`, null, {
          error: err.message,
        });
      } catch {
        // non-fatal
      }
    }

    throw err;
  }
}

module.exports = {
  cmdSolve
};
