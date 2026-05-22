// @ts-check
/**
 * BS-07 PR-C: sidecar cache for sibling-PR diff hunks.
 *
 * The cache bridges two subsystems that don't share an in-process channel:
 *
 *  - **Writer** (`skills/similar-issue-finder/index.js`) — runs as an MCP
 *    subprocess during Phase 1. When it calls the ai-issue-service
 *    `/search` endpoint, the response now (post BS-07 PR-B) includes
 *    `similar_issues[*].linked_pr.diff_hunks`. The skill writes those
 *    hunks into the cache file so the orchestrator can reuse them.
 *
 *  - **Reader** (`lib/sibling-pr-diffs.js`) — runs in the parent CLI
 *    process after Phase 1 completes. Before falling back to GitHub
 *    REST, it checks the cache for pre-fetched hunks.
 *
 * The bridge is a JSON file at `process.env.AI_ISSUE_SIBLING_PR_CACHE_PATH`,
 * set by `lib/commands/solve.js` per solve. File format:
 *
 *   {
 *     "x/y#123": {
 *       "pr_number": 200,
 *       "pr_url": "https://github.com/x/y/pull/200",
 *       "files_changed": ["a.go", "b.go"],
 *       "diff_hunks": [{ "file": "a.go", "hunk": "@@..." }, ...],
 *       "diff_truncated": false
 *     },
 *     ...
 *   }
 *
 * Atomic writes: each `appendEntries` call rewrites the whole file via
 * tmp + rename. Crash-safe enough for our use (sub-second writes from a
 * single subprocess, no concurrent writers).
 *
 * Every function in this module is best-effort: I/O failures are
 * swallowed (logged via the optional logger) so a broken cache can never
 * block a solve.
 *
 * @typedef {{
 *   pr_number: number,
 *   pr_url?: string,
 *   files_changed?: string[],
 *   diff_hunks: Array<{ file: string, hunk: string }>,
 *   diff_truncated?: boolean
 * }} CachedLinkedPr
 *
 * @typedef {Record<string, CachedLinkedPr>} CacheMap
 */

const fs = require('fs');
const path = require('path');

/**
 * Compose the canonical cache key for a (repo, issueNumber) pair.
 * `repo` is normalized to lowercase to defend against case mismatches.
 *
 * @param {string} repo
 * @param {number|string} issueNumber
 * @returns {string|null}
 */
function cacheKey(repo, issueNumber) {
  if (!repo || typeof repo !== 'string') return null;
  const n = typeof issueNumber === 'number' ? issueNumber : parseInt(String(issueNumber), 10);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `${repo.toLowerCase()}#${n}`;
}

/**
 * Read the cache file. Returns an empty object on any error (missing
 * file, parse error, non-object root, permission denied). Never throws.
 *
 * @param {string|undefined|null} cachePath
 * @param {{ warning?: Function }} [logger]
 * @returns {CacheMap}
 */
function readCache(cachePath, logger) {
  if (!cachePath || typeof cachePath !== 'string') return {};
  let raw;
  try {
    raw = fs.readFileSync(cachePath, 'utf8');
  } catch (err) {
    if (err && err.code !== 'ENOENT' && logger && typeof logger.warning === 'function') {
      logger.warning(`sibling-pr-cache: read failed (${err.code || 'unknown'}): ${err.message}`);
    }
    return {};
  }
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return /** @type {CacheMap} */ (parsed);
  } catch (err) {
    if (logger && typeof logger.warning === 'function') {
      logger.warning(`sibling-pr-cache: parse failed: ${err.message}`);
    }
    return {};
  }
}

/**
 * Atomically merge `entries` into the cache file. The merge is shallow
 * keyed by `${repo}#${issue}`; a newer entry fully replaces an older
 * one (we never partial-merge `diff_hunks` lists).
 *
 * `entries` may include items with no `linked_pr` (or empty hunks) —
 * those are skipped silently. This lets the caller pass through the
 * raw /search response items without pre-filtering.
 *
 * @param {string|undefined|null} cachePath
 * @param {string} repo
 * @param {Array<{ issue?: number, issue_number?: number, linked_pr?: any }>} items
 * @param {{ warning?: Function }} [logger]
 * @returns {number} number of entries actually written
 */
