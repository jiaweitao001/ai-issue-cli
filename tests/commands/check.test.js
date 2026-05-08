/**
 * Tests for commands/check.js
 */
const { execSync } = require('child_process');
const fs = require('fs');

jest.mock('child_process');
jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock logger
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

// Mock service-health so that check.js' integration of the service probe
// is testable in isolation from the network layer.
const mockCheckServiceConnectivity = jest.fn();
const mockHintsFor = jest.fn(() => []);
jest.mock('../../lib/service-health', () => ({
  checkServiceConnectivity: mockCheckServiceConnectivity,
  hintsFor: mockHintsFor,
}));

// Mock migration-notifier so we can verify check.js triggers the forced banner.
const mockShowMigrationBannerForced = jest.fn();
jest.mock('../../lib/migration-notifier', () => ({
  showMigrationBannerForced: mockShowMigrationBannerForced,
  maybeShowMigrationBanner: jest.fn(),
}));

const { cmdCheck } = require('../../lib/commands/check');
const { log, error, success, warning, info } = require('../../lib/logger');

/**
 * Default mock for fs that simulates a properly-configured environment.
 * Individual tests override as needed.
 */
function setupHappyPath() {
  execSync.mockReturnValue('1.0.0');
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify({
    repoPath: '/test/repo',
    reportPath: '/test/reports',
  }));
  fs.writeFileSync.mockReturnValue(undefined);
  fs.unlinkSync.mockReturnValue(undefined);
}

