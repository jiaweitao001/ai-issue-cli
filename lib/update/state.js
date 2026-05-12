// @ts-check
/**
 * Per-install state file that records "what version got installed last time".
 *
 * State files live at `~/.ai-issue/state/install-<hash>.json` where hash is
 * derived from the `globalPkg` path (so multiple node-version-managed installs
 * each get their own state).
 *
 * v3.4 INVARIANT (UPDATE_COMMAND_PROPOSAL.md §4.3.3):
 *   `state.channel` is observational metadata only. It is NEVER used as
 *   user-config input to channel resolution. Channel always flows from
 *   config.updateChannel via resolveEffectiveChannel(config, mode).
 *
 * v3.4 IDENTITY CHECK (UPDATE_COMMAND_PROPOSAL.md §4.3.3):
 *   The same globalPkg path can change install mode (npm install -g . <-> npm link).
 *   readState() refuses to return state whose `mode` or `sourceClone` no longer
 *   matches the current detected install — instead it returns a sentinel
 *   { __stale: true, reason } so callers fall through to first-install logic.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const AI_ISSUE_DIR = path.join(os.homedir(), '.ai-issue');
const STATE_DIR = path.join(AI_ISSUE_DIR, 'state');

function hashPath(p) {
  return crypto.createHash('sha256').update(String(p)).digest('hex').slice(0, 12);
}

function statePathFor(globalPkg) {
  return path.join(STATE_DIR, `install-${hashPath(globalPkg)}.json`);
}

/**
 * Refuse to operate on ~/.ai-issue when the directory is owned by a different uid.
 * Typical cause: user once ran ai-issue under sudo, leaving root-owned files.
 * On Windows getuid is undefined; we silently no-op.
 */
function ensureStateOwnership() {
  if (typeof process.getuid !== 'function') return;
  if (!fs.existsSync(AI_ISSUE_DIR)) return;
  let stat;
  try {
    stat = fs.lstatSync(AI_ISSUE_DIR);
  } catch (_e) {
    return;
  }
  if (typeof stat.uid !== 'number') return;
  const myUid = process.getuid();
  if (stat.uid !== myUid) {
    const err = /** @type {Error & { code: string }} */ (new Error(
      `~/.ai-issue is owned by uid ${stat.uid} but current process uid is ${myUid}. ` +
      `Likely caused by a previous \`sudo\` invocation. ` +
      `Fix: \`sudo chown -R "$USER" ~/.ai-issue\``
    ));
    err.code = 'OWNERSHIP';
    throw err;
  }
}

function readState(detected) {
  if (!detected || !detected.globalPkg) return null;
  const p = statePathFor(detected.globalPkg);
  if (!fs.existsSync(p)) return null;
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (_e) {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;

  if (raw.mode && raw.mode !== detected.mode) {
    return {
      __stale: true,
      reason: `install mode changed (state: ${raw.mode}, detected: ${detected.mode})`,
      prev: raw,
    };
  }
  if (raw.mode === 'link' && raw.sourceClone && detected.sourceClone &&
      raw.sourceClone !== detected.sourceClone) {
    return {
      __stale: true,
      reason: `link mode source clone changed (state: ${raw.sourceClone}, detected: ${detected.sourceClone})`,
      prev: raw,
    };
  }
  return raw;
}

function writeState(detected, data) {
  if (!detected || !detected.globalPkg) {
    throw new Error('writeState requires detected.globalPkg');
  }
  if (!fs.existsSync(STATE_DIR)) {
    fs.mkdirSync(STATE_DIR, { recursive: true });
  }
  const merged = {
    commit: null,
    ref: null,
    channel: null,
    ...data,
    mode: detected.mode,
    sourceClone: detected.sourceClone || null,
    installedAt: new Date().toISOString(),
    installedBy: 'ai-issue-update',
  };
  fs.writeFileSync(statePathFor(detected.globalPkg), JSON.stringify(merged, null, 2));
  return merged;
}

module.exports = {
  ensureStateOwnership,
  readState,
  writeState,
  statePathFor,
  hashPath,
  AI_ISSUE_DIR,
  STATE_DIR,
};
