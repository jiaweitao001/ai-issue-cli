// @ts-check
/**
 * Post-Phase 2 Rubber-Duck Critique Pass
 *
 * Always-on, always auto-fix (high+medium) quality gate inserted between Phase 2
 * commit and `runPostPhase2AutoReview`. Runs an independent Copilot critique that
 * looks for implicit-convention violations (helper reuse, naming, established
 * patterns), then a separate Copilot fix call. The CLI owns commit creation
 * (mandated message + Co-authored-by trailer); pre-existing dirty working tree
 * is stashed and restored around the pass; critique reports are excluded from
 * the rubber-duck commit even when reportPath sits inside the repo.
 *
 * **Concurrency assumption**: The repo `HEAD` is only advanced by this process
 * during `runPhase2Solution`. If `batch` mode ever runs concurrent solves on the
 * same `repoPath`, `prePhase2Head..HEAD` ranges will interleave across issues
 * and rubber-duck (and Phase 2 commit / auto-review) will operate on the wrong
 * code. This is a pre-existing `solve` invariant, not introduced here; see
 * §3.7 / §8.1 of docs/RUBBER_DUCK_CRITIQUE_PROPOSAL.md.
 *
 * **No-backdoor guarantee**: function signatures intentionally omit any options
 * param that could disable execution. Critique runs whenever
 * `shouldRunRubberDuck` returns true; the only short-circuits are non-CODE_CHANGE
 * issues, missing/equal HEADs, and runtime errors (which are non-blocking).
 *
 * @typedef {import('./types').Config} Config
 * @typedef {{
 *   id: string,
 *   severity: 'high'|'medium'|'low',
 *   category: 'reuse'|'naming'|'pattern',
 *   file: string,
 *   line: number,
 *   title: string,
 *   evidence: { file: string, line: number, snippet?: string },
 *   suggestedFix?: string
 * }} Finding
 * @typedef {{
 *   counts: { high: number, medium: number, low: number, dropped: number },
 *   reportPath: string,
 *   autoFixStatus: 'applied'|'skipped-no-findings'|'skipped-parse-error'|'ran-no-changes'|'failed'|'critique-skipped',
 *   commitHash: string|null,
 *   topFinding: {
 *     severity: string, category: string, file: string, line: number,
 *     title: string, evidenceFile: string, evidenceLine: number
 *   } | null,
 *   warnings: string[]
 * }} RubberDuckResult
 */

const fs = require('fs');
const path = require('path');
const { log, info, success, warning, chalk, debug } = require('./logger');
const { runGit, runGitArgs } = require('./git-utils');
const { runTask } = require('./agents');
const { loadPrompt } = require('./prompt-loader');

/**
 * Decide whether the rubber-duck pass should run.
 *
 * Signature deliberately accepts NO options/config that could disable execution.
 * The only legitimate short-circuits are: not a code change, no pre-image of
 * HEAD, or Phase 2 produced no commit (nothing to critique).
 *
 * @param {string} issueType
 * @param {string} prePhase2Head
 * @param {string} currentHead
 * @returns {boolean}
 */
function shouldRunRubberDuck(issueType, prePhase2Head, currentHead) {
  if (issueType !== 'CODE_CHANGE') return false;
  if (!prePhase2Head) return false;
  if (!currentHead) return false;
  if (prePhase2Head === currentHead) return false;
  return true;
}

/**
 * Build the critique prompt by composing the static template with runtime context.
 * @param {string} issueNumber
 * @param {Config} config
 * @param {string} reportFile - Absolute path where Copilot must write the report
 * @param {string} prePhase2Head
 * @param {string} currentHead
 */
function buildCritiquePrompt(issueNumber, config, reportFile, prePhase2Head, currentHead) {
  const template = loadPrompt('RUBBER_DUCK_CRITIQUE_PROMPT.md');
  return `${template}

---

**Issue Number**: ${issueNumber}
**Repository Path**: ${config.repoPath}
**Diff range**: ${prePhase2Head}..${currentHead}
**Report destination (write here, exact path)**: ${reportFile}

Workflow reminder:
1. \`git diff ${prePhase2Head}..HEAD --stat\`
2. For each changed file, \`git diff ${prePhase2Head}..HEAD -- <file>\`
3. For each non-trivial change, glob/grep for existing analogues BEFORE writing a finding
4. Apply the Evidence Rule strictly; drop any finding without a concrete in-repo example
5. Write the report at the exact path above (READ-ONLY: do not modify any other file)

Start the critique now.
`;
}

