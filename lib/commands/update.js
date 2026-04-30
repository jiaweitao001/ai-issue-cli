// @ts-check
/**
 * `ai-issue update` command (UPDATE_COMMAND_PROPOSAL.md §4.5).
 *
 * P0 SCOPE: implements the read-only `--check` path end-to-end.
 *   - install mode detection
 *   - channel resolution (auto/tag/branch + --ref pinned)
 *   - state load with mode-aware identity guard (v3.4)
 *   - remote probe (three-state tag detection, symref HEAD)
 *   - report contract: configuredChannel / effectiveChannel / channelReason
 *   - exit codes 0 / 10 / 12 / 20 (see §3.4)
 *
 * P1+ will add buildUpdatePlan + acquireUpdateLock + spawnWorker for the
 * actual self-update (link mode in P1, copy mode in P2).
 */

const { loadConfig } = require('../config');
const { error } = require('../logger');
const { detectCliInstall } = require('../update/detect');
const { ensureStateOwnership, readState } = require('../update/state');
const {
  resolveEffectiveChannel,
  checkCliVersion,
  printCheckReport,
} = require('../update/version-check');

async function cmdUpdate(options = {}) {
  // 1) Ownership check (catch sudo poisoning of ~/.ai-issue)
  try {
    ensureStateOwnership();
  } catch (e) {
    error(e.message);
    process.exit(12);
    return;
  }

  // 2) Detect install mode
  const detected = detectCliInstall();
  if (detected.mode === 'unknown') {
    error('Could not detect ai-issue install location.');
    if (detected.reason) error(`  ${detected.reason}`);
    error('Manual upgrade: cd <your-clone> && git pull && npm install -g .');
    process.exit(12);
    return;
  }

  // 3) Resolve effective channel
  const config = loadConfig();
  const effectiveChannel = options.ref
    ? 'pinned'
    : resolveEffectiveChannel(config, detected.mode);

  // 4) Read state (mode-aware identity check; stale state is discarded)
  const rawState = readState(detected);
  const usableState = rawState && !rawState.__stale ? rawState : null;

  // 5) --check path (P0 scope ends here)
  if (options.check) {
    let info;
    try {
      info = await checkCliVersion(detected, effectiveChannel, options, {
        config,
        state: usableState,
      });
    } catch (e) {
      return handleCheckError(e);
    }
    printCheckReport(info);
    process.exit(info.needsUpdate ? 10 : 0);
    return;
  }

  // 6) Non-check path lands in P1+
  error('`ai-issue update` (without --check) is not yet implemented.');
  error('Run `ai-issue update --check` to see the version diff.');
  error('Phase P1 will add link-mode self-update; P2 will add copy-mode.');
  process.exit(12);
}

function handleCheckError(e) {
  if (e && e.code === 'NETWORK') {
    error(`Network error checking remote: ${e.message}`);
    process.exit(20);
    return;
  }
  if (e && (e.code === 'NO_TAGS' || e.code === 'NO_BRANCH' || e.code === 'NO_URL' || e.code === 'NO_REF')) {
    error(e.message);
    process.exit(12);
    return;
  }
  error(`Check failed: ${e && e.message ? e.message : e}`);
  process.exit(12);
}

module.exports = { cmdUpdate, handleCheckError };
