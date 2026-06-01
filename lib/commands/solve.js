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
const { runPostPhase2VerifyLoop } = require('../verify-loop');
const { loadPrompt } = require('../prompt-loader');
const { extractSolutionSummary } = require('../summary-extractor');
const { createUi } = require('../ui');
const { buildSiblingPrDiffsSection } = require('../sibling-pr-diffs');
const { removeCacheFile: removeSiblingPrCacheFile } = require('../sibling-pr-cache');
const os = require('os');

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

/** @typedef {{ emit?: (event: object) => void }} SolveUi */

/**
 * @param {object} config
 * @param {object} options
 * @param {{ ui?: SolveUi }} [deps]
 * @returns {SolveUi}
 */
function createSolveUi(config, options, deps) {
  if (deps && deps.ui) return deps.ui;
  if (options && options.ui) return options.ui;
  if (options && options.silent) return { emit: () => {} };
  return createUi({
    flagPlain: !!(options && options.plain),
    flagTui: !!(options && options.tui),
    debug: !!(options && options.debug),
    config,
    env: process.env,
    stdout: process.stdout,
    stdin: process.stdin
  });
}

/**
 * @template T
 * @param {SolveUi} ui
 * @param {string} taskId
 * @param {string} label
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
async function withTaskEvent(ui, taskId, label, fn) {
  const startedAt = Date.now();
  if (ui && typeof ui.emit === 'function') {
    ui.emit({ type: 'task:start', taskId, label, startedAt, plain: false });
  }
  try {
    const result = await fn();
    const endedAt = Date.now();
    if (ui && typeof ui.emit === 'function') {
      ui.emit({
        type: 'task:finish',
        taskId,
        label,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        success: true,
        plain: false
      });
    }
    return result;
  } catch (err) {
    const endedAt = Date.now();
    if (ui && typeof ui.emit === 'function') {
      ui.emit({
        type: 'task:finish',
        taskId,
        label,
        startedAt,
        endedAt,
        durationMs: endedAt - startedAt,
        success: false,
        plain: false
      });
    }
    throw err;
  }
}

/**
 * Phase 1: Conduct deep research on the issue.
 * @returns {Promise<{ researchContent: string, issueType: string }>}
 */
