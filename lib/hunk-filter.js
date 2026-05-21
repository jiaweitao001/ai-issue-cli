// @ts-check
/**
 * BS-07 §B 装填算法：把若干 PR 的 hunk 按预算贪心打包成最终注入 prompt
 * 的内容。纯函数；不做 IO；可以彻底单测。
 *
 * 算法（见 docs/brainstorming-ideas/BS-07-inject-similar-pr-diff.md §B）：
 *   1. 按 score 降序处理 PR；
 *   2. 对每个 PR，若 score < scoreThreshold（默认 0.7），停；
 *   3. 若已用 token > 0.9 * cap，停；
 *   4. PR 内 hunk 按"文件路径与 currentIssueFiles 匹配"优先排序；
 *   5. 对每个 hunk：估 token 数（chars / 4），加上后会超 cap 则跳过并计入
 *      omittedHunks 计数，但 PR 内其余 hunk 继续尝试装填；
 *   6. 单个 PR 一个 hunk 都没装进 → 整 PR 丢弃（不留空标题）；
 *   7. 默认剔除 vendor/** / *_gen.go / generated 路径的 hunk。
 *
 * @typedef {{
 *   file: string,
 *   hunk: string
 * }} Hunk
 *
 * @typedef {{
 *   number: number,
 *   score: number,
 *   title?: string,
 *   url?: string,
 *   files_changed?: string[],
 *   hunks: Hunk[]
 * }} PrCandidate
 *
 * @typedef {{
 *   maxTotalTokens?: number,
 *   maxHunksPerPr?: number,
 *   maxLinesPerHunk?: number,
 *   scoreThreshold?: number,
 *   currentIssueFiles?: string[],
 *   skipGeneratedPaths?: boolean
 * }} PackOptions
 *
 * @typedef {{
 *   pr: PrCandidate,
 *   hunks: Hunk[],
 *   omittedHunks: number
 * }} PackedPr
 *
 * @typedef {{
 *   packed: PackedPr[],
 *   totalUsedTokens: number,
 *   totalOmittedHunks: number,
 *   droppedPrs: number
 * }} PackResult
 */

const DEFAULT_OPTIONS = Object.freeze({
  maxTotalTokens: 4000,
  maxHunksPerPr: 6,
  maxLinesPerHunk: 40,
  scoreThreshold: 0.7,
  skipGeneratedPaths: true
});

const GENERATED_PATH_PATTERNS = [
  /(^|\/)vendor\//,
  /_gen\.go$/,
  /\.pb\.go$/,
  /(^|\/)node_modules\//,
  /(^|\/)\.terraform\//
];

/**
 * Rough token estimate. Heuristic: chars / 4 (good enough for Latin text +
 * code; we use it for budgeting, not billing).
 * @param {string} s
 */
function estimateTokens(s) {
  if (!s) return 0;
  return Math.ceil(s.length / 4);
}

/**
 * Decide whether a file path looks generated / vendored and should be skipped.
 * @param {string} filePath
 */
function isGeneratedPath(filePath) {
  if (!filePath) return false;
  return GENERATED_PATH_PATTERNS.some(re => re.test(filePath));
}

/**
 * Truncate a hunk body to maxLines, appending a marker if truncated.
 * @param {string} hunkBody
 * @param {number} maxLines
 */
function truncateHunkLines(hunkBody, maxLines) {
  if (!hunkBody) return '';
  if (!Number.isFinite(maxLines) || maxLines <= 0) return hunkBody;
  const lines = hunkBody.split('\n');
  if (lines.length <= maxLines) return hunkBody;
  const kept = lines.slice(0, maxLines);
  const omitted = lines.length - maxLines;
  kept.push(`// ... ${omitted} more lines omitted by hunk-filter`);
  return kept.join('\n');
}

/**
 * Sort hunks so that those touching currentIssueFiles come first.
 * Stable: ties keep original order.
 * @param {Hunk[]} hunks
 * @param {string[]} currentIssueFiles
 */
