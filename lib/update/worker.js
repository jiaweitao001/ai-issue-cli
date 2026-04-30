#!/usr/bin/env node
// @ts-check
'use strict';
/**
 * ai-issue update WORKER
 *
 * HARD CONSTRAINT (UPDATE_COMMAND_PROPOSAL.md §4.4.1):
 *   This file is staged to ~/.ai-issue/cache/update-worker-<sha>.js BEFORE
 *   the actual install runs. It MUST only `require(...)` Node built-ins.
 *   Any project-internal helper (logger, chalk, etc.) is a footgun: the
 *   running self-update is about to overwrite those files on disk.
 *
 * Enforced by tests/update/worker-isolation.test.js (static AST + regex scan).
 *
 * Lifecycle (UPDATE_COMMAND_PROPOSAL.md §4.4.2):
 *   1. Re-write update.lock with worker pid (continues lock ownership).
 *   2. Switch on plan.mode:
 *      - link: git fetch + git merge --ff-only + npm install (+ skills:install).
 *      - copy: P2 — managed clone path; not implemented in P1.
 *   3. Write ~/.ai-issue/state/install-<hash>.json on success.
 *   4. Release update.lock.
 *   5. Print summary, exit 0/non-zero.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ANSI_GREEN = '\x1b[32m';
const ANSI_RED = '\x1b[31m';
const ANSI_YELLOW = '\x1b[33m';
const ANSI_CYAN = '\x1b[36m';
const ANSI_RESET = '\x1b[0m';

function log(msg) { process.stdout.write(msg + '\n'); }
function logStep(msg) { log(`${ANSI_CYAN}→${ANSI_RESET} ${msg}`); }
function logOk(msg) { log(`${ANSI_GREEN}✅${ANSI_RESET} ${msg}`); }
function logWarn(msg) { log(`${ANSI_YELLOW}⚠️  ${msg}${ANSI_RESET}`); }
function logErr(msg) { log(`${ANSI_RED}❌${ANSI_RESET} ${msg}`); }

function parsePlanArg(argv) {
  const args = argv || process.argv.slice(2);
  const i = args.indexOf('--plan');
  if (i === -1 || i + 1 >= args.length) {
    throw new Error('Worker requires --plan <path>');
  }
  return args[i + 1];
}

function loadPlan(planPath) {
  return JSON.parse(fs.readFileSync(planPath, 'utf8'));
}

function lockPaths() {
  const lockDir = path.join(os.homedir(), '.ai-issue', 'locks');
  return {
    lockDir,
    update: path.join(lockDir, 'update.lock'),
  };
}

function takeOverLock() {
  const p = lockPaths();
  try {
    fs.mkdirSync(p.lockDir, { recursive: true });
    fs.writeFileSync(p.update, JSON.stringify({
      pid: process.pid,
      startedAt: new Date().toISOString(),
      role: 'worker',
    }));
  } catch (e) {
    logWarn(`Could not refresh update.lock: ${e.message}`);
  }
}

function releaseLock() {
  const p = lockPaths();
  try { fs.unlinkSync(p.update); } catch (_e) { /* best-effort */ }
}

function runCommand(bin, args, cwd, label) {
  logStep(label || `${bin} ${args.join(' ')}`);
  try {
    execFileSync(bin, args, {
      cwd,
      stdio: 'inherit',
      env: process.env,
    });
  } catch (e) {
    const err = new Error(`${bin} ${args.join(' ')} failed in ${cwd}: ${e.message}`);
    // @ts-ignore
    err.exitCode = (e && e.status) ? e.status : 12;
    throw err;
  }
}

