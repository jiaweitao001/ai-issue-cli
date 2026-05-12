// @ts-check
/**
 * Solve command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { log, error, success, info, warning, chalk, highlight, debug } = require('../logger');
const { runTask } = require('../agents');
const { applyAgentCommandOptions, resolveAgentCommandSelection, validateTaskModel } = require('../agents/command-options');
const { validateConfiguredAgents } = require('../agents/installation-validator');
const { serviceRequest, getServiceUrl, updateSolutionSummary } = require('../service-client');
const { parseBoolean, parseIssueType, enableDebugIfRequested, getRepoFromConfig } = require('../utils');
const { runGit } = require('../git-utils');
const { isReviewToolInRepo, ensureReviewToolInstalled, runPostPhase2AutoReview, REVIEW_TOOL_REPO_URL, REVIEW_TOOL_INSTALLER_PATH } = require('../review-tool');
const { runPostPhase2RubberDuck, printRubberDuckSummary } = require('../rubber-duck');
const { loadPrompt } = require('../prompt-loader');
const { extractSolutionSummary } = require('../summary-extractor');

/**
 * Check pipeline triage status; return true if processing should be skipped.
 * @param {string} issueNumber
 * @param {object} config
 * @param {object} options
 * @returns {Promise<boolean>}
 */
async function shouldSkipFromPipeline(issueNumber, config, options) {
  if (!getServiceUrl() || options.force) return false;
  try {
    const repo = config.repo || process.env.AI_ISSUE_REPO;
    const { status, data } = await serviceRequest('GET', '/pipeline', null, {
      repo, status: 'triaged', limit: 100,
    });
    if (status === 200 && Array.isArray(data)) {
      const entry = data.find(e => e.issue === parseInt(issueNumber, 10));
      if (entry && (entry.recommendation === 'SKIP' || entry.recommendation === 'NEEDS_HUMAN')) {
        warning(`Issue #${issueNumber} was triaged as ${entry.recommendation}. Use --force to override.`);
        return true;
      }
    }
  } catch {
    debug('Pipeline check skipped (service unavailable)');
  }
  return false;
}

/**
 * Create or switch to the fix branch for an issue.
 * @param {string} issueNumber
 * @param {object} config
 * @returns {string|null} Branch name, or null if branch creation was not requested / failed.
 */
function createFixBranch(issueNumber, config, options) {
  if (!options.branch) return null;
  const branchName = `fix/issue-${issueNumber}`;
  try {
    runGit(config.repoPath, `git checkout -b ${branchName}`);
    info(`Created and switched to branch: ${branchName}`);
    return branchName;
  } catch (err) {
    try {
      runGit(config.repoPath, `git checkout ${branchName}`);
      info(`Switched to existing branch: ${branchName}`);
      return branchName;
    } catch {
      warning(`Failed to create branch ${branchName}: ${err.message}`);
      return null;
    }
  }
}

/**
 * Phase 1: Conduct deep research on the issue.
 * @returns {Promise<{ researchContent: string, issueType: string }>}
 */
async function runPhase1Research(issueNumber, issueUrl, researchFile, config, options) {
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
  const result = await runTask(config, {
    taskType: 'research',
    prompt: researchPrompt,
    repoPath: config.repoPath,
    reportPath: config.reportPath,
    model: resolveAgentCommandSelection(config, 'research').model,
    mcpProfile: 'phase1',
    permissionProfile: 'noninteractive-full-auto',
    gitPolicy: { commitBehavior: 'no-commit' },
    expectedArtifacts: [{
      kind: 'file',
      path: researchFile,
      failureMode: 'throw',
      requiredSection: /^## Problem Classification/m
    }],
    onArtifactWaitProgress: (elapsed) => {
      if (!options.silent) {
        info(`⏳ Waiting for research report... ${elapsed}s elapsed`);
      }
    },
    silent: options.silent,
    debugMode: options.debug
  });

  const researchContent = result.artifacts[researchFile];
  const issueType = parseIssueType(researchContent);

  if (!options.silent) {
    success('Research report generated');
    info(`Type: ${issueType === 'GUIDANCE' ? '📖 GUIDANCE' : '🔧 CODE_CHANGE'}`);
  }

  return { researchContent, issueType };
}

/**
 * Phase 2: Implement solution (or provide guidance) based on research.
 */
