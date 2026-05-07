// @ts-check
/**
 * Migration notifier — renders a banner when the server announces a
 * subscription rotation via X-Service-Migration-Url response headers.
 *
 * Design: docs/SERVICE_MIGRATION_NOTIFICATION_PROPOSAL.md
 *
 * Two entry points:
 *   - maybeShowMigrationBanner(info): throttled (≤ 1× per 24h per newUrl).
 *     Used by every API call so users see the banner on regular use without
 *     being spammed.
 *   - showMigrationBannerForced(info): always renders. Used by `ai-issue check`
 *     so the diagnostic command can guarantee the user sees the message.
 *
 * Hard rules (per rubber-duck critique):
 *   - Never throws. Any internal error is swallowed; banner is best-effort.
 *   - Writes to stderr (not stdout/logger) so it never pollutes JSON/NDJSON output.
 *   - ASCII-only box (no unicode) so cmd.exe and minimal terminals render correctly.
 *   - URL is validated; if malformed we still show the warning but skip the
 *     copy-paste command line.
 *   - State file is self-healing: a corrupted/missing file is treated as empty
 *     state, and the next successful banner write rewrites it cleanly.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

/** @typedef {import('./types').MigrationInfo} MigrationInfo */

const STATE_DIR = path.join(os.homedir(), '.ai-issue');
const STATE_FILE = path.join(STATE_DIR, 'migration-state.json');
const THROTTLE_WINDOW_MS = 24 * 60 * 60 * 1000; // 24h

/**
 * Read the persistent state. Self-heals on missing file or parse failure.
 * @returns {{ shown: Record<string, number> }}
 */
function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && parsed.shown && typeof parsed.shown === 'object') {
      return { shown: parsed.shown };
    }
  } catch {
    // Missing file or corrupted JSON → treat as empty state.
  }
  return { shown: {} };
}

/**
 * Persist state. Best-effort: any I/O failure is swallowed.
 * @param {{ shown: Record<string, number> }} state
 */
function writeState(state) {
  try {
    if (!fs.existsSync(STATE_DIR)) {
      fs.mkdirSync(STATE_DIR, { recursive: true });
    }
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
  } catch {
    // Banner is best-effort; never break the calling API request.
  }
}

/**
 * Validate a URL string. Returns the normalized origin+path or null.
 * @param {string} url
 * @returns {string|null}
 */
function validateUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * Render the banner to stderr. ASCII-only.
 * @param {MigrationInfo} info
 */
function renderBanner(info) {
  const safeUrl = validateUrl(info.newUrl);
  const deadlineLine = info.deadline
    ? `Deadline:    ${info.deadline} (after which the old service may be shut down)`
    : 'Deadline:    not announced';

  const lines = [
    '',
    '+------------------------------------------------------------------+',
    '|  [!] ai-issue-service is migrating to a new Azure subscription.  |',
    '+------------------------------------------------------------------+',
    `New URL:     ${info.newUrl}`,
    deadlineLine,
    '',
    'Action required: update your serviceUrl before the deadline.',
    '',
  ];

  if (safeUrl) {
    lines.push(`  ai-issue config set serviceUrl ${safeUrl}`);
    lines.push('  ai-issue check');
    lines.push('');
  } else {
    lines.push('  (Server reported a new URL but it failed validation —');
    lines.push('   please contact the maintainer for the correct value.)');
    lines.push('');
  }

  try {
    process.stderr.write(lines.join('\n') + '\n');
  } catch {
    // Even stderr.write can fail (e.g. EPIPE). Swallow silently.
  }
}

/**
 * Show the banner at most once per 24h per newUrl. Safe to call on every API request.
 *
 * @param {MigrationInfo|null|undefined} info
 */
function maybeShowMigrationBanner(info) {
  try {
    if (!info || !info.newUrl) return;
    const now = Date.now();
    const state = readState();
    const last = state.shown[info.newUrl];
    if (typeof last === 'number' && now - last < THROTTLE_WINDOW_MS) {
      return; // Within throttle window.
    }
    renderBanner(info);
    state.shown[info.newUrl] = now;
    writeState(state);
  } catch {
    // Notifier must never break the calling API request.
  }
}

/**
 * Always render the banner regardless of throttle state. Used by `ai-issue check`.
 * Also updates the throttle timestamp so a subsequent regular API call
 * doesn't immediately re-show the banner.
 *
 * @param {MigrationInfo|null|undefined} info
 */
function showMigrationBannerForced(info) {
  try {
    if (!info || !info.newUrl) return;
    renderBanner(info);
    const state = readState();
    state.shown[info.newUrl] = Date.now();
    writeState(state);
  } catch {
    // Notifier must never throw.
  }
}

module.exports = {
  maybeShowMigrationBanner,
  showMigrationBannerForced,
  // Exposed for tests:
  _readState: readState,
  _writeState: writeState,
  _validateUrl: validateUrl,
  _STATE_FILE: STATE_FILE,
  _THROTTLE_WINDOW_MS: THROTTLE_WINDOW_MS,
};
