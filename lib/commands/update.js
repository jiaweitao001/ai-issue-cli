// @ts-check
/**
 * `ai-issue update` command (UPDATE_COMMAND_PROPOSAL.md §4.5).
 *
 * P0 SCOPE (shipped): read-only `--check` path end-to-end (mode detection,
 * channel resolution, mode-aware state, three-state tag detection, report).
 *
 * P1 SCOPE (this commit): link-mode self-update.
 *   - buildUpdatePlan derives all decisions in the main process.
 *   - downgrade / dirty-tree / detached-HEAD / refChangesHead guards.
 *   - acquireUpdateLock owns the entire atomic O_EXCL + watch-active.lock check.
 *   - spawnWorker stages a deps-free worker outside the package and detaches.
 *   - copy mode is rejected with a clear "P2 not implemented yet" message.
 */

const { loadConfig } = require('../config');
const { log, error } = require('../logger');
const { detectCliInstall } = require('../update/detect');
const { ensureStateOwnership, readState } = require('../update/state');
const {
  resolveEffectiveChannel,
  checkCliVersion,
  printCheckReport,
} = require('../update/version-check');
const { buildUpdatePlan } = require('../update/plan');
const { acquireUpdateLock, releaseUpdateLock } = require('../update/lock');
const { spawnWorker, cleanupStaleCache } = require('../update/spawn-worker');

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

  // 5) --check path
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

  // 6) P1 only handles link mode. Copy mode lands in P2.
  if (detected.mode === 'copy') {
    error('Copy-mode self-update is not yet implemented (P2 work).');
    error('Manual workaround: cd <your-clone> && git pull && npm install -g .');
    process.exit(12);
    return;
  }

  // 7) Build the plan (calls checkCliVersion under the hood)
  let plan;
  try {
    plan = await buildUpdatePlan({
      detected,
      effectiveChannel,
      options,
      config,
      state: usableState,
    });
  } catch (e) {
    return handleCheckError(e);
  }

  // 8) Downgrade protection
  if (plan.isDowngrade && !options.confirmDowngrade) {
    error(`This is a downgrade (${plan.fromLabel} → ${plan.toLabel}).`);
    error('Pass --confirm-downgrade to proceed.');
    process.exit(2);
    return;
  }

  // 9) Already up-to-date short-circuit (--force skips this)
  if (!plan.needsUpdate && !options.force) {
    log(`✅ Already up to date (${plan.fromLabel}).`);
    process.exit(0);
    return;
  }

  // 10) Link-mode preconditions
  if (plan.workingTreeDirty) {
    error('Source clone has uncommitted changes; refusing to auto-update.');
    error(`  Source: ${plan.sourceClone}`);
    error('  Run `git status` there, then commit/stash and retry.');
    process.exit(12);
    return;
  }
  if (plan.currentBranch === 'HEAD' || !plan.currentBranch) {
    error('Source clone is in detached HEAD state (or branch could not be determined).');
    if (plan.sourceClone) error(`  Source: ${plan.sourceClone}`);
    error('  Run `git checkout <branch>` there, then retry.');
    process.exit(12);
    return;
  }
  if (plan.refChangesHead) {
    error(`Target ${plan.resolvedTargetRef} (${plan.toLabel}) would change HEAD in link mode.`);
    error(`  Source clone   : ${plan.sourceClone}`);
    error(`  Current branch : ${plan.currentBranch}`);
    error(`  Channel reason : ${plan.channelReason}`);
    error('  link mode never modifies your branch state. To proceed, pick one:');
    error(`    1) git -C ${plan.sourceClone} checkout ${plan.resolvedTargetRef}`);
    error('       then rerun ai-issue update');
    if (plan.channelReason === 'explicit') {
      error('    2) ai-issue config set updateChannel branch');
      error(`       (revert to tracking ${plan.currentBranch} HEAD)`);
    } else {
      error('    2) ai-issue config set updateChannel branch');
      error(`       (track ${plan.currentBranch} HEAD instead of release tags)`);
    }
    process.exit(12);
    return;
  }

  // 11) Acquire update lock (atomic O_EXCL + watch-active.lock check)
  try {
    acquireUpdateLock();
  } catch (e) {
    error(e.message);
    process.exit(12);
    return;
  }

  // 12) Spawn detached worker. Main process exits immediately; worker output
  //     goes to the inherited terminal stdio.
  try {
    cleanupStaleCache();
  } catch (_e) { /* best-effort */ }

  let spawned;
  try {
    spawned = spawnWorker(plan);
  } catch (e) {
    releaseUpdateLock();
    error(`Failed to spawn update worker: ${e.message}`);
    process.exit(12);
    return;
  }

  log('');
  log(`🚀 Update worker started (pid ${spawned.pid}). Output will appear above as it runs.`);
  log('   You can close this terminal — the worker will continue in the background.');
  process.exit(0);
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
