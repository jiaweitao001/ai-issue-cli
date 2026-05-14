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

const mockUi = {
  header: jest.fn(),
  statusList: jest.fn(),
  log: jest.fn(),
  success: jest.fn(),
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  highlight: jest.fn((value) => value),
};
const mockCreateUi = jest.fn(() => mockUi);
jest.mock('../../lib/ui', () => ({
  createUi: mockCreateUi,
}));

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
const log = mockUi.log;
const error = mockUi.error;
const success = mockUi.success;
const warning = mockUi.warn;
const info = mockUi.info;

function renderedStatusText() {
  return JSON.stringify(mockUi.statusList.mock.calls.flat());
}

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
  let originalGithubToken;

  beforeEach(() => {
    jest.clearAllMocks();
    // Pin GITHUB_TOKEN so the environment.js GITHUB_TOKEN check passes
    // regardless of host shell (tests assert "All checks passed", which
    // is only true when every probe is green; a missing GITHUB_TOKEN
    // would make cmdCheck call process.exit(1) and trip the spy below).
    originalGithubToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = 'ghp_test_token_for_unit_tests';
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
    if (originalGithubToken === undefined) {
      delete process.env.GITHUB_TOKEN;
    } else {
      process.env.GITHUB_TOKEN = originalGithubToken;
    }
  });

  describe('local environment checks (existing behavior)', () => {
    it('should pass all checks when environment is properly configured', async () => {
      setupHappyPath();

      await cmdCheck();

      expect(mockCreateUi).toHaveBeenCalledWith(expect.objectContaining({
        flagPlain: false,
        flagTui: false,
        config: expect.any(Object),
      }));
      expect(success).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
    });

    it('passes explicit UI flags to createUi', async () => {
      setupHappyPath();

      await cmdCheck({ plain: true, tui: false, debug: true });

      expect(mockCreateUi).toHaveBeenCalledWith(expect.objectContaining({
        flagPlain: true,
        flagTui: false,
        debug: true,
      }));
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
      expect(mockUi.statusList).toHaveBeenCalled();
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('Configuration Validation');
      expect(statusText).toContain('/missing/kb-dir');
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

      const messages = renderedStatusText();
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('Local Knowledge Base');
      expect(statusText).toContain('Run: ai-issue kb download');
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('Local Knowledge Base');
      expect(statusText).toContain('Run: ai-issue kb verify');
    });
  });

  describe('service connectivity integration', () => {
    it('should render skipped service rows when serviceUrl is not configured', async () => {
      setupHappyPath();

      await cmdCheck();

      const statusText = renderedStatusText();
      expect(statusText).toContain('Service Reachability');
      expect(statusText).toContain('serviceUrl not configured');
      expect(statusText).toContain('Service Authentication');
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('Service Reachability');
      expect(statusText).toContain('serviceApiKey is set');
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('Service Reachability');
      expect(statusText).toContain('https://svc.example.com/health');
      expect(statusText).toContain('200');
      expect(statusText).toContain('Service Authentication');
      expect(statusText).toContain('credentialSent=Bearer');
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('az login');
      expect(statusText).toContain('Service Authentication');
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('Service Reachability');
      expect(statusText).toContain('ETIMEDOUT');
      expect(statusText).toContain('Service Authentication');
      expect(statusText).toContain('transport-level failure');
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

      expect(renderedStatusText()).toContain('INVALID_URL');
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

      const statusText = renderedStatusText();
      expect(statusText).toContain('Service Authentication');
      expect(statusText).toContain('anonymous access');
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