/**
 * Build the fix prompt by composing the static template with runtime context.
 *
 * The full critique report content is embedded inline so the fix Copilot
 * doesn't need to read the report file from disk. This matters when the
 * pre-fix `git stash push -u` later sweeps the report into a stash (which
 * happens when `reportPath` sits inside `repoPath` and the report is
 * untracked). Embedding here decouples the fix step from disk state.
 *
 * @param {string} issueNumber
 * @param {Config} config
 * @param {string} reportFile - Absolute path of the critique report (for reference only)
 * @param {string} reportContent - Full critique report markdown (already read into memory)
 */
function buildFixPrompt(issueNumber, config, reportFile, reportContent) {
  const template = loadPrompt('RUBBER_DUCK_FIX_PROMPT.md');
  const inlinedReport = reportContent
    ? `\n\n## Critique Report (inlined for reference)\n\n${reportContent}\n`
    : '';
  return `${template}

---

**Issue Number**: ${issueNumber}
**Repository Path**: ${config.repoPath}
**Critique report (on disk; may be temporarily stashed during this call)**: ${reportFile}

Use the JSON block in the inlined critique report below to drive your fixes
(high+medium severity only). **Do NOT commit** — leave changes in the working
tree; the CLI will create the commit with a mandated message.${inlinedReport}
`;
}

/**
 * Parse the machine-readable JSON block from the critique report.
 *
 * The block must use the fenced info-string ` ```json rubber-duck-findings`
 * (literal tag separated by one space). This dedicated tag prevents collisions
 * with any incidental ` ```json` blocks in the human-readable section.
 *
 * Returns `{ findings, dropped }` on success or `{ parseError }` on failure /
 * missing block. Findings missing the mandatory `evidence.file` /
 * `evidence.line` / valid severity / valid category are silently dropped (added
 * to the `droppedCount` total) so a single bad finding doesn't sink the whole
 * report.
 *
 * @param {string} reportPath
 * @returns {{ findings?: Finding[], droppedCount?: number, parseError?: string }}
 */
function parseFindingsJsonBlock(reportPath) {
  if (!fs.existsSync(reportPath)) {
    return { parseError: `Report file not found: ${reportPath}` };
  }
  let content;
  try {
    content = fs.readFileSync(reportPath, 'utf8');
  } catch (err) {
    return { parseError: `Failed to read report: ${err.message}` };
  }

  // Match ```json rubber-duck-findings\n<json>\n```
  // Use [\s\S] so . spans newlines; non-greedy to stop at the first closing fence.
  // Reject reports with multiple such blocks — Copilot occasionally emits a
  // malformed first block followed by a corrected second; preferring the first
  // would silently use stale data, preferring the second is also surprising.
  // Forcing a single block keeps the contract explicit.
  const blockRegex = /```json rubber-duck-findings\s*\n([\s\S]*?)\n```/g;
  const matches = Array.from(content.matchAll(blockRegex));
  if (matches.length === 0) {
    return { parseError: 'Findings JSON block (```json rubber-duck-findings) not found in report' };
  }
  if (matches.length > 1) {
    return { parseError: `Found ${matches.length} findings JSON blocks; expected exactly one` };
  }
  const match = matches[0];

  let parsed;
  try {
    parsed = JSON.parse(match[1]);
  } catch (err) {
    return { parseError: `Findings JSON block is not valid JSON: ${err.message}` };
  }

  if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.findings)) {
    return { parseError: 'Findings JSON block missing required `findings` array' };
  }

  const validSeverity = new Set(['high', 'medium', 'low']);
  const validCategory = new Set(['reuse', 'naming', 'pattern']);

  let droppedCount = Array.isArray(parsed.dropped) ? parsed.dropped.length : 0;
  const findings = [];
  for (const f of parsed.findings) {
    if (
      !f || typeof f !== 'object' ||
      !validSeverity.has(f.severity) ||
      !validCategory.has(f.category) ||
      typeof f.file !== 'string' || !f.file ||
      typeof f.line !== 'number' ||
      !f.evidence || typeof f.evidence !== 'object' ||
      typeof f.evidence.file !== 'string' || !f.evidence.file ||
      typeof f.evidence.line !== 'number'
    ) {
      droppedCount += 1;
      continue;
    }
    findings.push(f);
  }

  return { findings, droppedCount };
}