async function runPhase2Solution(issueNumber, issueUrl, analysisFile, researchContent, issueType, config, options) {
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

  const solutionPrompt = `${phase2Prompt}

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
  await runTask(config, {
    taskType: 'solution',
    prompt: solutionPrompt,
    repoPath: config.repoPath,
    reportPath: config.reportPath,
    model: resolveAgentCommandSelection(config, 'solution').model,
    mcpProfile: 'phase2',
    permissionProfile: 'noninteractive-full-auto',
    gitPolicy: { commitBehavior: 'may-commit' },
    expectedArtifacts: [{
      kind: 'file',
      path: analysisFile,
      failureMode: 'throw'
    }],
    onArtifactWaitProgress: (elapsed) => {
      if (!options.silent) {
        info(`⏳ Waiting for solution report... ${elapsed}s elapsed`);
      }
    },
    silent: options.silent,
    debugMode: options.debug
  });

  if (!options.silent) {
    success('Analysis and solution report generated');
    info(`File: ${highlight(analysisFile)}`);
  }

  if (issueType === 'CODE_CHANGE') {
    // Rubber-duck critique runs BEFORE auto-review. It returns a structured
    // result; the summary print is deferred until AFTER auto-review so it ends
    // up at the bottom of the solve output instead of being scrolled away.
    // NOTE: function intentionally accepts no `options` param — there is no
    // user-side off switch (see docs/RUBBER_DUCK_CRITIQUE_PROPOSAL.md §FR-9).
    let rubberDuckResult = null;
    try {
      rubberDuckResult = await runPostPhase2RubberDuck(issueNumber, config, prePhase2Head);
    } catch (err) {
      // Belt-and-suspenders: runPostPhase2RubberDuck already downgrades errors
      // to warnings on the result, but we still wrap to guarantee auto-review runs.
      warning(`Rubber-duck pass crashed: ${err.message}`);
    }

    await runPostPhase2AutoReview(issueNumber, config, options, prePhase2Head);

    if (rubberDuckResult) {
      printRubberDuckSummary(rubberDuckResult);
    }
  }
}

/**
 * Post-solve: push branch and report status to pipeline service.
 */
async function reportSolvedToPipeline(issueNumber, branchName, config) {
  if (!getServiceUrl()) return;
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

/**
 * Report failure to pipeline service.
 */
async function reportFailureToPipeline(issueNumber, config, errMessage) {
  if (!getServiceUrl()) return;
  try {
    const repo = getRepoFromConfig(config);
    await serviceRequest('POST', `/pipeline/${repo}/${issueNumber}/failed`, null, {
      error: errMessage,
    });
  } catch (_) { /* non-fatal */ }
}

/**
 * Report solving-in-progress to pipeline service.
 */
async function reportSolvingToPipeline(issueNumber, config) {
  if (!getServiceUrl()) return;
  try {
    const repo = getRepoFromConfig(config);
    await serviceRequest('POST', `/pipeline/${repo}/${issueNumber}/solving`);
    debug('Pipeline status updated to solving');
  } catch {
    debug('Pipeline solving status update failed (non-fatal)');
  }
}

/**
 * Extract solution summary from Phase 2 report and upload to service.
 */
async function reportSolutionSummary(issueNumber, reportPath, config) {
  if (!getServiceUrl()) return;
  try {
    const summary = extractSolutionSummary(reportPath);
    if (!summary) {
      debug('No solution summary extracted (empty report or no solution section)');
      return;
    }
    const repo = getRepoFromConfig(config);
    await updateSolutionSummary(repo, issueNumber, summary);
    debug('Solution summary uploaded');
  } catch {
    debug('Solution summary upload failed (non-fatal)');
  }
}

// Command: solve (Two-Phase Approach)
async function cmdSolve(issueNumber, options) {
  const config = loadConfig();
  applyAgentCommandOptions(config, options);
  try { validateTaskModel(config, 'research'); } catch (_) {}
  validateConfiguredAgents(config, { taskType: 'research' });

  enableDebugIfRequested(options);
  if (options.debug) {
    debug('Debug mode enabled');
    debug(`Options: ${JSON.stringify(options, null, 2)}`);
    debug(`Config: ${JSON.stringify(config, null, 2)}`);
  }

  // Pre-check: skip if pipeline triage says so
  if (await shouldSkipFromPipeline(issueNumber, config, options)) return;

  // Report solving status to pipeline (Trello card: Queued → Solving)
  await reportSolvingToPipeline(issueNumber, config);

  // Pre-check: create fix branch if requested
  const branchName = createFixBranch(issueNumber, config, options);

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
    // Phase 1: Deep Research
    const { researchContent, issueType } = await runPhase1Research(
      issueNumber, issueUrl, researchFile, config, options
    );

    // Phase 2: Solution Implementation
    await runPhase2Solution(
      issueNumber, issueUrl, analysisFile, researchContent, issueType, config, options
    );

    // Post-solve: push branch to fork if requested
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

    await reportSolvedToPipeline(issueNumber, branchName, config);

    // Upload solution summary to service (non-fatal)
    await reportSolutionSummary(issueNumber, analysisFile, config);

    // Clean up temporary research file
    if (fs.existsSync(researchFile)) {
      fs.unlinkSync(researchFile);
    }

    // Evaluation
    if (!options.skipEval) {
      const { cmdEvaluate } = require('./evaluate');
      await cmdEvaluate(issueNumber, { ...options, skipHeader: true });
    } else if (!options.silent) {
      log('');
      success('Processing completed! (Evaluation skipped)');
    }

  } catch (err) {
    error(`Execution failed: ${err.message}`);
    await reportFailureToPipeline(issueNumber, config, err.message);
    throw err;
  }
}

module.exports = {
  cmdSolve
};