function runLinkUpdate(plan) {
  if (!plan.sourceClone) throw new Error('link plan requires sourceClone');
  if (!plan.targetBranch) throw new Error('link plan requires targetBranch');
  if (!plan.toCommit) throw new Error('link plan requires toCommit');

  const cwd = plan.sourceClone;

  runCommand('git', ['fetch', 'origin', plan.targetBranch], cwd,
    `git fetch origin ${plan.targetBranch}`);

  runCommand('git', ['merge', '--ff-only', plan.toCommit], cwd,
    `git merge --ff-only ${plan.toCommit.slice(0, 7)}`);

  runCommand('npm', ['install'], cwd, 'npm install');

  if (!plan.skipSkills) {
    try {
      runCommand('npm', ['run', 'skills:install'], cwd, 'npm run skills:install');
    } catch (e) {
      logWarn(`skills:install failed (non-fatal): ${e.message}`);
    }
  }
}

function managedCloneDir() {
  return path.join(os.homedir(), '.ai-issue', 'source', 'ai-issue-cli');
}

function runCopyUpdate(plan) {
  if (!plan.upstreamUrl) throw new Error('copy plan requires upstreamUrl');
  if (!plan.globalPkg) throw new Error('copy plan requires globalPkg');

  const cloneDir = managedCloneDir();
  const parentDir = path.dirname(cloneDir);

  // First-time setup: clone if missing
  if (!fs.existsSync(cloneDir)) {
    try { fs.mkdirSync(parentDir, { recursive: true }); } catch (_e) { /* race-tolerant */ }
    runCommand('git', ['clone', plan.upstreamUrl, cloneDir], parentDir,
      `git clone ${plan.upstreamUrl} (managed clone)`);
  }

  // Always fetch fresh refs (origin's tags + branches)
  runCommand('git', ['fetch', '--tags', '--prune', 'origin'], cloneDir,
    'git fetch --tags --prune origin');

  // Checkout target — works for tags (detached HEAD), branches (creates tracking),
  // and bare SHAs. The managed clone is never touched interactively, so detached
  // HEAD here is fine.
  const checkoutTarget = plan.toCommit || plan.resolvedTargetRef;
  if (!checkoutTarget) throw new Error('copy plan requires toCommit or resolvedTargetRef');
  runCommand('git', ['checkout', '--force', checkoutTarget], cloneDir,
    `git checkout ${String(checkoutTarget).slice(0, 40)}`);

  // Install deps in the managed clone
  runCommand('npm', ['install', '--prefix', cloneDir], cloneDir, 'npm install');

  // Install globally — capture EACCES with non-sudo guidance (UPDATE_COMMAND_PROPOSAL §4.2.4)
  try {
    runCommand('npm', ['install', '-g', cloneDir], cloneDir, 'npm install -g .');
  } catch (e) {
    if (looksLikeEACCES(e)) {
      const guidance = new Error(
        'npm install -g failed with EACCES on the global prefix.\n' +
        '  Fix WITHOUT sudo by setting a user-writable npm prefix:\n' +
        '    mkdir -p ~/.npm-global\n' +
        '    npm config set prefix ~/.npm-global\n' +
        '    export PATH="$HOME/.npm-global/bin:$PATH"   # add to your shell rc\n' +
        '  Then rerun `ai-issue update`.\n' +
        '  (Do NOT `sudo npm install -g`; it leaves root-owned files in your home.)'
      );
      // @ts-ignore
      guidance.exitCode = 21;
      throw guidance;
    }
    throw e;
  }

  if (!plan.skipSkills) {
    try {
      runCommand('npm', ['run', '--prefix', cloneDir, 'skills:install'], cloneDir,
        'npm run skills:install');
    } catch (e) {
      logWarn(`skills:install failed (non-fatal): ${e.message}`);
    }
  }

  // Verify install: cannot execFile a .js directly on Windows, so go via process.execPath
  verifyGlobalInstall(plan);
}

function looksLikeEACCES(e) {
  const msg = (e && e.message) ? String(e.message) : '';
  return /EACCES|permission denied|Operation not permitted/i.test(msg);
}