/**
 * Pick the first high-severity finding for the terminal summary "top finding" hook.
 * Returns null if no high finding exists.
 * @param {Finding[]} findings
 */
function pickTopFinding(findings) {
  const top = findings.find(f => f.severity === 'high');
  if (!top) return null;
  return {
    severity: top.severity,
    category: top.category,
    file: top.file,
    line: top.line,
    title: top.title || '',
    evidenceFile: top.evidence.file,
    evidenceLine: top.evidence.line
  };
}

/**
 * Render the commit-message body listing each high/medium finding on one line.
 * Format: `- [severity category] file:line — short title`
 * @param {Finding[]} findings
 */
function renderFindingList(findings) {
  return findings
    .filter(f => f.severity === 'high' || f.severity === 'medium')
    .map(f => `- [${f.severity} ${f.category}] ${f.file}:${f.line} — ${f.title || '(no title)'}`)
    .join('\n');
}

/**
 * Parse `git status --porcelain=v1 -z` output (NUL-terminated, no quoting).
 *
 * Each entry begins with a 2-character status (XY) + space + path; renames /
 * copies (`R`/`C`) consume an extra NUL-terminated record for the source path.
 * We always take the *new* path. Entries with status `!!` (ignored) are skipped
 * for safety though `git status --porcelain` should not return them by default.
 *
 * @param {string} z - raw stdout from `git status --porcelain=v1 -z`
 * @returns {string[]} relative paths with any working-tree or index difference vs HEAD
 */
function parseStatusZ(z) {
  if (!z) return [];
  const tokens = z.split('\0');
  const paths = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    // tok format: "XY <path>" — first 2 chars are status, then a space, then the path.
    if (tok.length < 4) continue;
    const status = tok.substring(0, 2);
    const p = tok.substring(3);
    if (status === '!!') continue; // ignored files (defensive)
    if (status[0] === 'R' || status[0] === 'C') {
      // Rename/Copy uses two records: NEW path is in current token, OLD path in next.
      paths.push(p);
      i += 1; // skip the source-path record
    } else {
      paths.push(p);
    }
  }
  return paths;
}

/**
 * Like `parseStatusZ` but also returns the 2-char status prefix per entry.
 * Used for distinguishing untracked (`??`) from tracked-modified during
 * surgical critique-drift cleanup.
 *
 * @param {string} z
 * @returns {{status: string, path: string}[]}
 */
function parseStatusZWithStatus(z) {
  if (!z) return [];
  const tokens = z.split('\0');
  const out = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (!tok) continue;
    if (tok.length < 4) continue;
    const status = tok.substring(0, 2);
    const p = tok.substring(3);
    if (status === '!!') continue;
    if (status[0] === 'R' || status[0] === 'C') {
      out.push({ status, path: p });
      i += 1;
    } else {
      out.push({ status, path: p });
    }
  }
  return out;
}

/**
 * Decide whether a working-tree path lies under the (absolute) reportPath.
 * Used to exclude critique reports from the rubber-duck commit even when the
 * user has configured `reportPath` to live inside `repoPath`.
 *
 * @param {string} repoPath
 * @param {string} reportPath
 * @param {string} relPath - path relative to repoPath (from `git status`)
 */
