// @ts-check
/**
 * BS-07 §C2 sibling-PR-diffs orchestrator.
 *
 * Parses the Phase 1 research report to find similar-issue references,
 * resolves each to a merged sibling PR (per §D three-tier fallback),
 * fetches the diff via lib/pr-diff-fetcher, packs hunks within budget via
 * lib/hunk-filter, and renders the final `## Sibling PR Diffs` Markdown
 * section that gets appended to `researchContent` in lib/commands/solve.js.
 *
 * Reverse-dependency on Phase 1 prompt template:
 *   This module assumes the research report contains a section header
 *   `## Similar Historical Issues` followed by a 4-column table:
 *     `| Score | Issue | State | Applicable? |`
 *   produced verbatim from prompts/PHASE1_RESEARCH_PROMPT.md:181 (which
 *   forbids the agent from renaming sections) and
 *   prompts/PHASE1_RESEARCH_PROMPT.md:217-225 (which defines the columns).
 *   IF YOU CHANGE THAT TEMPLATE, update parseSimilarIssues() below.
 *
 * IO: only via injected fetchPrDiff / resolvePrForIssue functions (test seam).
 *
 * @typedef {{
 *   repo: string,
 *   issueNumber: number,
 *   score: number,
 *   url: string,
 *   title?: string
 * }} ParsedIssueRef
 *
 * @typedef {{
 *   researchContent: string,
 *   config: { repo?: string, githubToken?: string },
 *   issueNumber?: string | number,
 *   currentIssueFiles?: string[],
 *   scoreThreshold?: number,
 *   maxPrs?: number,
 *   maxTotalTokens?: number,
 *   maxHunksPerPr?: number,
 *   maxLinesPerHunk?: number,
 *   fetchPrDiffImpl?: Function,
 *   resolvePrForIssueImpl?: Function,
 *   logger?: { warning?: Function, debug?: Function }
 * }} BuildOptions
 */

const { fetchPrDiff: defaultFetchPrDiff, resolvePrForIssue: defaultResolvePrForIssue } =
  require('./pr-diff-fetcher');
const { packPrs } = require('./hunk-filter');

const DEFAULT_SCORE_THRESHOLD = 0.7;
const DEFAULT_MAX_PRS = 2;

/**
 * Parse the `## Similar Historical Issues` table out of the research report.
 * Tolerates whitespace and leading/trailing `|`. Returns ParsedIssueRef[]
 * in original table order.
 *
 * @param {string} researchContent
 * @returns {ParsedIssueRef[]}
 */
function parseSimilarIssues(researchContent) {
  if (!researchContent || typeof researchContent !== 'string') return [];
  const section = extractSection(researchContent, '## Similar Historical Issues');
  if (!section) return [];

  /** @type {ParsedIssueRef[]} */
  const refs = [];
  for (const rawLine of section.split('\n')) {
    const line = rawLine.trim();
    if (!line.startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cells.length < 3) continue;

    const scoreText = cells[0];
    const issueCell = cells[1];

    if (/^score$/i.test(scoreText)) continue;
    if (/^-+$/.test(scoreText)) continue;

    const score = parseFloat(scoreText);
    if (!Number.isFinite(score)) continue;

    const parsed = parseIssueCell(issueCell);
    if (!parsed) continue;

    refs.push({ ...parsed, score });
  }
  return refs;
}

/**
 * Extract the body of a Markdown section by its `##` header. Returns the
 * lines until the next `## ` header or end of doc (exclusive of next header).
 *
 * @param {string} content
 * @param {string} header e.g. "## Similar Historical Issues"
 */
