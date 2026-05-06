/**
 * Tests for lib/review-tool.js
 */

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

jest.mock('fs');
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn()
}));
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn(() => 'darwin'),
  homedir: jest.fn(() => '/mock/home')
}));
const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());
jest.mock('../lib/copilot', () => ({
  runCopilot: jest.fn()
}));
jest.mock('../lib/git-utils', () => ({
  runGit: jest.fn()
}));

const { isReviewToolInRepo, findInstallerScript, ensureReviewToolInstalled, runPostPhase2AutoReview } = require('../lib/review-tool');
const { runGit } = require('../lib/git-utils');
const { runCopilot } = require('../lib/copilot');
const { info, success, warning } = require('../lib/logger');
const os = require('os');

describe('review-tool', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    os.platform.mockReturnValue('darwin');
  });

  describe('isReviewToolInRepo', () => {
    it('should return true when prompt file exists', () => {
      fs.existsSync.mockImplementation((p) => {
        return p.includes('code-review-committed-changes.prompt.md');
      });
      expect(isReviewToolInRepo('/repo')).toBe(true);
    });

    it('should return true when chatmode file exists', () => {
      fs.existsSync.mockImplementation((p) => {
        return p.includes('code-review-committed-changes.chatmode.md');
      });
      expect(isReviewToolInRepo('/repo')).toBe(true);
    });

    it('should return false when no review files exist', () => {
      fs.existsSync.mockReturnValue(false);
      expect(isReviewToolInRepo('/repo')).toBe(false);
    });
  });

  describe('findInstallerScript', () => {
    it('should find .sh script on Unix', () => {
      os.platform.mockReturnValue('darwin');
      fs.existsSync.mockImplementation((p) => p.endsWith('.sh'));
      const result = findInstallerScript('/installer');
      expect(result).toContain('install-copilot-setup.sh');
    });

    it('should find .ps1 script on Windows', () => {
      os.platform.mockReturnValue('win32');
      fs.existsSync.mockImplementation((p) => p.endsWith('.ps1'));
      const result = findInstallerScript('/installer');
      expect(result).toContain('install-copilot-setup.ps1');
    });

    it('should return null when no script found', () => {
      fs.existsSync.mockReturnValue(false);
      expect(findInstallerScript('/installer')).toBeNull();
    });

    it('should prefer .sh on Unix even if both exist', () => {
      os.platform.mockReturnValue('linux');
      fs.existsSync.mockReturnValue(true);
      const result = findInstallerScript('/installer');
      expect(result).toContain('.sh');
    });

    it('should prefer .ps1 on Windows even if both exist', () => {
      os.platform.mockReturnValue('win32');
      fs.existsSync.mockReturnValue(true);
      const result = findInstallerScript('/installer');
      expect(result).toContain('.ps1');
    });
  });

  describe('ensureReviewToolInstalled', () => {
    it('should return true when tool already in repo', () => {
      fs.existsSync.mockImplementation((p) => {
        return p.includes('code-review-committed-changes.prompt.md');
      });
      expect(ensureReviewToolInstalled('/repo', '/installer', 'https://example.com/repo.git')).toBe(true);
    });

    it('should return false when no repo URL', () => {
      fs.existsSync.mockReturnValue(false);
      expect(ensureReviewToolInstalled('/repo', '/installer', '')).toBe(false);
    });

    it('should clone and run installer when not present', () => {
      let callCount = 0;
      fs.existsSync.mockImplementation((p) => {
        // First calls: tool not in repo, script not found, installer dir not found
        // After clone: script found
        // After run: tool in repo
        if (p.includes('code-review-committed-changes')) {
          callCount++;
          return callCount > 2; // true on third check (verification)
        }
        if (p.includes('install-copilot-setup.sh')) {
          return callCount >= 1; // found after clone
        }
        return false;
      });
      execFileSync.mockReturnValue('');

      const result = ensureReviewToolInstalled('/repo', '/installer', 'https://example.com/repo.git');
      expect(execFileSync).toHaveBeenCalled();
      expect(result).toBe(true);
    });

    it('should return false when clone fails', () => {
      fs.existsSync.mockReturnValue(false);
      execFileSync.mockImplementation(() => {
        throw new Error('clone failed');
      });
      expect(ensureReviewToolInstalled('/repo', '/installer', 'https://example.com/repo.git')).toBe(false);
    });
  });

  describe('runPostPhase2AutoReview', () => {
    const mockConfig = { repoPath: '/repo', model: 'gpt-4', logLevel: 'info' };

    it('should skip when prePhase2Head is empty (cannot construct review range)', async () => {
      // Regression test for I7: an empty prePhase2Head would yield an invalid
      // `..HEAD` range; runPostPhase2AutoReview must fall back to skipping.
      await runPostPhase2AutoReview('42', mockConfig, { silent: true }, '');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('pre-Phase 2 HEAD unavailable'));
      expect(runCopilot).not.toHaveBeenCalled();
    });

    it('should skip when no new commits', async () => {
      runGit.mockReturnValue('abc123');
      await runPostPhase2AutoReview('42', mockConfig, { silent: true }, 'abc123');
      expect(info).toHaveBeenCalledWith('No new commits from Phase 2, skipping auto review.');
      expect(runCopilot).not.toHaveBeenCalled();
    });

    it('should skip when HEAD check fails', async () => {
      runGit.mockImplementation(() => {
        throw new Error('not a git repo');
      });
      await runPostPhase2AutoReview('42', mockConfig, { silent: true }, 'abc123');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Skip auto review'));
    });

    it('should run review when new commits exist and tool is available', async () => {
      runGit.mockImplementation((_, cmd) => {
        if (cmd.includes('rev-parse')) return 'newhead';
        if (cmd.includes('status --porcelain')) return '';
        return '';
      });
      fs.existsSync.mockReturnValue(true); // review tool present
      runCopilot.mockResolvedValue(undefined);

      await runPostPhase2AutoReview('42', mockConfig, { silent: true }, 'oldhead');
      expect(runCopilot).toHaveBeenCalled();
      // Range-based prompt: must reference oldhead..HEAD, NOT "latest commit"
      const reviewPrompt = runCopilot.mock.calls[0][0];
      expect(reviewPrompt).toContain('oldhead..HEAD');
      expect(reviewPrompt).not.toContain('the latest commit');
      expect(success).toHaveBeenCalledWith('Auto review completed, no additional fixes required');
    });

    it('should commit review fixes when changes are generated', async () => {
      let statusCallCount = 0;
      runGit.mockImplementation((_, cmd) => {
        if (cmd.includes('rev-parse')) return 'newhead';
        if (cmd.includes('status --porcelain')) {
          statusCallCount++;
          // First call: no dirty files (no stash needed)
          // Second call: review generated changes
          return statusCallCount === 1 ? '' : 'M file.go';
        }
        return '';
      });
      fs.existsSync.mockReturnValue(true);
      runCopilot.mockResolvedValue(undefined);

      await runPostPhase2AutoReview('42', mockConfig, { silent: true }, 'oldhead');
      expect(runGit).toHaveBeenCalledWith('/repo', 'git add -A');
      expect(runGit).toHaveBeenCalledWith('/repo', 'git commit -m "Fix #42: address AI review comments"');
      expect(success).toHaveBeenCalledWith('Review comments addressed and committed');
    });

    it('should continue when review step fails', async () => {
      runGit.mockImplementation((_, cmd) => {
        if (cmd.includes('rev-parse')) return 'newhead';
        if (cmd.includes('status --porcelain')) return '';
        return '';
      });
      fs.existsSync.mockReturnValue(true);
      runCopilot.mockRejectedValue(new Error('copilot failed'));

      await runPostPhase2AutoReview('42', mockConfig, { silent: true }, 'oldhead');
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('Auto review step failed'));
    });
  });
});