function isUnderReportPath(repoPath, reportPath, relPath) {
  if (!reportPath) return false;
  const absRepo = path.resolve(repoPath);
  const absReport = path.resolve(reportPath);
  const absFile = path.resolve(absRepo, relPath);
  // path.relative gives '..' or absolute path when outside; use prefix check instead.
  const rel = path.relative(absReport, absFile);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * Run the post-Phase 2 rubber-duck critique pass.
 *
 * Returns a structured result for the caller (`runPhase2Solution`) to print AFTER
 * `runPostPhase2AutoReview`, so the rubber-duck summary stays at the bottom of the
 * solve output rather than being scrolled away by auto-review noise.
 *
 * Failure modes are non-blocking: any thrown error from runCopilot, git, or the
 * filesystem is downgraded to a `warnings` entry on the result. Auto-review
 * still runs.
 *
 * @param {string} issueNumber
 * @param {Config} config
 * @param {string} prePhase2Head - HEAD recorded before Phase 2 started
 * @returns {Promise<RubberDuckResult>}
 */
async function runPostPhase2RubberDuck(issueNumber, config, prePhase2Head) {
  const repoPath = config.repoPath;
  const reportFile = path.join(config.reportPath, `issue-${issueNumber}-rubber-duck-critique.md`);

  // Defensive short-circuit: if we don't have a pre-image of HEAD, there's
  // nothing to compare against. Return null so the caller skips the summary.
  if (!prePhase2Head) return null;

  /** @type {RubberDuckResult} */
  const result = {
    counts: { high: 0, medium: 0, low: 0, dropped: 0 },
    reportPath: reportFile,
    autoFixStatus: 'critique-skipped',
    commitHash: null,
    topFinding: null,
    warnings: []
  };

  // ── 1. Header + critique pre-flight ─────────────────────────────────────
  let currentHead = '';
  try {
    currentHead = runGit(repoPath, 'git rev-parse HEAD');
  } catch (err) {
    // Cannot read HEAD at all → silently skip rather than print a noisy header.
    return null;
  }

  // No Phase 2 commit → nothing to critique. Skip silently.
  if (!currentHead || currentHead === prePhase2Head) return null;

  log('');
  log(chalk.bold.yellow('🦆 Post-Phase2: Rubber-Duck Critique'));
  log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  let critiqueStartBranch = '';
  try {
    critiqueStartBranch = runGit(repoPath, 'git rev-parse --abbrev-ref HEAD');
  } catch (err) {
    result.warnings.push(`Cannot read current branch before critique: ${err.message}`);
    return result;
  }

  // Snapshot pre-critique working-tree state so we can detect Copilot drift below.
  // Use porcelain=v1 -z (NUL-delimited, no quoting) so we can do a stable
  // path-set diff and exclude legitimate critique writes (under reportPath).
  let preCritiqueStatusZ = '';
  try {
    preCritiqueStatusZ = runGitArgs(repoPath, ['status', '--porcelain=v1', '-z']);
  } catch (err) {
    result.warnings.push(`Cannot inspect working tree before critique: ${err.message}`);
    return result;
  }

  // ── 2. Run critique (READ-ONLY) ─────────────────────────────────────────
  info('Running rubber-duck critique on Phase 2 changes...');
  let critiqueTaskResult = null;
  try {
    const critiquePrompt = buildCritiquePrompt(issueNumber, config, reportFile, prePhase2Head, currentHead);
    critiqueTaskResult = await runTask(config, {
      taskType: 'rubber_duck_critique',
      prompt: critiquePrompt,
      repoPath: config.repoPath,
      reportPath: config.reportPath,
      model: config.model,
      mcpProfile: 'phase2',
      permissionProfile: 'read-only',
      gitPolicy: { commitBehavior: 'forbid-commit' },
      expectedArtifacts: [{
        kind: 'file',
        path: reportFile,
        failureMode: 'warn'
      }],
      silent: false,
      debugMode: process.env.AI_ISSUE_DEBUG === 'true'
    });
    if (critiqueTaskResult && Array.isArray(critiqueTaskResult.warnings)) {
      result.warnings.push(...critiqueTaskResult.warnings);
    }
  } catch (err) {
    result.warnings.push(`Critique step failed: ${err.message}`);
    // Even if the critique call failed, working tree may have been touched;
    // verify and clean up below before returning.
  }

  // ── 3. Verify critique was READ-ONLY (HEAD/branch/working-tree unchanged) ──
  try {
    const postBranch = runGit(repoPath, 'git rev-parse --abbrev-ref HEAD');
    const postHead = runGit(repoPath, 'git rev-parse HEAD');
    if (postBranch !== critiqueStartBranch || postHead !== currentHead) {
      result.warnings.push(
        `Critique step violated READ-ONLY: HEAD/branch drifted ` +
        `(${critiqueStartBranch}@${currentHead.substring(0,7)} -> ${postBranch}@${postHead.substring(0,7)}); ` +
        `restoring`
      );
      try {
        if (postBranch !== critiqueStartBranch) {
          runGitArgs(repoPath, ['checkout', critiqueStartBranch]);
        }
        runGitArgs(repoPath, ['reset', '--hard', currentHead]);
      } catch (restoreErr) {
        result.warnings.push(`Failed to restore HEAD/branch after critique drift: ${restoreErr.message}`);
      }
    }

    // Compute critique drift via PATH-SET diff (not raw string compare):
    //   drifted = (post_paths \ pre_paths) \ paths_under_reportPath
    // This correctly classifies the critique writing its own report file as
    // legitimate (not drift), and avoids broad-stashing pre-existing dirty
    // state when Copilot edits something it shouldn't have.
    let postCritiqueEntries = [];
    try {
      const postCritiqueStatusZ = runGitArgs(repoPath, ['status', '--porcelain=v1', '-z']);
      postCritiqueEntries = parseStatusZWithStatus(postCritiqueStatusZ);
    } catch (err) {
      result.warnings.push(`Cannot inspect working tree after critique: ${err.message}`);
    }

    const prePaths = new Set(parseStatusZ(preCritiqueStatusZ));
    const driftedEntries = postCritiqueEntries.filter(e =>
      !prePaths.has(e.path) && !isUnderReportPath(repoPath, config.reportPath, e.path)
    );

    if (driftedEntries.length > 0) {
      result.warnings.push(
        `Critique step modified ${driftedEntries.length} file(s) outside reportPath; discarding those changes`
      );
      // Surgical cleanup: only discard the unauthorized paths. Use
      // pathspec-scoped `git stash push -u -- <paths>` + `git stash drop` so
      // pre-existing dirty state and the critique report itself are untouched.
      try {
        const driftedPaths = driftedEntries.map(e => e.path);
        runGitArgs(repoPath, [
          'stash', 'push', '-u',
          '-m', 'ai-issue: discard rubber-duck critique drift',
          '--',
          ...driftedPaths
        ]);
        runGit(repoPath, 'git stash drop');
      } catch (stashErr) {
        result.warnings.push(`Failed to discard critique drift: ${stashErr.message}`);
      }
    }
  } catch (err) {
    result.warnings.push(`Could not verify critique invariants: ${err.message}`);
  }

  // ── 4. Parse findings ───────────────────────────────────────────────────
  if (!critiqueTaskResult || !critiqueTaskResult.artifacts || !critiqueTaskResult.artifacts[reportFile]) {
    result.warnings.push(`Critique report not generated at ${reportFile}`);
    return result;
  }

  // Read the report into memory NOW so the fix prompt can embed it inline.
  // After the pre-fix `git stash push -u` runs below, the on-disk report may
  // be temporarily moved into a stash (when reportPath sits inside repoPath
  // and the report is untracked). Inlining decouples the fix prompt from the
  // post-stash filesystem state.
  let reportContent = '';
  try {
    reportContent = fs.readFileSync(reportFile, 'utf8');
  } catch (err) {
    result.warnings.push(`Cannot read critique report: ${err.message}`);
    return result;
  }

  const parseRes = parseFindingsJsonBlock(reportFile);
  if (parseRes.parseError) {
    result.warnings.push(`Findings JSON parse failed: ${parseRes.parseError}`);
    result.autoFixStatus = 'skipped-parse-error';
    return result;
  }

  const findings = parseRes.findings || [];
  result.counts.dropped = parseRes.droppedCount || 0;
  for (const f of findings) {
    result.counts[f.severity] += 1;
  }
  result.topFinding = pickTopFinding(findings);

  const fixable = findings.filter(f => f.severity === 'high' || f.severity === 'medium');
  if (fixable.length === 0) {
    result.autoFixStatus = 'skipped-no-findings';
    info(`Critique done — ${result.counts.low} low, ${result.counts.dropped} dropped, no high/medium findings`);
    return result;
  }

  info(`Critique done — ${result.counts.high} high, ${result.counts.medium} medium, ${result.counts.low} low, ${result.counts.dropped} dropped`);

  // ── 5. Stash any pre-existing dirty working tree ────────────────────────
  let preFixDirty = '';
  try {
    preFixDirty = runGit(repoPath, 'git status --porcelain');
  } catch (err) {
    result.warnings.push(`Cannot inspect working tree before fix: ${err.message}`);
    result.autoFixStatus = 'failed';
    return result;
  }

  let stashed = false;
  if (preFixDirty) {
    try {
      runGit(repoPath, 'git stash push -u -m "ai-issue: pre-rubber-duck stash"');
      stashed = true;
      debug('Stashed pre-existing dirty state before rubber-duck fix');
    } catch (err) {
      result.warnings.push(`Failed to stash pre-existing dirty state: ${err.message}`);
      result.autoFixStatus = 'failed';
      return result;
    }
  }

  // ── 6. Snapshot fix-start state for invariant checks ────────────────────
  let fixStartHead = '';
  let fixStartBranch = '';
  try {
    fixStartHead = runGit(repoPath, 'git rev-parse HEAD');
    fixStartBranch = runGit(repoPath, 'git rev-parse --abbrev-ref HEAD');
  } catch (err) {
    result.warnings.push(`Cannot snapshot HEAD/branch before fix: ${err.message}`);
    if (stashed) tryStashPop(repoPath, result);
    result.autoFixStatus = 'failed';
    return result;
  }

  // ── 7. Run fix Copilot ──────────────────────────────────────────────────
  info('Applying high+medium critique findings...');
  try {
    const fixPrompt = buildFixPrompt(issueNumber, config, reportFile, reportContent);
    await runTask(config, {
      taskType: 'rubber_duck_fix',
      prompt: fixPrompt,
      repoPath: config.repoPath,
      reportPath: config.reportPath,
      model: config.model,
      mcpProfile: 'phase2',
      permissionProfile: 'noninteractive-full-auto',
      gitPolicy: { commitBehavior: 'may-commit' },
      expectedArtifacts: [],
      silent: false,
      debugMode: process.env.AI_ISSUE_DEBUG === 'true'
    });
  } catch (err) {
    result.warnings.push(`Fix step failed: ${err.message}`);
    cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
    result.autoFixStatus = 'failed';
    return result;
  }

  // ── 8. Verify branch/HEAD invariants; recover from Copilot self-commit ──
  let postBranch = '';
  let postHead = '';
  try {
    postBranch = runGit(repoPath, 'git rev-parse --abbrev-ref HEAD');
    postHead = runGit(repoPath, 'git rev-parse HEAD');
  } catch (err) {
    result.warnings.push(`Cannot read HEAD/branch after fix: ${err.message}`);
    cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
    result.autoFixStatus = 'failed';
    return result;
  }

  if (postBranch !== fixStartBranch) {
    result.warnings.push(
      `Fix step switched branch ${fixStartBranch} -> ${postBranch}; aborting`
    );
    cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
    result.autoFixStatus = 'failed';
    return result;
  }

  if (postHead !== fixStartHead) {
    // Copilot self-committed. Reset --mixed to put its changes back in the
    // working tree (unstaged), then run the unified selective-staging path
    // below. This still satisfies the proposal intent (CLI takes over commit
    // creation with the mandated message); --mixed unifies the two code paths
    // (Copilot edited only vs Copilot edited + committed) so reportPath
    // exclusion logic doesn't have to be duplicated for the index case.
    warning('Fix step created its own commit(s); CLI will recommit with the mandated message');
    try {
      runGitArgs(repoPath, ['reset', '--mixed', fixStartHead]);
    } catch (err) {
      result.warnings.push(`Failed to reset to fixStartHead after Copilot self-commit: ${err.message}`);
      cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
      result.autoFixStatus = 'failed';
      return result;
    }
  }

  // ── 9. Selective staging (exclude reportPath subtree) ───────────────────
  let statusZ = '';
  try {
    statusZ = runGitArgs(repoPath, ['status', '--porcelain=v1', '-z']);
  } catch (err) {
    result.warnings.push(`Cannot inspect working tree after fix: ${err.message}`);
    cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
    result.autoFixStatus = 'failed';
    return result;
  }

  const allChangedPaths = parseStatusZ(statusZ);
  const filesToStage = allChangedPaths.filter(p => !isUnderReportPath(repoPath, config.reportPath, p));

  if (allChangedPaths.length === 0) {
    if (stashed) tryStashPop(repoPath, result);
    result.autoFixStatus = 'ran-no-changes';
    info('Rubber-duck fix produced no working-tree changes');
    return result;
  }

  if (filesToStage.length === 0) {
    // All changes were inside reportPath; nothing legitimate to commit.
    // Discard those edits so they don't leak into auto-review.
    cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
    result.autoFixStatus = 'ran-no-changes';
    result.warnings.push('Fix only touched files inside reportPath; nothing committed');
    return result;
  }

  // ── 10. Stage + commit with execFileSync (NEVER shell-string commit) ───
  try {
    runGitArgs(repoPath, ['add', '--', ...filesToStage]);
  } catch (err) {
    result.warnings.push(`git add failed: ${err.message}`);
    cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
    result.autoFixStatus = 'failed';
    return result;
  }

  const title = `Apply rubber-duck critique fixes for #${issueNumber}`;
  const body = renderFindingList(findings);
  const trailer = 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>';

  try {
    runGitArgs(repoPath, [
      'commit',
      '-m', title,
      '-m', body,
      '-m', trailer
    ]);
  } catch (err) {
    result.warnings.push(`git commit failed: ${err.message}`);
    cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result);
    result.autoFixStatus = 'failed';
    return result;
  }

  try {
    result.commitHash = runGit(repoPath, 'git rev-parse HEAD');
  } catch (err) {
    // Commit succeeded but we can't read its sha; downgrade to warning.
    result.warnings.push(`Cannot read rubber-duck commit hash: ${err.message}`);
  }
  result.autoFixStatus = 'applied';
  success(`Rubber-duck commit created: ${result.commitHash ? result.commitHash.substring(0, 7) : '(unknown)'}`);

  // ── 11. Restore pre-existing dirty working tree ─────────────────────────
  if (stashed) tryStashPop(repoPath, result);

  return result;
}