function verifyGlobalInstall(plan) {
  const aiIssueJs = path.join(plan.globalPkg, 'ai-issue.js');
  let versionOut;
  try {
    versionOut = String(execFileSync(process.execPath, [aiIssueJs, '--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })).trim();
  } catch (e) {
    logWarn(`Could not verify install via \`node ${aiIssueJs} --version\`: ${e.message}`);
    return;
  }
  log(`   installed binary reports: ${versionOut}`);

  // Best-effort: where/which the user's PATH resolves 'ai-issue' to.
  const onPath = whichBinary('ai-issue');
  if (onPath) {
    log(`   PATH resolves \`ai-issue\` to: ${onPath}`);
  } else {
    logWarn(
      '`ai-issue` was not found on PATH. The package was installed but your ' +
      'shell may need to be reopened, or your npm prefix bin dir may not be on PATH.'
    );
  }
}

function whichBinary(name) {
  const bin = process.platform === 'win32' ? 'where' : 'which';
  try {
    const out = String(execFileSync(bin, [name], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })).trim();
    // `where` may return multiple lines; take the first
    return out.split(/\r?\n/)[0] || null;
  } catch (_e) {
    return null;
  }
}

function statePathFor(globalPkg) {
  const hash = crypto.createHash('sha256').update(String(globalPkg)).digest('hex').slice(0, 12);
  return path.join(os.homedir(), '.ai-issue', 'state', `install-${hash}.json`);
}

function writeStateFile(plan) {
  if (!plan.globalPkg) return;
  const stateDir = path.join(os.homedir(), '.ai-issue', 'state');
  try { fs.mkdirSync(stateDir, { recursive: true }); } catch (_e) { /* race-tolerant */ }
  const data = {
    version: stripVPrefix(plan.toLabel) || plan.fromVersion,
    commit: plan.toCommit,
    ref: plan.resolvedTargetRef,
    channel: plan.effectiveChannel,
    mode: plan.mode,
    sourceClone: plan.sourceClone || null,
    installedAt: new Date().toISOString(),
    installedBy: 'ai-issue-update-worker',
  };
  fs.writeFileSync(statePathFor(plan.globalPkg), JSON.stringify(data, null, 2));
}

function stripVPrefix(s) {
  if (!s || typeof s !== 'string') return null;
  const m = s.match(/^v?(\d+\.\d+\.\d+(?:-[\w.+-]+)?)/);
  return m ? m[1] : null;
}

function main(argv) {
  let planPath;
  let plan;
  try {
    planPath = parsePlanArg(argv);
    plan = loadPlan(planPath);
  } catch (e) {
    logErr(`Worker bootstrap failed: ${e.message}`);
    process.exit(99);
    return;
  }

  log('');
  log(`${ANSI_CYAN}🔄 ai-issue update worker${ANSI_RESET} (mode=${plan.mode}, channel=${plan.effectiveChannel})`);
  log('');

  takeOverLock();

  let exitCode = 0;
  try {
    if (plan.mode === 'link') {
      runLinkUpdate(plan);
    } else if (plan.mode === 'copy') {
      runCopyUpdate(plan);
    } else {
      throw new Error(`Unsupported plan.mode: ${plan.mode}`);
    }
    writeStateFile(plan);
    log('');
    logOk(`Update complete: ${plan.fromLabel} → ${plan.toLabel}`);
  } catch (e) {
    log('');
    logErr(`Update failed: ${e && e.message ? e.message : e}`);
    // @ts-ignore
    exitCode = (e && typeof e.exitCode === 'number') ? e.exitCode : 12;
  } finally {
    releaseLock();
  }
  process.exit(exitCode);
}

if (require.main === module) {
  main();
}

module.exports = {
  main,
  parsePlanArg,
  loadPlan,
  takeOverLock,
  releaseLock,
  runLinkUpdate,
  runCopyUpdate,
  writeStateFile,
  statePathFor,
  stripVPrefix,
  managedCloneDir,
  whichBinary,
  verifyGlobalInstall,
  looksLikeEACCES,
};
