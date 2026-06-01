// @ts-check

const os = require('os');
const { runGit } = require('./git-utils');
const { runTask } = require('./agents');
const { resolveAgentCommandSelection } = require('./agents/command-options');
const { info, warning, debug } = require('./logger');
const { getAllGates } = require('./verify/gate-registry');
const { shouldRunForPaths } = require('./verify/path-filter');
const { detectAzurermRepo } = require('./verify/repo-detector');
const { detectSupportedPlatform } = require('./verify/platform-detector');
const { collectToolPreflight } = require('./verify/tools-bootstrap');
const { runGate } = require('./verify/gate-runner');
const { runWithConcurrency } = require('./verify/parallel-runner');
const { loadPrompt } = require('./prompt-loader');

/** @type {import('./types').VerifyLoopOptions} */
const DEFAULT_VERIFY_LOOP = {
  enabled: true,
  maxAttempts: 3,
  phaseATimeoutSec: 1800,
  phaseBTimeoutSec: 2400,
  parallelism: 'auto',
  skipGates: []
};

/**
 * @param {import('./types').Config} config
 * @returns {import('./types').VerifyLoopOptions}
 */
function resolveVerifyLoopOptions(config) {
  return {
    ...DEFAULT_VERIFY_LOOP,
    ...(config && config.verifyLoop && typeof config.verifyLoop === 'object' ? config.verifyLoop : {})
  };
}

/**
 * @param {string} repoPath
 * @param {string} prePhase2Head
 * @returns {string[]}
 */