function sortHunksByRelevance(hunks, currentIssueFiles) {
  if (!currentIssueFiles || currentIssueFiles.length === 0) return hunks.slice();
  const matchSet = new Set(currentIssueFiles);
  const isMatch = (h) => matchSet.has(h.file)
    || currentIssueFiles.some(p => h.file && (h.file === p || h.file.endsWith('/' + p)));
  return hunks
    .map((h, i) => ({ h, i, matched: isMatch(h) }))
    .sort((a, b) => {
      if (a.matched !== b.matched) return a.matched ? -1 : 1;
      return a.i - b.i;
    })
    .map(x => x.h);
}

/**
 * Merge user-provided options with defaults, ignoring any keys whose value
 * is explicitly `undefined`. This matters because callers (e.g.
 * lib/sibling-pr-diffs.js) often forward un-set keys as `undefined`, and
 * a naive `{ ...DEFAULT_OPTIONS, ...options }` would overwrite the default
 * with `undefined`, collapsing every numeric cap to NaN and disabling all
 * budget enforcement.
 * @param {PackOptions} [options]
 * @returns {Required<Omit<PackOptions, 'currentIssueFiles'>> & { currentIssueFiles?: string[] }}
 */
function mergeOptions(options) {
  /** @type {any} */
  const out = { ...DEFAULT_OPTIONS };
  if (options) {
    for (const key of Object.keys(options)) {
      const value = options[key];
      if (value !== undefined) out[key] = value;
    }
  }
  return out;
}

/**
 * Pack a sorted list of PR candidates into the budget.
 * @param {PrCandidate[]} prsSortedByScoreDesc Candidates pre-sorted by score desc.
 * @param {PackOptions} [options]
 * @returns {PackResult}
 */
function packPrs(prsSortedByScoreDesc, options) {
  const opts = mergeOptions(options);
  const cap = opts.maxTotalTokens;
  const softStopAt = Math.floor(cap * 0.9);
  const currentIssueFiles = Array.isArray(opts.currentIssueFiles) ? opts.currentIssueFiles : [];
  const skipGenerated = opts.skipGeneratedPaths !== false;

  /** @type {PackedPr[]} */
  const packed = [];
  let totalUsedTokens = 0;
  let totalOmittedHunks = 0;
  let droppedPrs = 0;

  for (const pr of prsSortedByScoreDesc || []) {
    if (!pr || !Array.isArray(pr.hunks)) continue;
    if (pr.score < opts.scoreThreshold) break;
    if (totalUsedTokens > softStopAt) break;

    const candidateHunks = skipGenerated
      ? pr.hunks.filter(h => !isGeneratedPath(h.file))
      : pr.hunks.slice();
    const ordered = sortHunksByRelevance(candidateHunks, currentIssueFiles);

    /** @type {Hunk[]} */
    const accepted = [];
    let omittedForThisPr = 0;

    for (const h of ordered) {
      if (accepted.length >= opts.maxHunksPerPr) {
        omittedForThisPr += 1;
        continue;
      }
      const truncatedBody = truncateHunkLines(h.hunk, opts.maxLinesPerHunk);
      const tokenCost = estimateTokens(truncatedBody) + estimateTokens(h.file) + 8;
      if (totalUsedTokens + tokenCost > cap) {
        omittedForThisPr += 1;
        continue;
      }
      accepted.push({ file: h.file, hunk: truncatedBody });
      totalUsedTokens += tokenCost;
    }

    if (accepted.length === 0) {
      droppedPrs += 1;
      continue;
    }
    totalOmittedHunks += omittedForThisPr;
    packed.push({ pr, hunks: accepted, omittedHunks: omittedForThisPr });
  }

  return { packed, totalUsedTokens, totalOmittedHunks, droppedPrs };
}

module.exports = {
  packPrs,
  estimateTokens,
  isGeneratedPath,
  truncateHunkLines,
  sortHunksByRelevance,
  mergeOptions,
  DEFAULT_OPTIONS,
  GENERATED_PATH_PATTERNS
};