describe('commands/check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default: service not configured (so most tests don't need to set it).
    mockCheckServiceConnectivity.mockResolvedValue({
      configured: false,
      mismatch: false,
      reachability: null,
      auth: null,
      authSkipReason: 'service not configured',
      hints: [],
    });
    // Mock process.exit
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    process.exit.mockRestore();
  });

  describe('local environment checks (existing behavior)', () => {
    it('should pass all checks when environment is properly configured', async () => {
      setupHappyPath();

      await cmdCheck();

      expect(success).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
    });

    it('should fail when Copilot CLI is not installed', async () => {
      execSync.mockImplementation(() => { throw new Error('command not found'); });
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '/test/repo',
        reportPath: '/test/reports',
      }));

      await expect(cmdCheck()).rejects.toThrow('process.exit called');
      expect(error).toHaveBeenCalled();
    });

    it('should fail when repository path does not exist', async () => {
      execSync.mockReturnValue('1.0.0');
      fs.existsSync.mockImplementation((path) => {
        if (path.includes('repo')) return false;
        return true;
      });
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '/test/repo',
        reportPath: '/test/reports',
      }));

      await expect(cmdCheck()).rejects.toThrow('process.exit called');
    });

    it('should display help messages for failed checks', async () => {
      execSync.mockImplementation(() => { throw new Error('command not found'); });
      fs.existsSync.mockReturnValue(false);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '',
        reportPath: '',
      }));

      await expect(cmdCheck()).rejects.toThrow('process.exit called');
      expect(warning).toHaveBeenCalled();
    });

    it('should warn that repo .mcp.json is ignored for Claude Code strict MCP mode', async () => {
      setupHappyPath();
      fs.existsSync.mockImplementation((p) => {
        if (p === '/test/repo/.mcp.json') return true;
        return true;
      });

      await cmdCheck({ agent: 'claude-code' });

      expect(info).toHaveBeenCalledWith(expect.stringContaining('repository .mcp.json will be ignored'));
    });

    it('renders configWarnings as a non-failing line under section 0', async () => {
      // Simulate a properly-configured repo but with a knowledgeBasePath
      // pointing at a directory that does not exist yet (the typical state
      // before PR4 lands `ai-issue kb download`).
      execSync.mockReturnValue('1.0.0');
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '/test/repo',
        reportPath: '/test/reports',
        knowledgeBasePath: '/missing/kb-dir'
      }));
      fs.writeFileSync.mockReturnValue(undefined);
      fs.unlinkSync.mockReturnValue(undefined);
      // Everything else exists; only the KB dir is missing.
      fs.existsSync.mockImplementation(p => p !== '/missing/kb-dir');
      fs.statSync.mockImplementation(() => ({
        isDirectory: () => true,
      }));

      try {
        await cmdCheck();
      } catch (_e) {
        // process.exit may be triggered by GITHUB_TOKEN/agent checks in
        // unrelated environments; we only care about the warning rendering.
      }

      const warningLines = warning.mock.calls.flat().join('\n');
      const infoLines = info.mock.calls.flat().join('\n');
      expect(warningLines).toContain('Configuration Validation');
      expect(infoLines).toContain('/missing/kb-dir');
      expect(success).not.toHaveBeenCalledWith(expect.stringContaining('0. ✅ Configuration Validation'));
    });

    it('shows downloaded KB version and entry count', async () => {
      execSync.mockReturnValue('1.0.0');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((p) => {
        if (String(p).includes('manifest.json')) {
          return JSON.stringify({
            version: '2026.05.07',
            kbSha256: 'a'.repeat(64),
            entryCount: 3,
          });
        }
        return JSON.stringify({
          repoPath: '/test/repo',
          reportPath: '/test/reports',
          knowledgeBasePath: '/mock/home/.ai-issue/kb/2026.05.07',
        });
      });
      fs.writeFileSync.mockReturnValue(undefined);
      fs.unlinkSync.mockReturnValue(undefined);

      await cmdCheck();

      const messages = success.mock.calls.flat().join('\n');
      expect(messages).toContain('Local Knowledge Base');
      expect(messages).toContain('2026.05.07');
      expect(messages).toContain('3 entries');
      expect(messages).toContain('~/.ai-issue/kb/2026.05.07');
    });

    it('shows download hint when configured KB dir is missing', async () => {
      execSync.mockReturnValue('1.0.0');
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '/test/repo',
        reportPath: '/test/reports',
        knowledgeBasePath: '/mock/home/.ai-issue/kb/missing',
      }));
      fs.existsSync.mockImplementation((p) => p !== '/mock/home/.ai-issue/kb/missing');

      await expect(cmdCheck()).rejects.toThrow('process.exit called');

      const errors = error.mock.calls.flat().join('\n');
      const warnings = warning.mock.calls.flat().join('\n');
      expect(errors).toContain('Local Knowledge Base');
      expect(warnings).toContain('Run: ai-issue kb download');
    });

    it('shows verify hint when configured KB manifest is corrupted', async () => {
      execSync.mockReturnValue('1.0.0');
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation((p) => {
        if (String(p).includes('manifest.json')) return '{bad';
        return JSON.stringify({
          repoPath: '/test/repo',
          reportPath: '/test/reports',
          knowledgeBasePath: '/mock/home/.ai-issue/kb/corrupt',
        });
      });

      await expect(cmdCheck()).rejects.toThrow('process.exit called');

      const errors = error.mock.calls.flat().join('\n');
      const warnings = warning.mock.calls.flat().join('\n');
      expect(errors).toContain('Local Knowledge Base');
      expect(warnings).toContain('Run: ai-issue kb verify');
    });
  });

  describe('service connectivity integration', () => {
    it('should render skipped service rows when serviceUrl is not configured', async () => {
      setupHappyPath();

      await cmdCheck();

      const allMessages = [
        ...log.mock.calls.flat(),
        ...success.mock.calls.flat(),
      ].join('\n');
      expect(allMessages).toContain('Service Reachability');
      expect(allMessages).toContain('serviceUrl not configured');
      expect(allMessages).toContain('Service Authentication');
      // Should still pass overall.
      expect(success).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
    });

    it('should render warning when serviceApiKey set but serviceUrl missing', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: false,
        mismatch: true,
        reachability: null,
        auth: null,
        authSkipReason: 'service not configured',
        hints: [],
      });

      await cmdCheck();

      const warningMessages = warning.mock.calls.flat().join('\n');
      expect(warningMessages).toContain('Service Reachability');
      expect(warningMessages).toContain('serviceApiKey is set');
      // Mismatch is a warning, not a fail.
      expect(success).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
    });

    it('should render all-green when both probes succeed', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: true, status: 200, latencyMs: 100, url: 'https://svc.example.com/health' },
        auth: { ok: true, status: 200, latencyMs: 200, url: 'https://svc.example.com/pipeline?limit=1', credentialSent: 'Bearer' },
        authSkipReason: null,
        hints: [],
      });

      await cmdCheck();

      const successMessages = success.mock.calls.flat().join('\n');
      expect(successMessages).toContain('Service Reachability');
      expect(successMessages).toContain('https://svc.example.com/health');
      expect(successMessages).toContain('200');
      expect(successMessages).toContain('Service Authentication');
      expect(successMessages).toContain('credentialSent=Bearer');
      expect(success).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
    });

    it('should fail with hints when auth probe returns 401', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: true, status: 200, latencyMs: 100, url: 'https://svc.example.com/health' },
        auth: { ok: false, status: 401, latencyMs: 90, url: 'https://svc.example.com/pipeline?limit=1', credentialSent: 'Bearer' },
        authSkipReason: null,
        hints: [],
      });
      mockHintsFor.mockImplementation((probe, kind) => {
        if (kind === 'auth' && probe.status === 401) return ['Azure CLI Bearer token rejected. Try: az login'];
        return [];
      });

      await expect(cmdCheck()).rejects.toThrow('process.exit called');

      const warningMessages = warning.mock.calls.flat().join('\n');
      expect(warningMessages).toContain('az login');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Service Authentication'));
    });

    it('should render skipped auth row when reachability has transport-level failure', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: false, errorCode: 'ETIMEDOUT', latencyMs: 5000, url: 'https://svc.example.com/health' },
        auth: null,
        authSkipReason: 'transport-level failure on /health',
        hints: [],
      });
      mockHintsFor.mockReturnValue(['Connection timed out. Check VPN/firewall.']);

      await expect(cmdCheck()).rejects.toThrow('process.exit called');

      const errorMessages = error.mock.calls.flat().join('\n');
      expect(errorMessages).toContain('Service Reachability');
      expect(errorMessages).toContain('ETIMEDOUT');
      const allLogs = [...log.mock.calls.flat()].join('\n');
      expect(allLogs).toContain('Service Authentication');
      expect(allLogs).toContain('transport-level failure');
    });

    it('should fail with INVALID_URL hint when serviceUrl is malformed', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: false, errorCode: 'INVALID_URL', error: 'Invalid URL', serviceUrl: '://nope' },
        auth: null,
        authSkipReason: 'transport-level failure on /health',
        hints: [],
      });
      mockHintsFor.mockReturnValue(['serviceUrl is not a valid URL: ://nope']);

      await expect(cmdCheck()).rejects.toThrow('process.exit called');

      const errorMessages = error.mock.calls.flat().join('\n');
      expect(errorMessages).toContain('INVALID_URL');
    });

    it('should warn (not fail) on 200 + credentialSent=none for auth probe', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: true, status: 200, latencyMs: 100, url: 'https://svc.example.com/health' },
        auth: { ok: false, status: 200, unexpectedShape: false, latencyMs: 90, url: 'https://svc.example.com/pipeline?limit=1', credentialSent: 'none' },
        authSkipReason: null,
        hints: [],
      });

      // Note: in service-health.js logic, status=200 + Array body => ok=true.
      // The 200+credentialSent=none scenario most realistic when shapeCheck sees
      // an array; our mocked probe sets ok=false to simulate the warn path.
      // Use the explicit signal exposed by check.js: name+status+credentialSent=none.

      await cmdCheck();

      const warningMessages = warning.mock.calls.flat().join('\n');
      expect(warningMessages).toContain('Service Authentication');
      const infoMessages = info.mock.calls.flat().join('\n');
      expect(infoMessages).toContain('anonymous access');
      // Anonymous access is a warning, not a fail.
      expect(success).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
    });
  });

  describe('migration banner integration', () => {
    it('triggers forced migration banner when svc.migration is present', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: true, status: 200, latencyMs: 100, url: 'https://svc.example.com/health' },
        auth: { ok: true, status: 200, latencyMs: 200, url: 'https://svc.example.com/pipeline?limit=1', credentialSent: 'Bearer' },
        authSkipReason: null,
        hints: [],
        migration: { newUrl: 'https://new-svc.example.com', deadline: '2026-06-15' },
      });

      await cmdCheck();

      expect(mockShowMigrationBannerForced).toHaveBeenCalledWith({
        newUrl: 'https://new-svc.example.com',
        deadline: '2026-06-15',
      });
    });

    it('does NOT call forced banner when svc.migration is null', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: true, status: 200, latencyMs: 100, url: 'https://svc.example.com/health' },
        auth: { ok: true, status: 200, latencyMs: 200, url: 'https://svc.example.com/pipeline?limit=1', credentialSent: 'Bearer' },
        authSkipReason: null,
        hints: [],
        migration: null,
      });

      await cmdCheck();

      expect(mockShowMigrationBannerForced).not.toHaveBeenCalled();
    });

    it('forces banner even on otherwise-failing check (so users see migration even when service is broken)', async () => {
      setupHappyPath();
      mockCheckServiceConnectivity.mockResolvedValue({
        configured: true,
        mismatch: false,
        reachability: { ok: false, status: 500, latencyMs: 100, url: 'https://svc.example.com/health' },
        auth: { ok: false, status: 500, latencyMs: 100, url: 'https://svc.example.com/pipeline?limit=1', credentialSent: 'Bearer' },
        authSkipReason: null,
        hints: [],
        migration: { newUrl: 'https://new-svc.example.com' },
      });

      await expect(cmdCheck()).rejects.toThrow('process.exit called');
      // Forced banner is invoked BEFORE the failure exit.
      expect(mockShowMigrationBannerForced).toHaveBeenCalledWith({
        newUrl: 'https://new-svc.example.com',
      });
    });
  });
});
