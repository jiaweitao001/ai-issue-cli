/**
 * Tests for lib/git-utils.js
 */

const { execSync, execFileSync } = require('child_process');

jest.mock('child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn()
}));

const { runGit, runGitArgs } = require('../lib/git-utils');

describe('git-utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('runGit', () => {
    it('should execute command in the specified repo path', () => {
      execSync.mockReturnValue('output\n');
      runGit('/path/to/repo', 'git status');

      expect(execSync).toHaveBeenCalledWith('git status', {
        cwd: '/path/to/repo',
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8'
      });
    });

    it('should trim whitespace from output', () => {
      execSync.mockReturnValue('  some output  \n');
      const result = runGit('/repo', 'git rev-parse HEAD');
      expect(result).toBe('some output');
    });

    it('should return empty string when output is only whitespace', () => {
      execSync.mockReturnValue('  \n');
      const result = runGit('/repo', 'git status --porcelain');
      expect(result).toBe('');
    });

    it('should propagate errors from execSync', () => {
      execSync.mockImplementation(() => {
        throw new Error('Command failed: git checkout nonexistent');
      });
      expect(() => runGit('/repo', 'git checkout nonexistent')).toThrow('Command failed');
    });

    it('should use pipe for stdout and stderr', () => {
      execSync.mockReturnValue('abc123\n');
      runGit('/repo', 'git rev-parse HEAD');

      const callArgs = execSync.mock.calls[0][1];
      expect(callArgs.stdio).toEqual(['ignore', 'pipe', 'pipe']);
    });

    it('should use utf8 encoding', () => {
      execSync.mockReturnValue('output\n');
      runGit('/repo', 'git log --oneline -1');

      const callArgs = execSync.mock.calls[0][1];
      expect(callArgs.encoding).toBe('utf8');
    });
  });

  describe('runGitArgs', () => {
    it('should call execFileSync with -C and the argv list, no shell', () => {
      execFileSync.mockReturnValue('done\n');
      runGitArgs('/path/to/repo', ['commit', '-m', 'hello']);

      expect(execFileSync).toHaveBeenCalledWith(
        'git',
        ['-C', '/path/to/repo', 'commit', '-m', 'hello'],
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          encoding: 'utf8'
        })
      );
    });

    it('should preserve shell metacharacters verbatim in argv (no shell expansion)', () => {
      execFileSync.mockReturnValue('');
      const evilBody = 'Body with `backticks` and $(cmd) and "quotes" and \nnewlines';
      runGitArgs('/repo', ['commit', '-m', 'title', '-m', evilBody]);

      expect(execFileSync.mock.calls[0][1]).toEqual([
        '-C', '/repo', 'commit', '-m', 'title', '-m', evilBody
      ]);
    });

    it('should trim trailing whitespace from output', () => {
      execFileSync.mockReturnValue('  abc123\n');
      expect(runGitArgs('/repo', ['rev-parse', 'HEAD'])).toBe('abc123');
    });

    it('should propagate errors from execFileSync', () => {
      execFileSync.mockImplementation(() => {
        throw new Error('git commit failed');
      });
      expect(() => runGitArgs('/repo', ['commit', '-m', 'x'])).toThrow('git commit failed');
    });

    it('should merge custom opts into the spawn call', () => {
      execFileSync.mockReturnValue('');
      runGitArgs('/repo', ['status'], { timeout: 5000 });
      const opts = execFileSync.mock.calls[0][2];
      expect(opts.timeout).toBe(5000);
      expect(opts.encoding).toBe('utf8');
    });
  });
});
