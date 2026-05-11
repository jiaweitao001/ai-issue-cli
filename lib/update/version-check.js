// @ts-check
/**
 * Channel resolution + remote probing for ai-issue update.
 *
 * Public API:
 *   resolveEffectiveChannel(config, mode) -> 'tag' | 'branch'
 *   channelReasonOf(config, mode, hasRef) -> 'auto-link' | 'auto-copy' | 'explicit' | 'pinned'
 *   parseLsRemoteTags(rawOutput) -> { stable: [...], prerelease: [...] }
 *   probeRemote(url) -> { stable, prerelease, symrefHead, headSha }
 *   getUpstreamUrl(detected) -> string | null
 *   getInstalledVersion(detected, state) -> { version, commit }
 *   checkCliVersion(detected, effectiveChannel, opts, deps) -> info object
 *   printCheckReport(info, logger?) -> void
 *
 * Channel semantics (UPDATE_COMMAND_PROPOSAL.md §4.3.1, v3.3 mode-split):
 *   updateChannel='auto' (default): link install -> branch HEAD; copy install -> latest tag.
 *   updateChannel='tag'           : always latest stable semver tag (excludes prereleases).
 *   updateChannel='branch'        : always current-branch HEAD (link mode) or symref HEAD (copy).
 *   --ref <X>                     : 'pinned' channel that bypasses both.
 *
 * Tag selection (UPDATE_COMMAND_PROPOSAL.md §4.3.2, v3.3 three-state):
 *   probeRemote returns separate stable[] and prerelease[] lists so error
 *   messages can distinguish "no tags at all" from "only prereleases exist".
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REASON_LABELS = {
  'auto-link': 'auto, link mode default',
  'auto-copy': 'auto, copy mode default',
  'explicit': 'explicit',
  'pinned': 'pinned by --ref',
};

function resolveEffectiveChannel(config, mode) {
  const configured = (config && config.updateChannel) || 'auto';
  if (configured === 'auto') {
    return mode === 'link' ? 'branch' : 'tag';
  }
  return configured;
}

function channelReasonOf(config, mode, hasRef) {
  if (hasRef) return 'pinned';
  const configured = (config && config.updateChannel) || 'auto';
  if (configured === 'auto') return mode === 'link' ? 'auto-link' : 'auto-copy';
  return 'explicit';
}

function parseLsRemoteTags(rawOutput) {
  const tagToCommit = new Map();
  const lines = String(rawOutput || '').split('\n');
  for (const line of lines) {
    const m = line.match(/^([0-9a-f]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/);
    if (!m) continue;
    const [, sha, tag, deref] = m;
    if (deref) {
      tagToCommit.set(tag, sha);
    } else if (!tagToCommit.has(tag)) {
      tagToCommit.set(tag, sha);
    }
  }
  const stable = [];
  const prerelease = [];
  for (const [tag, commit] of tagToCommit) {
    const sm = tag.match(/^v?(\d+)\.(\d+)\.(\d+)(-[\w.+-]+)?$/);
    if (!sm) continue;
    const entry = {
      tag,
      commit,
      version: `${sm[1]}.${sm[2]}.${sm[3]}`,
      major: +sm[1],
      minor: +sm[2],
      patch: +sm[3],
      prerelease: sm[4] ? sm[4].slice(1) : null,
    };
    if (entry.prerelease) prerelease.push(entry);
    else stable.push(entry);
  }
  const cmp = (a, b) => {
    if (a.major !== b.major) return b.major - a.major;
    if (a.minor !== b.minor) return b.minor - a.minor;
    return b.patch - a.patch;
  };
  stable.sort(cmp);
  prerelease.sort(cmp);
  return { stable, prerelease };
}

function probeRemote(url) {
  let lsTags;
  try {
    lsTags = execFileSync('git', ['ls-remote', '--tags', url], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (/** @type {any} */ e) {
    const err = /** @type {Error & { code: string }} */ (new Error(`git ls-remote --tags ${url} failed: ${e.message}`));
    err.code = 'NETWORK';
    throw err;
  }
  const { stable, prerelease } = parseLsRemoteTags(lsTags);

  let symrefHead = null;
  let headSha = null;
  try {
    const symrefOut = execFileSync('git', ['ls-remote', '--symref', url, 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const refMatch = symrefOut.match(/^ref:\s+(\S+)\s+HEAD/m);
    if (refMatch) symrefHead = refMatch[1];
    const shaMatch = symrefOut.match(/^([0-9a-f]{40})\s+HEAD/m);
    if (shaMatch) headSha = shaMatch[1];
  } catch (_e) {
    // symref optional, fall back to assuming refs/heads/main
  }
  return { stable, prerelease, symrefHead, headSha };
}

function lsRemoteRef(url, ref) {
  try {
    const out = execFileSync('git', ['ls-remote', url, ref], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const m = out.match(/^([0-9a-f]{40})\s+/);
    return m ? m[1] : null;
  } catch (_e) {
    return null;
  }
}

function normalizeRepoUrl(url) {
  if (!url) return null;
  let normalized = url.replace(/^git\+/, '');
  if (normalized.startsWith('git@github.com:')) {
    normalized = 'https://github.com/' + normalized.slice('git@github.com:'.length);
  }
  return normalized;
}

function getUpstreamUrl(detected) {
  if (detected && detected.sourceClone) {
    try {
      const out = execFileSync('git', ['remote', 'get-url', 'origin'], {
        cwd: detected.sourceClone,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      if (out) return normalizeRepoUrl(out);
    } catch (_e) {
      // fall through
    }
  }
  const pkgDir = (detected && (detected.sourceClone || detected.globalPkg)) || null;
  if (pkgDir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
      const url = pkg && pkg.repository && pkg.repository.url;
      if (url) return normalizeRepoUrl(url);
    } catch (_e) {
      // fall through
    }
  }
  return null;
}

function getInstalledVersion(detected, state) {
  const pkgDir = (detected && (detected.sourceClone || detected.globalPkg)) || null;
  let version = null;
  if (pkgDir) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
      version = pkg && pkg.version ? pkg.version : null;
    } catch (_e) {
      // ignore
    }
  }
  let commit = null;
  if (detected && detected.mode === 'link' && detected.sourceClone) {
    try {
      commit = execFileSync('git', ['rev-parse', 'HEAD'], {
        cwd: detected.sourceClone,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
    } catch (_e) {
      // ignore
    }
  }
  if (!commit && state && state.commit) commit = state.commit;
  return { version, commit };
}

async function checkCliVersion(detected, effectiveChannel, opts = {}, deps = {}) {
  const config = deps.config || {};
  const state = deps.state || null;

  const url = getUpstreamUrl(detected);
  if (!url) {
    const err = /** @type {Error & { code: string }} */ (new Error(
      'Could not determine upstream URL. No `origin` remote in source clone and no repository.url in package.json.'
    ));
    err.code = 'NO_URL';
    throw err;
  }

  const probe = probeRemote(url);
  const installed = getInstalledVersion(detected, state);

  let toRef = null;
  let toCommit = null;
  let toLabel = null;

  if (effectiveChannel === 'tag') {
    if (probe.stable.length === 0) {
      const reason = probe.prerelease.length > 0
        ? `Only prerelease tags exist (filtered): ${probe.prerelease.map(p => p.tag).slice(0, 3).join(', ')}. ` +
          `Maintainer needs to publish a stable release, or run \`ai-issue config set updateChannel branch\`.`
        : `No tags found at all on upstream. ` +
          `Maintainer must publish a release first, or run \`ai-issue config set updateChannel branch\`.`;
      const err = /** @type {Error & { code: string }} */ (new Error(reason));
      err.code = 'NO_TAGS';
      throw err;
    }
    const latest = probe.stable[0];
    toRef = `refs/tags/${latest.tag}`;
    toCommit = latest.commit;
    toLabel = latest.tag;
  } else if (effectiveChannel === 'branch') {
    let branchName;
    if (detected.mode === 'link' && detected.currentBranch && detected.currentBranch !== 'HEAD') {
      branchName = detected.currentBranch;
    } else if (probe.symrefHead) {
      branchName = probe.symrefHead.replace(/^refs\/heads\//, '');
    } else {
      branchName = 'main';
    }
    let branchSha = lsRemoteRef(url, `refs/heads/${branchName}`);
    if (!branchSha && probe.headSha && (!detected.currentBranch || detected.currentBranch === 'HEAD')) {
      branchSha = probe.headSha;
    }
    if (!branchSha) {
      const err = /** @type {Error & { code: string }} */ (new Error(
        `Could not resolve branch HEAD for ${branchName} on upstream. ` +
        `Branch may not exist remotely.`
      ));
      err.code = 'NO_BRANCH';
      throw err;
    }
    toRef = `refs/heads/${branchName}`;
    toCommit = branchSha;
    toLabel = `${branchName}@${branchSha.slice(0, 7)}`;
  } else if (effectiveChannel === 'pinned') {
    const ref = opts.ref;
    if (!ref) {
      const err = /** @type {Error & { code: string }} */ (new Error("'pinned' channel requires opts.ref"));
      err.code = 'NO_REF';
      throw err;
    }
    toRef = ref;
    toCommit = null;
    toLabel = ref;
  } else {
    const err = /** @type {Error & { code: string }} */ (new Error(`Unsupported effectiveChannel: ${effectiveChannel}`));
    err.code = 'BAD_CHANNEL';
    throw err;
  }

  const fromVersion = installed.version || 'unknown';
  const fromCommit = installed.commit;
  const fromLabel = computeFromLabel(effectiveChannel, fromVersion, fromCommit, state);

  const needsUpdate = computeNeedsUpdate(effectiveChannel, fromVersion, fromCommit, toLabel, toCommit, state);

  return {
    mode: detected.mode,
    sourceClone: detected.sourceClone || null,
    globalPkg: detected.globalPkg || null,
    configuredChannel: (config && config.updateChannel) || 'auto',
    effectiveChannel,
    channelReason: channelReasonOf(config, detected.mode, !!opts.ref),
    fromVersion,
    fromLabel,
    fromCommit,
    toLabel,
    toCommit,
    toRef,
    needsUpdate,
    upstreamUrl: url,
  };
}

function computeFromLabel(effectiveChannel, fromVersion, fromCommit, state) {
  if (effectiveChannel === 'tag') {
    if (state && state.ref && state.ref.startsWith('refs/tags/')) {
      return state.ref.replace('refs/tags/', '');
    }
    return fromVersion === 'unknown' ? 'unknown' : `v${fromVersion}`;
  }
  if (fromCommit) return fromCommit.slice(0, 7);
  return fromVersion;
}

function computeNeedsUpdate(effectiveChannel, fromVersion, fromCommit, toLabel, toCommit, state) {
  if (effectiveChannel === 'tag') {
    if (state && state.commit && toCommit) return state.commit !== toCommit;
    if (fromVersion && fromVersion !== 'unknown') {
      const fromTag = `v${fromVersion}`;
      return fromTag !== toLabel;
    }
    return true;
  }
  if (effectiveChannel === 'branch') {
    if (fromCommit && toCommit) return fromCommit !== toCommit;
    return true;
  }
  return true;
}

function printCheckReport(info, logger) {
  const log = (logger && logger.log) || require('../logger').log;
  const reasonLabel = REASON_LABELS[info.channelReason] || info.channelReason;
  log('');
  log('🔄 AI Issue CLI Update Check (read-only)');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log('');
  const installLine = info.mode === 'link'
    ? `npm link (source: ${info.sourceClone})`
    : `npm install -g (global: ${info.globalPkg})`;
  log(`Install mode : ${installLine}`);
  log(`Channel      : ${info.effectiveChannel}  (configured: ${info.configuredChannel}, resolved: ${reasonLabel})`);
  log(`Current      : ${info.fromLabel}`);
  log(`Remote       : ${info.toLabel}`);
  log(`Status       : ${info.needsUpdate ? 'update available' : 'up to date'}`);
  log('');
  if (info.needsUpdate) {
    log("Run 'ai-issue update' to apply.");
    if (info.configuredChannel === 'auto') {
      const altChannel = info.effectiveChannel === 'tag' ? 'branch' : 'tag';
      log(`Override channel: 'ai-issue config set updateChannel ${altChannel}'`);
    }
  }
}

module.exports = {
  resolveEffectiveChannel,
  channelReasonOf,
  parseLsRemoteTags,
  probeRemote,
  lsRemoteRef,
  getUpstreamUrl,
  getInstalledVersion,
  checkCliVersion,
  printCheckReport,
  normalizeRepoUrl,
  REASON_LABELS,
};
