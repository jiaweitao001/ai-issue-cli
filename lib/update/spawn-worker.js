// @ts-check
/**
 * Stage the update worker out of the npm-managed package directory and
 * detached-spawn it so it survives `npm install` rewriting our own files
 * (UPDATE_COMMAND_PROPOSAL.md §4.4).
 *
 * Staged location:
 *   ~/.ai-issue/cache/update-worker-<sha12>.js   (worker source, content-hashed)
 *   ~/.ai-issue/cache/update-worker-<sha12>.json (serialized plan)
 *
 * The staged worker is NOT cleaned up here — that would risk EBUSY on
 * Windows during a re-spawn. Stale cache cleanup happens lazily on next
 * invocation via `cleanupStaleCache()`.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { spawn } = require('child_process');

const CACHE_DIR_DEFAULT = path.join(os.homedir(), '.ai-issue', 'cache');
const STALE_CACHE_DAYS = 30;

/**
 * @param {object} plan
 * @param {object} [deps]
 * @param {typeof fs} [deps.fs]
 * @param {typeof spawn} [deps.spawn]
 * @param {string} [deps.cacheDir]
 * @param {string} [deps.workerSrcPath]
 * @param {string} [deps.execPath]
 * @returns {{ workerPath: string, planPath: string, pid: number|undefined }}
 */
function spawnWorker(plan, deps = {}) {
  const _fs = deps.fs || fs;
  const _spawn = deps.spawn || spawn;
  const cacheDir = deps.cacheDir || CACHE_DIR_DEFAULT;
  const workerSrcPath = deps.workerSrcPath || path.join(__dirname, 'worker.js');
  const execPath = deps.execPath || process.execPath;

  const src = _fs.readFileSync(workerSrcPath, 'utf8');
  const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 12);
  const workerPath = path.join(cacheDir, `update-worker-${hash}.js`);
  const planPath = workerPath.replace(/\.js$/, '.json');

  _fs.mkdirSync(cacheDir, { recursive: true });
  _fs.writeFileSync(workerPath, src);
  _fs.writeFileSync(planPath, JSON.stringify(plan, null, 2));

  const child = _spawn(execPath, [workerPath, '--plan', planPath], {
    detached: true,
    stdio: 'inherit',
    env: { ...process.env, AI_ISSUE_SELF_UPDATE: '1' },
  });
  if (child && typeof child.unref === 'function') child.unref();

  return { workerPath, planPath, pid: child && child.pid };
}

/**
 * Best-effort cleanup of cached worker scripts older than STALE_CACHE_DAYS.
 * Called from cmdUpdate before staging a new worker. Failures are swallowed.
 */
function cleanupStaleCache(deps = {}) {
  const _fs = deps.fs || fs;
  const cacheDir = deps.cacheDir || CACHE_DIR_DEFAULT;
  const cutoffMs = (deps.maxAgeMs != null) ? deps.maxAgeMs : STALE_CACHE_DAYS * 24 * 60 * 60 * 1000;
  const now = (deps.now ? deps.now() : Date.now());
  let entries;
  try {
    entries = _fs.readdirSync(cacheDir);
  } catch (_e) {
    return [];
  }
  const removed = [];
  for (const name of entries) {
    if (!/^update-worker-[0-9a-f]{12}\.(js|json)$/.test(name)) continue;
    const full = path.join(cacheDir, name);
    let stat;
    try { stat = _fs.statSync(full); } catch (_e) { continue; }
    if (now - stat.mtimeMs > cutoffMs) {
      try { _fs.unlinkSync(full); removed.push(full); } catch (_e) { /* ignore */ }
    }
  }
  return removed;
}

module.exports = {
  spawnWorker,
  cleanupStaleCache,
  CACHE_DIR_DEFAULT,
};