function appendEntries(cachePath, repo, items, logger) {
  if (!cachePath || typeof cachePath !== 'string') return 0;
  if (!repo || !Array.isArray(items) || items.length === 0) return 0;

  const existing = readCache(cachePath, logger);
  /** @type {CacheMap} */
  const merged = { ...existing };

  let written = 0;
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const issueNum = item.issue_number != null ? item.issue_number : item.issue;
    const key = cacheKey(repo, /** @type {number} */ (issueNum));
    if (!key) continue;

    const lp = item.linked_pr;
    if (!lp || typeof lp !== 'object') continue;
    if (!Number.isFinite(lp.pr_number || lp.number) || (lp.pr_number || lp.number) <= 0) continue;

    const hunks = Array.isArray(lp.diff_hunks) ? lp.diff_hunks.filter(
      h => h && typeof h === 'object' && typeof h.file === 'string' && typeof h.hunk === 'string'
    ) : [];
    if (hunks.length === 0) continue;

    merged[key] = {
      pr_number: lp.pr_number || lp.number,
      pr_url: typeof lp.pr_url === 'string' ? lp.pr_url : (typeof lp.url === 'string' ? lp.url : ''),
      files_changed: Array.isArray(lp.files_changed) ? lp.files_changed.filter(
        f => typeof f === 'string' && f.length > 0
      ) : [],
      diff_hunks: hunks,
      diff_truncated: Boolean(lp.diff_truncated)
    };
    written += 1;
  }

  if (written === 0) return 0;

  const dir = path.dirname(cachePath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (err) {
    if (logger && typeof logger.warning === 'function') {
      logger.warning(`sibling-pr-cache: mkdir failed: ${err.message}`);
    }
    return 0;
  }

  const tmp = `${cachePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(merged), 'utf8');
    fs.renameSync(tmp, cachePath);
    return written;
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch (_e) { /* best-effort */ }
    if (logger && typeof logger.warning === 'function') {
      logger.warning(`sibling-pr-cache: atomic write failed: ${err.message}`);
    }
    return 0;
  }
}

/**
 * Look up a single entry. Returns `null` on miss or invalid input.
 *
 * @param {CacheMap} cache
 * @param {string} repo
 * @param {number} issueNumber
 * @returns {CachedLinkedPr | null}
 */
function lookup(cache, repo, issueNumber) {
  if (!cache || typeof cache !== 'object') return null;
  const key = cacheKey(repo, issueNumber);
  if (!key) return null;
  const entry = cache[key];
  if (!entry || typeof entry !== 'object') return null;
  if (!Array.isArray(entry.diff_hunks) || entry.diff_hunks.length === 0) return null;
  if (!Number.isFinite(entry.pr_number) || entry.pr_number <= 0) return null;
  return entry;
}

/**
 * Best-effort cleanup of the cache file (and any leftover .tmp siblings
 * in the same directory matching the file's basename). Safe to call
 * multiple times; safe to call when no file exists.
 *
 * @param {string|undefined|null} cachePath
 */
function removeCacheFile(cachePath) {
  if (!cachePath || typeof cachePath !== 'string') return;
  try { fs.unlinkSync(cachePath); } catch (_e) { /* best-effort */ }

  // Sweep any leftover .tmp siblings from a crashed mid-rename write.
  // appendEntries writes to `<cachePath>.<pid>.<ts>.tmp` then renames;
  // a crash between write and rename leaves the .tmp behind. The OS
  // tmpdir cleaner eventually reaps these, but doing it here keeps the
  // per-solve invariant tight.
  try {
    const dir = path.dirname(cachePath);
    const base = path.basename(cachePath);
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const tmpPattern = new RegExp(`^${escapedBase}\\.\\d+\\.\\d+\\.tmp$`);
    for (const name of fs.readdirSync(dir)) {
      if (tmpPattern.test(name)) {
        try { fs.unlinkSync(path.join(dir, name)); } catch (_e) { /* */ }
      }
    }
  } catch (_e) { /* best-effort */ }
}

module.exports = {
  cacheKey,
  readCache,
  appendEntries,
  lookup,
  removeCacheFile
};
