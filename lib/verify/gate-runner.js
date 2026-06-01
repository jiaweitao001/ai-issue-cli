// @ts-check

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runGit, runGitArgs } = require('../git-utils');

const TAIL_LIMIT = 8 * 1024;

/**
 * @param {string} value
 * @param {number} limit
 * @returns {string}
 */
function tail(value, limit = TAIL_LIMIT) {
  const text = String(value || '');
  if (text.length <= limit) return text;
  return text.slice(text.length - limit);
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
function gitStatus(repoPath) {
  return runGit(repoPath, 'git status --porcelain=v1 -z');
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
function captureDiff(repoPath) {
  const status = runGit(repoPath, 'git status --porcelain') || '';
  const summary = runGit(repoPath, 'git diff --compact-summary') || '';
  const diff = runGit(repoPath, 'git diff -- .') || '';
  return tail(`${status}\n\n${summary}\n\n${diff}`);
}

/**
 * @param {string} repoPath
 * @returns {string}
 */
function createWorktree(repoPath) {
  const worktreePath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-verify-'));
  runGitArgs(repoPath, ['worktree', 'add', '--detach', worktreePath, 'HEAD']);
  return worktreePath;
}

/**
 * @param {string} repoPath
 * @param {string} worktreePath
 */
function removeWorktree(repoPath, worktreePath) {
  try {
    runGitArgs(repoPath, ['worktree', 'remove', '--force', worktreePath]);
  } catch (_err) {
    fs.rmSync(worktreePath, { recursive: true, force: true });
  }
}

/**
 * @param {string} repoPath
 * @param {{ cmd: string, args: string[] }} command
 * @param {number} timeoutSec
 * @returns {Promise<{ exitCode: number|null, output: string, timedOut: boolean }>}
 */
function runCommand(repoPath, command, timeoutSec) {
  return new Promise((resolve) => {
    const child = spawn(command.cmd, command.args, {
      cwd: repoPath,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let output = '';
    let settled = false;
    const timeout = setTimeout(() => {
      settled = true;
      child.kill('SIGTERM');
      resolve({ exitCode: null, output: tail(`${output}\nTimed out after ${timeoutSec}s`), timedOut: true });
    }, Math.max(1, timeoutSec) * 1000);

    child.stdout.on('data', chunk => { output = tail(output + chunk.toString(), TAIL_LIMIT * 2); });
    child.stderr.on('data', chunk => { output = tail(output + chunk.toString(), TAIL_LIMIT * 2); });
    child.on('error', err => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: 127, output: err.message, timedOut: false });
    });
    child.on('close', code => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode: code, output: tail(output), timedOut: false });
    });
  });
}

/**
 * @param {string} repoPath
 * @param {import('../types').VerifyGate} gate
 * @param {number} timeoutSec
 * @returns {Promise<import('../types').VerifyGateResult>}
 */
async function runGate(repoPath, gate, timeoutSec) {
  const startedAt = Date.now();
  const beforeStatus = gitStatus(repoPath);
  if (beforeStatus) {
    return {
      gateId: gate.id,
      passed: false,
      skipped: true,
      exitCode: null,
      durationMs: Date.now() - startedAt,
      output: 'verify-loop skipped gate: working tree was dirty before gate execution',
      guidance: gate.guidance
    };
  }

  let worktreePath = '';
  let combined = '';
  let exitCode = 0;
  let timedOut = false;
  try {
    worktreePath = createWorktree(repoPath);
    for (const command of gate.commands) {
      const result = await runCommand(worktreePath, command, timeoutSec);
      combined = tail(`${combined}\n$ ${command.cmd} ${command.args.join(' ')}\n${result.output}`, TAIL_LIMIT * 2);
      exitCode = result.exitCode === null ? -1 : result.exitCode;
      timedOut = result.timedOut;
      if (exitCode !== 0) break;
    }

    const passed = exitCode === 0;
    let generatedDiff = '';
    const afterStatus = gitStatus(worktreePath);
    if (afterStatus) {
      generatedDiff = captureDiff(worktreePath);
    }
    if (passed && afterStatus) {
      return {
        gateId: gate.id,
        passed: false,
        exitCode: 1,
        durationMs: Date.now() - startedAt,
        output: tail(`${combined}\nGate passed command exit codes but left working-tree changes in disposable worktree.`),
        generatedDiff,
        guidance: gate.guidance
      };
    }

    return {
      gateId: gate.id,
      passed,
      exitCode,
      durationMs: Date.now() - startedAt,
      output: tail(timedOut ? `${combined}\nTimed out after ${timeoutSec}s` : combined),
      generatedDiff,
      guidance: gate.guidance
    };
  } finally {
    if (worktreePath) {
      removeWorktree(repoPath, worktreePath);
    }
  }
}

module.exports = {
  TAIL_LIMIT,
  tail,
  runCommand,
  createWorktree,
  removeWorktree,
  runGate
};