function listChangedFiles(repoPath, prePhase2Head) {
  const output = runGit(repoPath, `git diff --name-only ${prePhase2Head}..HEAD`);
  return output.split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * @param {import('./types').VerifyLoopOptions} options
 * @returns {number}
 */
function resolveParallelism(options) {
  if (options.parallelism === 'auto') {
    return Math.min(os.cpus().length * 2, 16);
  }
  return Math.max(1, Number(options.parallelism) || 1);
}

/**
 * @param {import('./types').VerifyGateResult[]} failures
 * @param {string} issueNumber
 * @param {string} repoPath
 * @param {string} prePhase2Head
 * @returns {string}
 */
function buildVerifyFixPrompt(failures, issueNumber, repoPath, prePhase2Head) {
  let template = '';
  try {
    template = loadPrompt('PHASE2_VERIFY_FIX_PROMPT.md');
  } catch (_err) {
    template = 'Fix the HashiCorp PR-CI gate failures below with a minimal correction commit.';
  }
  const sections = failures.map(failure => {
    const generated = failure.generatedDiff
      ? `\n\n**Captured generated/vendor diff before cleanup:**\n\`\`\`diff\n${failure.generatedDiff}\n\`\`\``
      : '';
    return `## Gate: ${failure.gateId}

**Failure guidance (verbatim from CI workflow):**
${failure.guidance}

**Captured failure (tail 8 KB):**
\`\`\`text
${failure.output || '(no output captured)'}
\`\`\`${generated}`;
  }).join('\n\n');

  return `${template}

---

**Issue Number**: ${issueNumber}
**Repository Path**: ${repoPath}
**Diff range**: ${prePhase2Head}..HEAD

${sections}

Read \`git diff ${prePhase2Head}..HEAD\` for context, then produce a minimal correction commit addressing ALL failures above. Do NOT revert unrelated parts of the previous attempt.
`;
}

/**
 * @param {string} repoPath
 * @param {import('./types').VerifyGate[]} gates
 * @param {number} timeoutSec
 * @returns {Promise<import('./types').VerifyGateResult[]>}
 */
async function runPhaseA(repoPath, gates, timeoutSec) {
  const results = [];
  for (const gate of gates) {
    const result = await runGate(repoPath, gate, gate.timeoutSec || timeoutSec);
    results.push(result);
    if (!result.passed) break;
  }
  return results;
}

/**
 * @param {string} repoPath
 * @param {import('./types').VerifyGate[]} gates
 * @param {number} timeoutSec
 * @param {number} parallelism
 * @returns {Promise<import('./types').VerifyGateResult[]>}
 */
async function runPhaseB(repoPath, gates, timeoutSec, parallelism) {
  const heavy = gates.filter(g => g.heavy);
  const light = gates.filter(g => !g.heavy);
  const heavyResults = await runWithConcurrency(heavy, 1, gate => runGate(repoPath, gate, gate.timeoutSec || timeoutSec));
  const lightResults = await runWithConcurrency(light, parallelism, gate => runGate(repoPath, gate, gate.timeoutSec || timeoutSec));
  return [...heavyResults, ...lightResults];
}

/**
 * @param {import('./types').VerifyGateResult[]} results
 * @returns {import('./types').VerifyGateResult[]}
 */
function failuresOf(results) {
  return results.filter(result => !result.passed);
}

/**
 * @param {import('./types').VerifyGateResult[]} results
 * @returns {boolean}
 */
function hasDirtyPreconditionSkip(results) {
  return results.some(result => result.skipped);
}

/**
 * @param {import('./types').VerifyGateResult[]} results
 */
function logGateResults(results) {
  for (const result of results) {
    const seconds = (result.durationMs / 1000).toFixed(1);
    if (result.passed) {
      info(`verify-loop gate passed: ${result.gateId} (${seconds}s)`);
    } else if (result.skipped) {
      warning(`verify-loop gate skipped: ${result.gateId} (${result.output})`);
    } else {
      warning(`verify-loop gate failed: ${result.gateId} (${seconds}s)`);
    }
  }
}

/**
 * @param {{ issueNumber: string, issueType: string, config: import('./types').Config, options?: object, ui?: object, prePhase2Head: string }} args
 * @returns {Promise<import('./types').VerifyLoopResult>}
 */
async function runPostPhase2VerifyLoop(args) {
  const { issueNumber, issueType, config, prePhase2Head } = args;
  const startedAt = Date.now();
  const repoPath = config.repoPath;
  const options = resolveVerifyLoopOptions(config);
  const warnings = [];

  if (issueType !== 'CODE_CHANGE') {
    return { passed: true, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
  }
  if (!options.enabled) {
    warnings.push('verify-loop disabled by config.verifyLoop.enabled=false');
    return { passed: true, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
  }
  if (!prePhase2Head) {
    warnings.push('verify-loop skipped: pre-Phase 2 HEAD unavailable');
    return { passed: false, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
  }

  const platform = detectSupportedPlatform();
  if (!platform.supported) {
    warnings.push(platform.reason || 'verify-loop skipped: unsupported platform');
    return { passed: true, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
  }
  const repo = detectAzurermRepo(repoPath);
  if (!repo.supported) {
    warnings.push(repo.reason || 'verify-loop skipped: unsupported repository');
    return { passed: true, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
  }
  if (runGit(repoPath, 'git status --porcelain')) {
    warnings.push('verify-loop skipped: working tree is dirty before verification');
    return { passed: false, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt, dirty: true };
  }
  const currentHead = runGit(repoPath, 'git rev-parse HEAD');
  if (currentHead === prePhase2Head) {
    warnings.push('verify-loop skipped: Phase 2 produced no commit');
    return { passed: true, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
  }

  const preflight = collectToolPreflight();
  warnings.push(...preflight.warnings);
  warnings.forEach(message => warning(message));

  const changedFiles = listChangedFiles(repoPath, prePhase2Head);
  const skipGates = new Set(options.skipGates || []);
  const selected = getAllGates()
    .filter(gate => !skipGates.has(gate.id))
    .filter(gate => shouldRunForPaths(changedFiles, gate.paths));
  if (selected.length === 0) {
    warnings.push('verify-loop skipped: no PR-CI gates matched changed files');
    return { passed: true, skipped: true, attempts: 0, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
  }

  const phaseA = selected.filter(gate => gate.phase === 'A');
  const phaseB = selected.filter(gate => gate.phase === 'B');
  const parallelism = resolveParallelism(options);
  let finalFailures = [];
  let attempt = 0;

  for (attempt = 1; attempt <= options.maxAttempts; attempt++) {
    info(`verify-loop attempt ${attempt}/${options.maxAttempts}: running ${selected.length} gate(s)`);
    const phaseAResults = await runPhaseA(repoPath, phaseA, options.phaseATimeoutSec);
    logGateResults(phaseAResults);
    if (hasDirtyPreconditionSkip(phaseAResults)) {
      warnings.push('verify-loop stopped: working tree became dirty before a Phase A gate');
      return { passed: false, skipped: false, attempts: attempt, finalFailures: phaseAResults, warnings, durationMs: Date.now() - startedAt, dirty: true };
    }
    finalFailures = failuresOf(phaseAResults);
    if (finalFailures.length === 0) {
      const phaseBResults = await runPhaseB(repoPath, phaseB, options.phaseBTimeoutSec, parallelism);
      logGateResults(phaseBResults);
      if (hasDirtyPreconditionSkip(phaseBResults)) {
        warnings.push('verify-loop stopped: working tree became dirty before a Phase B gate');
        return { passed: false, skipped: false, attempts: attempt, finalFailures: phaseBResults, warnings, durationMs: Date.now() - startedAt, dirty: true };
      }
      finalFailures = failuresOf(phaseBResults);
    }
    if (finalFailures.length === 0) {
      return { passed: true, skipped: false, attempts: attempt, finalFailures: [], warnings, durationMs: Date.now() - startedAt };
    }
    if (attempt === options.maxAttempts) break;

    const prompt = buildVerifyFixPrompt(finalFailures, issueNumber, repoPath, prePhase2Head);
    debug(`verify-loop retry prompt contains ${finalFailures.length} failed gate(s)`);
    try {
      await runTask(config, {
        taskType: 'verify_fix',
        prompt,
        repoPath,
        reportPath: config.reportPath,
        model: resolveAgentCommandSelection(config, 'verify_fix').model,
        mcpProfile: 'phase2',
        permissionProfile: 'noninteractive-full-auto',
        gitPolicy: { commitBehavior: 'may-commit' },
        expectedArtifacts: [],
        silent: !!(args.options && args.options.silent),
        debugMode: !!(args.options && args.options.debug)
      });
    } catch (err) {
      if (runGit(repoPath, 'git status --porcelain')) {
        warnings.push(`verify-loop retry crashed and left working tree dirty: ${err.message}`);
        return { passed: false, skipped: false, attempts: attempt, finalFailures, warnings, durationMs: Date.now() - startedAt, dirty: true };
      }
      throw err;
    }

    if (runGit(repoPath, 'git status --porcelain')) {
      warnings.push('verify-loop retry left working tree dirty; stopping verification before rubber-duck');
      warning('verify-loop retry left working tree dirty; downstream rubber-duck/auto-review will be skipped to avoid losing uncommitted fixes.');
      return { passed: false, skipped: false, attempts: attempt, finalFailures, warnings, durationMs: Date.now() - startedAt, dirty: true };
    }
  }

  warning(`verify-loop exhausted with ${finalFailures.length} failing gate(s); continuing to rubber-duck and auto-review.`);
  return { passed: false, skipped: false, attempts: attempt, finalFailures, warnings, durationMs: Date.now() - startedAt };
}

module.exports = {
  DEFAULT_VERIFY_LOOP,
  resolveVerifyLoopOptions,
  listChangedFiles,
  resolveParallelism,
  buildVerifyFixPrompt,
  runPostPhase2VerifyLoop
};