/**
 * Unified cleanup for ANY post-fix failure path. Restores branch/HEAD/working-tree
 * to the pre-fix snapshot then pops the pre-existing stash. This is the only safe
 * way to satisfy the "transactional" requirement — without it, a failure between
 * `runCopilot` returning and the final commit would leak partial fix edits into
 * `runPostPhase2AutoReview`'s diff and into the next git operation downstream.
 *
 * Steps (best effort; each downgrades to a warning on failure):
 *  1. If branch drifted, `git checkout <fixStartBranch>` to put us back.
 *  2. `git reset --hard <fixStartHead>` to discard any tracked-file edits and
 *     index entries from the fix attempt.
 *  3. `git clean -fd` to discard new untracked files. The critique report is
 *     never affected here because by this point it's either (a) already inside
 *     the pre-fix stash, or (b) outside the repo entirely.
 *  4. Pop the pre-existing stash.
 *
 * @param {string} repoPath
 * @param {string} fixStartBranch
 * @param {string} fixStartHead
 * @param {boolean} stashed - whether step 5 created a pre-fix stash
 * @param {RubberDuckResult} result - warnings are appended in place
 */
function cleanupFixAttempt(repoPath, fixStartBranch, fixStartHead, stashed, result) {
  // Step 1: branch restore (only if needed; reading branch may itself fail)
  let currentBranch = '';
  try {
    currentBranch = runGit(repoPath, 'git rev-parse --abbrev-ref HEAD');
  } catch (err) {
    result.warnings.push(`Cleanup: cannot read current branch: ${err.message}`);
  }
  if (fixStartBranch && currentBranch && currentBranch !== fixStartBranch) {
    try {
      runGitArgs(repoPath, ['checkout', fixStartBranch]);
    } catch (err) {
      result.warnings.push(`Cleanup: failed to restore branch ${fixStartBranch}: ${err.message}`);
    }
  }

  // Step 2: HEAD/index/working-tree restore
  if (fixStartHead) {
    try {
      runGitArgs(repoPath, ['reset', '--hard', fixStartHead]);
    } catch (err) {
      result.warnings.push(`Cleanup: failed to reset to fixStartHead: ${err.message}`);
    }
  }

  // Step 3: discard untracked files left by the fix attempt
  try {
    runGit(repoPath, 'git clean -fd');
  } catch (err) {
    result.warnings.push(`Cleanup: 'git clean -fd' failed: ${err.message}`);
  }

  // Step 4: pop the pre-existing stash to restore user's dirty state
  if (stashed) tryStashPop(repoPath, result);
}

