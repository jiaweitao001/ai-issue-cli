// @ts-check
/**
 * BS-07 §A1 + §D2 PR diff fetcher.
 *
 * Two sources, in order:
 *   1. ai-issue-service /search (preferred — diffs already pre-trimmed
 *      server-side). NOT IMPLEMENTED in PR-A; will be added once the
 *      service-side schema lands (see docs/brainstorming-ideas/BS-07-...
 *      §A1). Stub returns null so caller falls through.
 *   2. GitHub REST /repos/{owner}/{repo}/pulls/{n}/files — returns each
 *      file's patch body; we then split into hunks.
 *
 * Caching: in-memory LRU (50 entries by default), keyed by `${repo}#${pr}`.
 * Cache lifetime: process lifetime. Sufficient given solve is short-lived
 * and the same PR is unlikely to be re-fetched across solves.
 *
 * IO: uses global `fetch` (Node 18+). No node_modules dependency added.
 *
 * @typedef {{
 *   file: string,
 *   hunk: string
 * }} Hunk
 *
 * @typedef {{
 *   number: number,
 *   files_changed: string[],
 *   hunks: Hunk[]
 * } | null} FetchedDiff
 */

const GITHUB_API_BASE = 'https://api.github.com';
const DEFAULT_CACHE_CAPACITY = 50;

/**
 * Minimal Map-backed LRU. `get` promotes; `set` evicts oldest on overflow.
 */
class LruCache {
  /**
   * @param {number} capacity
   */
  constructor(capacity) {
    this.capacity = Math.max(1, capacity | 0);
    /** @type {Map<string, FetchedDiff>} */
    this.map = new Map();
  }

  /**
   * @param {string} key
   * @returns {FetchedDiff | undefined}
   */
  get(key) {
    if (!this.map.has(key)) return undefined;
    const value = this.map.get(key);
    this.map.delete(key);
    // @ts-ignore -- we just confirmed has(key); Map.set accepts the value.
    this.map.set(key, value);
    return value;
  }

  /**
   * @param {string} key
   * @param {FetchedDiff} value
   */
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, value);
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) this.map.delete(oldest);
    }
  }

  clear() {
    this.map.clear();
  }
}

const defaultCache = new LruCache(DEFAULT_CACHE_CAPACITY);

/**
 * Split a unified-diff file patch body into individual hunks.
 * Each hunk starts with a "(at-at) ... (at-at)" header (two `@` then space).
 * We preserve the header inside the hunk body so downstream prompt readers
 * retain context.
 *
 * @param {string} patch
 * @returns {string[]}
 */
function splitPatchIntoHunks(patch) {
  if (!patch) return [];
  const lines = patch.split('\n');
  /** @type {string[]} */
  const hunks = [];
  /** @type {string[]} */
  let current = [];
  for (const line of lines) {
    if (line.startsWith('@@')) {
      if (current.length > 0) hunks.push(current.join('\n'));
      current = [line];
    } else if (current.length > 0) {
      current.push(line);
    }
  }
  if (current.length > 0) hunks.push(current.join('\n'));
  return hunks;
}

/**
 * Resolve a fetch-like callable. Tests can inject a stub; in production we
 * fall back to the global `fetch` (Node ≥ 18).
 *
 * @param {object} [opts]
 * @returns {Function}
 */
function resolveFetchImpl(opts) {
  if (opts && typeof opts.fetchImpl === 'function') return opts.fetchImpl;
  if (typeof fetch === 'function') return fetch;
  throw new Error('No fetch implementation available (Node < 18 and no fetchImpl injected)');
}

/**
 * Build HTTP headers for GitHub REST API. Token is optional but recommended
 * (raises rate limit from 60/h to 5000/h).
 *
 * @param {string|undefined} token
 */
function buildHeaders(token) {
  /** @type {Record<string, string>} */
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ai-issue-cli/pr-diff-fetcher'
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return headers;
}

