/**
 * Tests for lib/update/detect.js
 *
 * Covers UPDATE_COMMAND_PROPOSAL.md §4.2 install mode detection.
 */

jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const { detectCliInstall, getNpmRootGlobal, PKG_NAME } = require('../../lib/update/detect');

function makeStat({ symlink = false, dir = false } = {}) {
  return {
    isSymbolicLink: () => symlink,
    isDirectory: () => dir,
  };
}

describe('lib/update/detect', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getNpmRootGlobal', () => {
    it('returns trimmed stdout from `npm root -g`', () => {
      execFileSync.mockReturnValue('/opt/homebrew/lib/node_modules\n');
      expect(getNpmRootGlobal()).toBe('/opt/homebrew/lib/node_modules');
      expect(execFileSync).toHaveBeenCalledWith('npm', ['root', '-g'], expect.any(Object));
    });

    it('returns null when npm is not on PATH', () => {
      execFileSync.mockImplementation(() => { throw new Error('ENOENT npm'); });
      expect(getNpmRootGlobal()).toBeNull();
    });
  });

  describe('detectCliInstall', () => {
    it('returns mode=unknown when npm root -g fails', () => {
      execFileSync.mockImplementation(() => { throw new Error('npm missing'); });
      const r = detectCliInstall();
      expect(r.mode).toBe('unknown');
      expect(r.reason).toMatch(/npm root -g/);
    });

    it('returns mode=unknown when global pkg path is missing', () => {
      execFileSync.mockImplementation((cmd, args) => {
        if (cmd === 'npm' && args[0] === 'root') return '/npm/root';
        throw new Error('not used');
      });
      fs.lstatSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const r = detectCliInstall();
      expect(r.mode).toBe('unknown');
      expect(r.globalPkg).toBe(path.join('/npm/root', PKG_NAME));
      expect(r.reason).toMatch(/Global package not present/);
    });

    it('returns mode=link when global pkg is a symlink', () => {
      execFileSync.mockImplementation((cmd, args, opts) => {
        if (cmd === 'npm' && args[0] === 'root') return '/npm/root';
        if (cmd === 'git' && args[0] === 'rev-parse') {
          expect(opts.cwd).toBe('/Users/me/Work/ai-issue-cli');
          return 'main\n';
        }
        if (cmd === 'git' && args[0] === 'status') return ''; // clean tree
        throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
      });
      fs.lstatSync.mockReturnValue(makeStat({ symlink: true }));
      fs.realpathSync.mockReturnValue('/Users/me/Work/ai-issue-cli');

      const r = detectCliInstall();
      expect(r.mode).toBe('link');
      expect(r.sourceClone).toBe('/Users/me/Work/ai-issue-cli');
      expect(r.currentBranch).toBe('main');
      expect(r.workingTreeDirty).toBe(false);
    });

    it('reports working tree dirty when git status --porcelain has output', () => {
      let statusCallArgs = null;
      execFileSync.mockImplementation((cmd, args) => {
        if (cmd === 'npm' && args[0] === 'root') return '/npm/root';
        if (cmd === 'git' && args[0] === 'rev-parse') return 'feature/x\n';
        if (cmd === 'git' && args[0] === 'status') { statusCallArgs = args; return ' M lib/foo.js\n'; }
        throw new Error('unexpected');
      });
      fs.lstatSync.mockReturnValue(makeStat({ symlink: true }));
      fs.realpathSync.mockReturnValue('/clone');

      const r = detectCliInstall();
      expect(r.workingTreeDirty).toBe(true);
      expect(r.currentBranch).toBe('feature/x');
      // -uno excludes untracked files (ff-merge doesn't care about them)
      expect(statusCallArgs).toContain('-uno');
    });

    it('returns currentBranch=null when git rev-parse fails', () => {
      execFileSync.mockImplementation((cmd, args) => {
        if (cmd === 'npm' && args[0] === 'root') return '/npm/root';
        throw new Error('git missing');  // any git call fails
      });
      fs.lstatSync.mockReturnValue(makeStat({ symlink: true }));
      fs.realpathSync.mockReturnValue('/clone');

      const r = detectCliInstall();
      expect(r.mode).toBe('link');
      expect(r.currentBranch).toBeNull();
      expect(r.workingTreeDirty).toBe(false);
    });

    it('returns mode=unknown when realpath of symlink fails', () => {
      execFileSync.mockReturnValue('/npm/root');
      fs.lstatSync.mockReturnValue(makeStat({ symlink: true }));
      fs.realpathSync.mockImplementation(() => { throw new Error('broken link'); });

      const r = detectCliInstall();
      expect(r.mode).toBe('unknown');
      expect(r.reason).toMatch(/realpath failed/);
    });

    it('returns mode=copy when global pkg is a real directory', () => {
      execFileSync.mockReturnValue('/npm/root');
      fs.lstatSync.mockReturnValue(makeStat({ dir: true }));

      const r = detectCliInstall();
      expect(r.mode).toBe('copy');
      expect(r.globalPkg).toBe(path.join('/npm/root', PKG_NAME));
      expect(r.sourceClone).toBeUndefined();
    });

    it('returns mode=unknown for path that is neither symlink nor directory', () => {
      execFileSync.mockReturnValue('/npm/root');
      fs.lstatSync.mockReturnValue(makeStat({ symlink: false, dir: false }));

      const r = detectCliInstall();
      expect(r.mode).toBe('unknown');
      expect(r.reason).toMatch(/neither a symlink nor a directory/);
    });
  });
});
