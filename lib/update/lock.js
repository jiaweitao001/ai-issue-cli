// @ts-check
/**
 * Concurrency lockfiles for `ai-issue update` and `ai-issue watch`.
 *
 * Two lock files (UPDATE_COMMAND_PROPOSAL.md §5.5):
 *   ~/.ai-issue/locks/update.lock        held by update main process / worker
 *   ~/.ai-issue/locks/watch-active.lock  held by watch daemon during a cycle
 *
 * v3.4 INVARIANT (§4.5 + §5.5): acquireUpdateLock owns the entire sequence
 * (O_EXCL update.lock -> lstat watch-active.lock) atomically. There is no
 * separate `ensureNoActiveWatch()` pre-check, because that would reintroduce
 * the TOCTOU race v3.1 fixed: pre-check passes -> watch starts cycle ->
 * update acquires lock -> both run concurrently.
 *
 * Stale detection uses `process.kill(pid, 0)`:
 *   ESRCH  -> process gone, lock is stale
 *   EPERM  -> process exists but we lack signal permission (counts as alive)
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const LOCK_DIR_DEFAULT = path.join(os.homedir(), '.ai-issue', 'locks');
const UPDATE_LOCK_DEFAULT = path.join(LOCK_DIR_DEFAULT, 'update.lock');
const WATCH_LOCK_DEFAULT = path.join(LOCK_DIR_DEFAULT, 'watch-active.lock');

function resolvePaths(paths = {}) {
  const lockDir = paths.lockDir || path.dirname(paths.update || UPDATE_LOCK_DEFAULT);
  return {
    lockDir,
    update: paths.update || UPDATE_LOCK_DEFAULT,
    watch: paths.watch || WATCH_LOCK_DEFAULT,
  };
}

function ensureLockDir(lockDir) {
  if (!fs.existsSync(lockDir)) {
    fs.mkdirSync(lockDir, { recursive: true });
  }
}

function isPidAlive(pid) {
  if (!pid || typeof pid !== 'number' || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (/** @type {any} */ e) {
    return e && e.code === 'EPERM';
  }
}

function readLockJson(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_e) {
    return null;
  }
}

/**
 * @param {object} [opts]
 * @param {number} [opts.pid]
 * @param {object} [opts.paths]
 * @returns {{ acquired: true, updateLockPath: string }}
 */
function acquireUpdateLock(opts = {}) {
  const pid = opts.pid || process.pid;
  const { lockDir, update: updateLockPath, watch: watchLockPath } = resolvePaths(opts.paths);
  ensureLockDir(lockDir);

  // 1) O_EXCL update.lock (with one stale-clear retry)
  let fd = openExclusive(updateLockPath);
  if (fd === null) {
    const existing = readLockJson(updateLockPath);
    if (existing && isPidAlive(existing.pid)) {
      const err = /** @type {Error & { code: string, existing?: object }} */ (new Error(
        `Another \`ai-issue update\` is already running (pid ${existing.pid}, ` +
        `started ${existing.startedAt || 'unknown'}).`
      ));
      err.code = 'UPDATE_BUSY';
      err.existing = existing;
      throw err;
    }
    try { fs.unlinkSync(updateLockPath); } catch (_e) { /* race-tolerant */ }
    fd = openExclusive(updateLockPath);
    if (fd === null) {
      const err = /** @type {Error & { code: string }} */ (new Error(`Failed to acquire update.lock at ${updateLockPath} after clearing stale entry.`));
      err.code = 'LOCK_DIR';
      throw err;
    }
  }
  fs.writeSync(fd, JSON.stringify({ pid, startedAt: new Date().toISOString() }));
  fs.closeSync(fd);

  // 2) Atomic same-call lstat watch-active.lock
  let watchStat;
  try {
    watchStat = fs.lstatSync(watchLockPath);
  } catch (/** @type {any} */ e) {
    if (e && e.code === 'ENOENT') {
      return { acquired: true, updateLockPath };
    }
    try { fs.unlinkSync(updateLockPath); } catch (_e) { /* clean up */ }
    const err = /** @type {Error & { code: string }} */ (new Error(`Failed to inspect watch-active.lock: ${e.message}`));
    err.code = 'LOCK_DIR';
    throw err;
  }

  // File exists. void unused stat (only lstat for ENOENT distinction).
  void watchStat;
  const existing = readLockJson(watchLockPath);
  if (!existing || !existing.pid || !isPidAlive(existing.pid)) {
    try { fs.unlinkSync(watchLockPath); } catch (_e) { /* race-tolerant */ }
    return { acquired: true, updateLockPath };
  }

  // Watch daemon is alive — release update.lock first so we don't pollute
  // the next attempt with a stale entry pointing at us.
  try { fs.unlinkSync(updateLockPath); } catch (_e) { /* clean up */ }
  const err = /** @type {Error & { code: string, existing?: object }} */ (new Error(
    `\`ai-issue watch\` is currently running (pid ${existing.pid}, cycle started ${existing.startedAt}). ` +
    `Wait for the current cycle to finish then retry, or stop watch with \`kill ${existing.pid}\` first.`
  ));
  err.code = 'WATCH_BUSY';
  err.existing = existing;
  throw err;
}

function openExclusive(p) {
  try {
    return fs.openSync(p, 'wx');
  } catch (/** @type {any} */ e) {
    if (e && e.code === 'EEXIST') return null;
    throw e;
  }
}

function releaseUpdateLock(paths = {}) {
  const { update: updateLockPath } = resolvePaths(paths);
  try { fs.unlinkSync(updateLockPath); } catch (_e) { /* best-effort */ }
}

/**
 * Used by watch.js (P1) to mark a cycle as in-progress.
 */
function writeWatchActiveLock(meta = {}, paths = {}) {
  const { lockDir, watch: watchLockPath } = resolvePaths(paths);
  ensureLockDir(lockDir);
  fs.writeFileSync(watchLockPath, JSON.stringify({
    pid: process.pid,
    startedAt: new Date().toISOString(),
    ...meta,
  }));
  return watchLockPath;
}

function unlinkWatchActiveLock(paths = {}) {
  const { watch: watchLockPath } = resolvePaths(paths);
  try { fs.unlinkSync(watchLockPath); } catch (_e) { /* best-effort */ }
}

/**
 * Used by watch.js to skip a cycle when an update is mid-flight.
 */
function isUpdateLockActive(paths = {}) {
  const { update: updateLockPath } = resolvePaths(paths);
  if (!fs.existsSync(updateLockPath)) return false;
  const existing = readLockJson(updateLockPath);
  return !!(existing && isPidAlive(existing.pid));
}

module.exports = {
  acquireUpdateLock,
  releaseUpdateLock,
  writeWatchActiveLock,
  unlinkWatchActiveLock,
  isUpdateLockActive,
  isPidAlive,
  LOCK_DIR_DEFAULT,
  UPDATE_LOCK_DEFAULT,
  WATCH_LOCK_DEFAULT,
};