/**
 * Fetch the trimmed diff for a PR.
 *
 * @param {string} repo  e.g. "hashicorp/terraform-provider-azurerm"
 * @param {number} prNumber
 * @param {object} [opts]
 * @param {string} [opts.githubToken]
 * @param {LruCache} [opts.cache]
 * @param {Function} [opts.fetchImpl] Test seam; defaults to global `fetch`.
 * @returns {Promise<FetchedDiff>}
 */
async function fetchPrDiff(repo, prNumber, opts = {}) {
  if (!repo || !Number.isInteger(prNumber) || prNumber <= 0) return null;

  const cache = opts.cache || defaultCache;
  const cacheKey = `${repo}#${prNumber}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const fetchImpl = resolveFetchImpl(opts);
  const headers = buildHeaders(opts.githubToken);
  const url = `${GITHUB_API_BASE}/repos/${repo}/pulls/${prNumber}/files?per_page=100`;

  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (err) {
    cache.set(cacheKey, null);
    return null;
  }

  if (!response || !response.ok) {
    cache.set(cacheKey, null);
    return null;
  }

  /** @type {Array<{filename: string, patch?: string}>} */
  let files;
  try {
    files = await response.json();
  } catch (_err) {
    cache.set(cacheKey, null);
    return null;
  }

  if (!Array.isArray(files) || files.length === 0) {
    cache.set(cacheKey, null);
    return null;
  }

  /** @type {Hunk[]} */
  const hunks = [];
  /** @type {string[]} */
  const filesChanged = [];
  for (const f of files) {
    if (!f || !f.filename) continue;
    filesChanged.push(f.filename);
    if (typeof f.patch !== 'string' || f.patch.length === 0) continue;
    for (const hunk of splitPatchIntoHunks(f.patch)) {
      hunks.push({ file: f.filename, hunk });
    }
  }

  const result = { number: prNumber, files_changed: filesChanged, hunks };
  cache.set(cacheKey, result);
  return result;
}

/**
 * Resolve a PR number for an issue via GitHub's timeline API.
 * Returns the *most recent* merged cross-reference, or null when none.
 *
 * @param {string} repo
 * @param {number} issueNumber
 * @param {object} [opts]
 * @param {string} [opts.githubToken]
 * @param {Function} [opts.fetchImpl]
 * @returns {Promise<number|null>}
 */
async function resolvePrForIssue(repo, issueNumber, opts = {}) {
  if (!repo || !Number.isInteger(issueNumber) || issueNumber <= 0) return null;
  const fetchImpl = resolveFetchImpl(opts);
  const headers = buildHeaders(opts.githubToken);
  headers['Accept'] = 'application/vnd.github.mockingbird-preview+json';

  const url = `${GITHUB_API_BASE}/repos/${repo}/issues/${issueNumber}/timeline?per_page=100`;
  let response;
  try {
    response = await fetchImpl(url, { headers });
  } catch (_err) {
    return null;
  }
  if (!response || !response.ok) return null;

  /** @type {Array<any>} */
  let events;
  try {
    events = await response.json();
  } catch (_err) {
    return null;
  }
  if (!Array.isArray(events)) return null;

  /** @type {{ number: number, mergedAt: string } | null} */
  let bestPr = null;
  for (const ev of events) {
    if (!ev || ev.event !== 'cross-referenced') continue;
    const src = ev.source && ev.source.issue;
    if (!src || !src.pull_request) continue;
    const mergedAt = src.pull_request.merged_at;
    if (!mergedAt) continue;
    if (!bestPr || mergedAt > bestPr.mergedAt) {
      bestPr = { number: src.number, mergedAt };
    }
  }
  return bestPr ? bestPr.number : null;
}

module.exports = {
  fetchPrDiff,
  resolvePrForIssue,
  splitPatchIntoHunks,
  LruCache,
  DEFAULT_CACHE_CAPACITY,
  _internal: { defaultCache, resolveFetchImpl, buildHeaders }
};