/**
 * Try to `git stash pop`, downgrading any conflict/error to a warning so the
 * surrounding flow stays non-blocking. The user can resolve manually.
 */
function tryStashPop(repoPath, result) {
  try {
    runGit(repoPath, 'git stash pop');
    debug('Restored pre-existing dirty working-tree state');
  } catch (err) {
    result.warnings.push(
      `Failed to restore pre-existing dirty state via 'git stash pop' (${err.message}); ` +
      `your stash is preserved — resolve manually with 'git stash list' / 'git stash pop'`
    );
  }
}

/**
 * Print the rubber-duck summary to the terminal.
 *
 * Called by the solve pipeline AFTER `runPostPhase2AutoReview`, so the summary
 * is the last thing the user sees and isn't scrolled off by auto-review output.
 *
 * @param {RubberDuckResult} result
 */
function printRubberDuckSummary(result) {
  if (!result) return;

  log('');
  log(chalk.bold.yellow('🦆 Rubber-Duck Critique'));
  log(chalk.yellow('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
  log('');

  const c = result.counts;
  log(`Findings: ${c.high} high, ${c.medium} medium, ${c.low} low (${c.dropped} dropped)`);

  let autoFixLine;
  switch (result.autoFixStatus) {
    case 'applied': {
      const sha = result.commitHash ? result.commitHash.substring(0, 7) : '(unknown)';
      const fixedCount = c.high + c.medium;
      autoFixLine = `applied (${fixedCount} high+medium findings) → rubber-duck commit ${sha}`;
      break;
    }
    case 'skipped-no-findings':
      autoFixLine = 'skipped (no high/medium findings)';
      break;
    case 'skipped-parse-error':
      autoFixLine = 'skipped (findings JSON malformed — see report for details)';
      break;
    case 'ran-no-changes':
      autoFixLine = 'ran but produced no changes';
      break;
    case 'failed':
      autoFixLine = 'failed — see warnings above';
      break;
    case 'critique-skipped':
    default:
      autoFixLine = '(critique itself failed; see warnings above)';
      break;
  }
  log(`Auto-fix: ${autoFixLine}`);
  log(`Report:   ${result.reportPath}`);

  if (result.topFinding) {
    const t = result.topFinding;
    log('');
    log('Top finding:');
    log(`  [${t.severity} ${t.category}] ${t.file}:${t.line}`);
    if (t.title) log(`    ${t.title}`);
    log(`    Existing pattern: ${t.evidenceFile}:${t.evidenceLine}`);
  }

  if (result.warnings && result.warnings.length > 0) {
    for (const w of result.warnings) {
      warning(w);
    }
  }
}

module.exports = {
  shouldRunRubberDuck,
  runPostPhase2RubberDuck,
  printRubberDuckSummary,
  // exported for tests
  parseFindingsJsonBlock,
  parseStatusZ,
  parseStatusZWithStatus,
  isUnderReportPath,
  pickTopFinding,
  renderFindingList,
  buildCritiquePrompt,
  buildFixPrompt,
  cleanupFixAttempt
};