function extractSection(content, header) {
  const lines = content.split('\n');
  let inSection = false;
  /** @type {string[]} */
  const collected = [];
  for (const line of lines) {
    if (!inSection) {
      if (line.trim() === header.trim()) inSection = true;
      continue;
    }
    if (/^##\s+/.test(line)) break;
    collected.push(line);
  }
  return collected.length > 0 ? collected.join('\n') : null;
}

/**
 * Parse the "Issue" cell of the Similar Historical Issues table. The template
 * places a Markdown link there: `[#NNNNN - Title](https://github.com/.../issues/NNNNN)`.
 *
 * @param {string} cell
 * @returns {{ repo: string, issueNumber: number, url: string, title: string } | null}
 */
function parseIssueCell(cell) {
  if (!cell) return null;
  const linkMatch = cell.match(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/);
  if (!linkMatch) return null;
  const label = linkMatch[1];
  const url = linkMatch[2];

  const repoMatch = url.match(/github\.com\/([^/]+\/[^/]+)\/(issues|pull)\/(\d+)/);
  if (!repoMatch) return null;
  const repo = repoMatch[1];
  const issueNumber = parseInt(repoMatch[3], 10);
  if (!Number.isFinite(issueNumber) || issueNumber <= 0) return null;

  return {
    repo,
    issueNumber,
    url,
    title: label.replace(/^#\d+\s*-?\s*/, '').trim()
  };
}

/**
 * Render the final Markdown section.
 *
 * @param {Array<{ ref: ParsedIssueRef, prNumber: number, hunks: Array<{file: string, hunk: string}>, omittedHunks: number }>} packed
 * @param {number} totalOmittedHunks
 * @returns {string}
 */
function renderSection(packed, totalOmittedHunks) {
  if (!packed || packed.length === 0) return '';

  /** @type {string[]} */
  const parts = [];
  parts.push('## Sibling PR Diffs');
  parts.push('');
  parts.push('Phase 1 found these closely-related historical PRs. Their diffs');
  parts.push('are included verbatim below for direct pattern-matching. Strongly');
  parts.push('consider mirroring their structure unless the current issue\'s');
  parts.push('specifics demand otherwise. **Do not blindly copy field / resource');
  parts.push('names** — the historical PR operated on a different resource.');
  parts.push('');

  for (const entry of packed) {
    const { ref, prNumber, hunks, omittedHunks } = entry;
    const scoreFixed = ref.score.toFixed(2);
    const titleSuffix = ref.title ? ` — "${ref.title}"` : '';
    parts.push(`### PR #${prNumber} — Score ${scoreFixed} — Issue #${ref.issueNumber}${titleSuffix}`);
    parts.push('');
    for (const h of hunks) {
      parts.push('```diff');
      parts.push(`// ${h.file}`);
      parts.push(h.hunk);
      parts.push('```');
      parts.push('');
    }
    if (omittedHunks > 0) {
      parts.push(`> ⚠️ ${omittedHunks} hunks omitted from this PR due to budget.`);
      parts.push('');
    }
  }
  if (totalOmittedHunks > 0) {
    parts.push(`> Total hunks omitted across all PRs: ${totalOmittedHunks}.`);
  }
  return parts.join('\n').replace(/\n+$/, '') + '\n';
}

/**
 * Build the sibling-PR-diffs Markdown section for the research report.
 * Returns `null` when nothing useful could be produced (no parsed issues,
 * no PR resolutions, no diffs over score threshold, all dropped by packing).
 *
 * Never throws — callers are not expected to wrap in try/catch.
 *
 * @param {BuildOptions} opts
 * @returns {Promise<string|null>}
 */
async function buildSiblingPrDiffsSection(opts) {
  if (!opts || typeof opts.researchContent !== 'string') return null;
  const logger = opts.logger || {};
  const warn = typeof logger.warning === 'function' ? logger.warning : () => {};

  const fetchPrDiff = opts.fetchPrDiffImpl || defaultFetchPrDiff;
  const resolvePrForIssue = opts.resolvePrForIssueImpl || defaultResolvePrForIssue;
  const githubToken = (opts.config && opts.config.githubToken) || process.env.GITHUB_TOKEN || undefined;
  const scoreThreshold = typeof opts.scoreThreshold === 'number' ? opts.scoreThreshold : DEFAULT_SCORE_THRESHOLD;
  const maxPrs = typeof opts.maxPrs === 'number' ? opts.maxPrs : DEFAULT_MAX_PRS;

  const refs = parseSimilarIssues(opts.researchContent)
    .filter(r => r.score >= scoreThreshold)
    .slice(0, maxPrs);
  if (refs.length === 0) return null;

  /** @type {Array<{ ref: ParsedIssueRef, prNumber: number, files_changed: string[], hunks: Array<{file: string, hunk: string}> }>} */
  const resolved = [];
  for (const ref of refs) {
    let prNumber = null;
    try {
      prNumber = await resolvePrForIssue(ref.repo, ref.issueNumber, { githubToken });
    } catch (err) {
      warn(`Failed to resolve PR for ${ref.repo}#${ref.issueNumber}: ${err.message}`);
      continue;
    }
    if (!prNumber) continue;

    let diff = null;
    try {
      diff = await fetchPrDiff(ref.repo, prNumber, { githubToken });
    } catch (err) {
      warn(`Failed to fetch diff for ${ref.repo}#${prNumber}: ${err.message}`);
      continue;
    }
    if (!diff || !diff.hunks || diff.hunks.length === 0) continue;
    resolved.push({ ref, prNumber, files_changed: diff.files_changed, hunks: diff.hunks });
  }

  if (resolved.length === 0) return null;

  const packResult = packPrs(
    resolved.map(r => ({
      number: r.prNumber,
      score: r.ref.score,
      title: r.ref.title,
      url: r.ref.url,
      files_changed: r.files_changed,
      hunks: r.hunks
    })),
    {
      maxTotalTokens: opts.maxTotalTokens,
      maxHunksPerPr: opts.maxHunksPerPr,
      maxLinesPerHunk: opts.maxLinesPerHunk,
      scoreThreshold,
      currentIssueFiles: opts.currentIssueFiles
    }
  );

  if (!packResult.packed || packResult.packed.length === 0) return null;

  // Re-attach ref / pr metadata for rendering
  const byPrNumber = new Map(resolved.map(r => [r.prNumber, r]));
  const renderInput = packResult.packed.map(p => {
    const meta = byPrNumber.get(p.pr.number);
    return {
      ref: meta ? meta.ref : { repo: '', issueNumber: 0, score: p.pr.score, url: '', title: p.pr.title || '' },
      prNumber: p.pr.number,
      hunks: p.hunks,
      omittedHunks: p.omittedHunks
    };
  });

  return renderSection(renderInput, packResult.totalOmittedHunks);
}

module.exports = {
  buildSiblingPrDiffsSection,
  parseSimilarIssues,
  parseIssueCell,
  extractSection,
  renderSection,
  DEFAULT_SCORE_THRESHOLD,
  DEFAULT_MAX_PRS
};
