/**
 * Solve command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { log, error, success, info, warning, chalk, highlight, debug } = require('../logger');
const { runCopilot } = require('../copilot');
const { serviceRequest, getServiceUrl } = require('../service-client');
const { waitForFile, parseBoolean, parseIssueType, enableDebugIfRequested } = require('../utils');
const { runGit } = require('../git-utils');
const { isReviewToolInRepo, ensureReviewToolInstalled, runPostPhase2AutoReview, REVIEW_TOOL_REPO_URL, REVIEW_TOOL_INSTALLER_PATH } = require('../review-tool');
const { loadPrompt } = require('../prompt-loader');

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

    const phase1Prompt = loadPrompt('PHASE1_RESEARCH_PROMPT.md');
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

    const phase2Prompt = loadPrompt(phase2PromptFileName);

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