async function runPhase1Research(issueNumber, issueUrl, researchFile, config, options, ui) {
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
  const result = await withTaskEvent(ui, 'phase1', 'Phase 1: Deep Research', () => runTask(config, {
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
  }));

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
 * @returns {Promise<{ blocked?: boolean, reason?: string }>}
 */
async function runPhase2Solution(issueNumber, issueUrl, analysisFile, researchContent, issueType, config, options, ui) {
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
  await withTaskEvent(ui, 'phase2', issueType === 'GUIDANCE' ? 'Phase 2: Guidance & Explanation' : 'Phase 2: Solution Implementation', () => runTask(config, {
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
  }));

  if (!options.silent) {
    success('Analysis and solution report generated');
    info(`File: ${highlight(analysisFile)}`);
  }

  if (issueType === 'CODE_CHANGE') {
    let verifyLoopResult = null;
    try {
      verifyLoopResult = await withTaskEvent(ui, 'verify-loop', 'Post-Phase 2 verify loop', () =>
        runPostPhase2VerifyLoop({
          issueNumber,
          issueType,
          config,
          options,
          ui,
          prePhase2Head
        })
      );
    } catch (err) {
      warning(`Verify-loop pass crashed: ${err.message}`);
      try {
        if (runGit(config.repoPath, 'git status --porcelain')) {
          const reason = 'verify-loop crashed after leaving uncommitted changes';
          warning(`Skipping rubber-duck and auto-review because ${reason}.`);
          return { blocked: true, reason };
        }
      } catch (_) { /* non-fatal: fall through to existing quality gates */ }
    }
    if (verifyLoopResult && verifyLoopResult.dirty) {
      const reason = 'verify-loop left uncommitted changes in the working tree';
      warning(`Skipping rubber-duck and auto-review because ${reason}.`);
      return { blocked: true, reason };
    }

    // Rubber-duck critique runs BEFORE auto-review. It returns a structured
    // result; the summary print is deferred until AFTER auto-review so it ends
    // up at the bottom of the solve output instead of being scrolled away.
    // NOTE: function intentionally accepts no `options` param — there is no
    // user-side off switch (see docs/RUBBER_DUCK_CRITIQUE_PROPOSAL.md §FR-9).
    let rubberDuckResult = null;
    try {
      rubberDuckResult = await withTaskEvent(ui, 'rubber-duck', 'Rubber-duck critique', () =>
        runPostPhase2RubberDuck(issueNumber, config, prePhase2Head)
      );
    } catch (err) {
      // Belt-and-suspenders: runPostPhase2RubberDuck already downgrades errors
      // to warnings on the result, but we still wrap to guarantee auto-review runs.
      warning(`Rubber-duck pass crashed: ${err.message}`);
    }

    await withTaskEvent(ui, 'auto-review', 'Post-Phase 2 auto-review', () =>
      runPostPhase2AutoReview(issueNumber, config, options, prePhase2Head)
    );

    if (rubberDuckResult) {
      printRubberDuckSummary(rubberDuckResult);
    }
  }
  return { blocked: false };
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
async function cmdSolve(issueNumber, options, deps) {
  options = options || {};
  const config = loadConfig();
  applyAgentCommandOptions(config, options);
  const ui = createSolveUi(config, options || {}, deps || {});
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

  // BS-07 PR-C: per-solve sidecar cache. The MCP `find_similar_issues`
  // skill writes pre-trimmed PR-diff hunks here (from the service's
  // /search response); the post-Phase-1 sibling-pr-diffs orchestrator
  // reads them before falling back to GitHub. Path is propagated to the
  // agent subprocess via lib/agents/env-builder buildAgentEnv()'s
  // baseEnv spread, so all we need to do is set process.env.
  const siblingPrCachePath = path.join(
    os.tmpdir(),
    `ai-issue-sibling-pr-${process.pid}-${issueNumber}.json`
  );
  const previousSiblingPrCacheEnv = process.env.AI_ISSUE_SIBLING_PR_CACHE_PATH;
  process.env.AI_ISSUE_SIBLING_PR_CACHE_PATH = siblingPrCachePath;
  removeSiblingPrCacheFile(siblingPrCachePath);

  try {
    // Phase 1: Deep Research
    const { researchContent, issueType } = await runPhase1Research(
      issueNumber, issueUrl, researchFile, config, options, ui
    );

    // BS-07: For CODE_CHANGE issues, augment researchContent in-memory with
    // sibling-PR diffs parsed from the Phase 1 "Similar Historical Issues"
    // table. Failures are non-fatal — they degrade the prompt, not the run.
    let augmentedResearch = researchContent;
    if (issueType === 'CODE_CHANGE') {
      try {
        const section = await buildSiblingPrDiffsSection({
          researchContent,
          config,
          issueNumber,
          logger: { warning, debug }
        });
        if (section) {
          augmentedResearch = `${researchContent.replace(/\n+$/, '')}\n\n${section}`;
          info('Injected sibling PR diffs into Phase 2 prompt');
        }
      } catch (err) {
        warning(`Skipping sibling PR diff injection: ${err.message}`);
      }
    }

    // Phase 2: Solution Implementation
    const phase2Result = await runPhase2Solution(
      issueNumber, issueUrl, analysisFile, augmentedResearch, issueType, config, options, ui
    );
    if (phase2Result && phase2Result.blocked) {
      const reason = phase2Result.reason || 'Phase 2 blocked by verification';
      warning(`Post-solve push, solved status, summary upload, and evaluation skipped: ${reason}`);
      await reportFailureToPipeline(issueNumber, config, reason);
      return;
    }

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
      await withTaskEvent(ui, 'evaluation', 'Evaluation', () =>
        cmdEvaluate(issueNumber, { ...options, skipHeader: true })
      );
    } else if (!options.silent) {
      log('');
      success('Processing completed! (Evaluation skipped)');
    }

  } catch (err) {
    error(`Execution failed: ${err.message}`);
    await reportFailureToPipeline(issueNumber, config, err.message);
    throw err;
  } finally {
    // Always clean up the sibling-pr-cache sidecar — even on failure —
    // so we never leave per-issue tmpfiles behind across solves.
    removeSiblingPrCacheFile(siblingPrCachePath);
    if (previousSiblingPrCacheEnv === undefined) {
      delete process.env.AI_ISSUE_SIBLING_PR_CACHE_PATH;
    } else {
      process.env.AI_ISSUE_SIBLING_PR_CACHE_PATH = previousSiblingPrCacheEnv;
    }
  }
}

module.exports = {
  cmdSolve,
  _internal: {
    createSolveUi,
    withTaskEvent
  }
};
