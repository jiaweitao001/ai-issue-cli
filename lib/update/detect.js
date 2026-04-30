// @ts-check
/**
 * Detect how ai-issue CLI is installed in the current Node environment.
 *
 * Returns one of:
 *   { mode: 'link', globalPkg, sourceClone, currentBranch, workingTreeDirty }
 *   { mode: 'copy', globalPkg }
 *   { mode: 'unknown', globalPkg?, reason }
 *
 * Detection algorithm (UPDATE_COMMAND_PROPOSAL.md §4.2):
 *   1. Resolve `npm root -g` to find the global node_modules directory.
 *   2. lstat <npmRoot>/ai-issue-cli (lstat does NOT follow symlinks).
 *   3. If symlink => link mode; resolve realpath as sourceClone.
 *   4. If directory => copy mode.
 *   5. Anything else (missing, regular file) => unknown.
 *
 * Why not require.resolve? In a globally-linked install, require.resolve
 * returns the symlink path, not the underlying clone — making it impossible
 * to distinguish link from copy without an lstat.
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const PKG_NAME = 'ai-issue-cli';

function tryExec(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    });
  } catch (_e) {
    return null;
  }
}

function getNpmRootGlobal() {
  const out = tryExec('npm', ['root', '-g']);
  if (!out) return null;
  return out.trim();
}

function detectCliInstall() {
  const npmRoot = getNpmRootGlobal();
  if (!npmRoot) {
    return { mode: 'unknown', reason: 'npm root -g failed (npm not on PATH?)' };
  }
  const globalPkg = path.join(npmRoot, PKG_NAME);

  let stat;
  try {
    stat = fs.lstatSync(globalPkg);
  } catch (_e) {
    return {
      mode: 'unknown',
      globalPkg,
      reason: `Global package not present at ${globalPkg}. ` +
        `Install with \`npm install -g .\` or \`npm link\` from a clone.`,
    };
  }

  if (stat.isSymbolicLink()) {
    let sourceClone;
    try {
      sourceClone = fs.realpathSync(globalPkg);
    } catch (e) {
      return {
        mode: 'unknown',
        globalPkg,
        reason: `realpath failed for symlink ${globalPkg}: ${e.message}`,
      };
    }
    const branchOut = tryExec('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: sourceClone });
    const currentBranch = branchOut ? branchOut.trim() : null;
    // -uno excludes untracked files: ff-merge can proceed safely with untracked files
    // present (they don't conflict with anything coming from origin), but unstaged
    // or staged changes to tracked files would be lost. Match git's own pull semantics.
    const statusOut = tryExec('git', ['status', '--porcelain', '-uno'], { cwd: sourceClone });
    const workingTreeDirty = statusOut !== null && statusOut.trim().length > 0;
    return { mode: 'link', globalPkg, sourceClone, currentBranch, workingTreeDirty };
  }

  if (stat.isDirectory()) {
    return { mode: 'copy', globalPkg };
  }

  return {
    mode: 'unknown',
    globalPkg,
    reason: `${globalPkg} is neither a symlink nor a directory.`,
  };
}

module.exports = { detectCliInstall, getNpmRootGlobal, PKG_NAME };
