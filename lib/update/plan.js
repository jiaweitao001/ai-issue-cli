// @ts-check
/**
 * Build the immutable plan object that drives the ai-issue update worker.
 *
 * The plan is the contract between the main process (decision-maker) and the
 * detached worker (executor). All decisions — channel, target ref, downgrade
 * detection, refChangesHead, working-tree state — are made here so the worker
 * can stay deps-free and just execute commands.
 *
 * UPDATE_COMMAND_PROPOSAL.md §4.5 + §6.1.
 */

const path = require('path');
const { checkCliVersion } = require('./version-check');

/**
 * @typedef {object} UpdatePlan
 * @property {'link'|'copy'} mode
 * @property {string|null} sourceClone
 * @property {string} globalPkg
 * @property {string|null} currentBranch
 * @property {boolean} workingTreeDirty
 * @property {string} upstreamUrl
 *
 * @property {string} configuredChannel
 * @property {string} effectiveChannel
 * @property {string} channelReason
 *
 * @property {string} fromVersion
 * @property {string|null} fromCommit
 * @property {string} fromLabel
 *
 * @property {string|null} toCommit
 * @property {string} toLabel
 * @property {string} resolvedTargetRef
 * @property {string|null} targetBranch
 *
 * @property {boolean} needsUpdate
 * @property {boolean} isDowngrade
 * @property {boolean} refChangesHead
 *
 * @property {boolean} skipSkills
 */

/**
 * @param {{ detected: any, effectiveChannel: string, options?: { skipSkills?: boolean, [k: string]: any }, config?: any, state?: any }} args
 */
async function buildUpdatePlan({ detected, effectiveChannel, options = {}, config, state }) {
  const info = await checkCliVersion(detected, effectiveChannel, options, { config, state });

  const targetBranch = extractTargetBranch(info.toRef, detected, effectiveChannel);

  /** @type {UpdatePlan} */
  const plan = {
    mode: detected.mode,
    sourceClone: detected.sourceClone || null,
    globalPkg: detected.globalPkg,
    currentBranch: detected.currentBranch || null,
    workingTreeDirty: !!detected.workingTreeDirty,
    upstreamUrl: info.upstreamUrl,

    configuredChannel: info.configuredChannel,
    effectiveChannel: info.effectiveChannel,
    channelReason: info.channelReason,

    fromVersion: info.fromVersion,
    fromCommit: info.fromCommit,
    fromLabel: info.fromLabel,

    toCommit: info.toCommit,
    toLabel: info.toLabel,
    resolvedTargetRef: info.toRef,
    targetBranch,

    needsUpdate: !!info.needsUpdate,
    isDowngrade: detectIsDowngrade(effectiveChannel, info.fromVersion, info.toLabel, options),
    refChangesHead: detectRefChangesHead(detected, info.toRef),

    skipSkills: !!options.skipSkills,
  };

  return plan;
}

/**
 * Refuse-state for link mode: "would the worker have to change the user's branch?"
 *
 * In link mode we ONLY ever do `git fetch + git merge --ff-only` on the current
 * branch. Any target ref that isn't the current branch (a tag, a SHA, a different
 * branch) would require checkout, which we refuse to do (UPDATE_COMMAND_PROPOSAL.md §4.5).
 *
 * For copy mode this is irrelevant (the worker manages its own clone).
 */
function detectRefChangesHead(detected, resolvedTargetRef) {
  if (detected.mode !== 'link') return false;
  if (!detected.currentBranch || detected.currentBranch === 'HEAD') return false;
  if (!resolvedTargetRef) return false;
  if (resolvedTargetRef === `refs/heads/${detected.currentBranch}`) return false;
  if (resolvedTargetRef === detected.currentBranch) return false;
  return true;
}

/**
 * Conservative downgrade detection. Only fires when both endpoints are semver-parseable.
 * For branch / SHA targets we can't decide and return false (UPDATE_COMMAND_PROPOSAL.md §6.1).
 */
function detectIsDowngrade(effectiveChannel, fromVersion, toLabel, options) {
  if (effectiveChannel === 'branch') return false;
  if (effectiveChannel === 'pinned') {
    const ref = options && options.ref;
    if (!ref || !/^(refs\/tags\/)?v?\d+\.\d+\.\d+/.test(ref)) return false;
  }
  const fromV = parseSemver(fromVersion);
  const toV = parseSemver(toLabel);
  if (!fromV || !toV) return false;
  return compareSemver(fromV, toV) > 0;
}

function parseSemver(s) {
  if (!s || typeof s !== 'string') return null;
  const stripped = s.replace(/^refs\/tags\//, '');
  const m = stripped.match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function compareSemver(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  return a.patch - b.patch;
}

/**
 * The branch name we'll `git fetch origin <branch>` in the worker.
 * For tag / pinned-ref targets in link mode we'd have rejected via refChangesHead
 * before reaching the worker, so this only matters for branch channel.
 */
function extractTargetBranch(toRef, detected, effectiveChannel) {
  if (effectiveChannel !== 'branch') return null;
  if (toRef && toRef.startsWith('refs/heads/')) {
    return toRef.replace(/^refs\/heads\//, '');
  }
  if (detected && detected.currentBranch && detected.currentBranch !== 'HEAD') {
    return detected.currentBranch;
  }
  return null;
}

module.exports = {
  buildUpdatePlan,
  detectRefChangesHead,
  detectIsDowngrade,
  extractTargetBranch,
};
