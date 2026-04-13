/**
 * Tests for lib/git-utils.js
 */

const { execSync } = require('child_process');

jest.mock('child_process', () => ({
  execSync: jest.fn()
}));

const { runGit } = require('../lib/git-utils');

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
});
