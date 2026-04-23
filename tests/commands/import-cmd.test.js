/**
 * Tests for commands/import-cmd.js
 */

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));
jest.mock('fs');
jest.mock('child_process');

const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

jest.mock('../../lib/service-client', () => ({
  serviceRequest: jest.fn(),
  serviceRequestStream: jest.fn(),
  getServiceUrl: jest.fn(() => 'https://service.example.com'),
  getServiceApiKey: jest.fn(() => 'test-key'),
}));

jest.mock('../../lib/config', () => ({
  loadConfig: jest.fn(() => ({
    repo: 'hashicorp/terraform-provider-azurerm',
    serviceUrl: 'https://service.example.com',
  })),
  DEFAULT_CONFIG: {},
  CONFIG_FILE: '/mock/home/.ai-issue/config.json',
  saveConfig: jest.fn(),
  isConfigured: jest.fn(),
  validateConfig: jest.fn(),
  VERSION: '0.0.0-test',
}));

jest.mock('../../lib/display-helpers', () => ({
  STATUS_STYLE: {
    triaged: { emoji: '📥', color: 'grey' },
    queued: { emoji: '🔄', color: 'blue' },
    solving: { emoji: '🔨', color: 'cyan' },
    solved: { emoji: '✅', color: 'green' },
    skipped: { emoji: '⏭️', color: 'yellow' },
    failed: { emoji: '❌', color: 'red' },
  },
  RECOMMENDATION_STYLE: {},
}));

const { cmdImport, parseSince, renderLine, renderSummary } = require('../../lib/commands/import-cmd');
const { serviceRequest, serviceRequestStream, getServiceUrl } = require('../../lib/service-client');
const { log, error, info } = require('../../lib/logger');

beforeEach(() => {
  jest.clearAllMocks();
  // Re-set mocks after clearAllMocks
  getServiceUrl.mockReturnValue('https://service.example.com');
  const { loadConfig } = require('../../lib/config');
  loadConfig.mockReturnValue({
    repo: 'hashicorp/terraform-provider-azurerm',
    serviceUrl: 'https://service.example.com',
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});


// ══════════════════════════════════════════════════════
// parseSince
// ══════════════════════════════════════════════════════

describe('parseSince', () => {
  test('converts 30d to ISO date', () => {
    const result = parseSince('30d');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // Should be approximately 30 days ago
    const parsed = new Date(result);
    const daysAgo = (Date.now() - parsed.getTime()) / 86400000;
    expect(daysAgo).toBeGreaterThanOrEqual(29);
    expect(daysAgo).toBeLessThanOrEqual(31);
  });

  test('converts 7d to ISO date', () => {
    const result = parseSince('7d');
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('passes ISO date through unchanged', () => {
    expect(parseSince('2025-01-01')).toBe('2025-01-01');
  });

  test('returns empty string for empty input', () => {
    expect(parseSince('')).toBe('');
  });

  test('returns empty string for null/undefined', () => {
    expect(parseSince(null)).toBe('');
    expect(parseSince(undefined)).toBe('');
  });
});


// ══════════════════════════════════════════════════════
// renderLine
// ══════════════════════════════════════════════════════

describe('renderLine', () => {
  test('renders progress line', () => {
    renderLine({ type: 'progress', current: 50, total: 100, message: 'Processing...' }, false);
    expect(info).toHaveBeenCalled();
    const msg = info.mock.calls[0][0];
    expect(msg).toContain('50.0%');
  });

  test('renders progress with zero total', () => {
    renderLine({ type: 'progress', current: 0, total: 0, message: 'Fetching...' }, false);
    expect(info).toHaveBeenCalled();
    const msg = info.mock.calls[0][0];
    expect(msg).toContain('Fetching...');
  });

  test('renders issue line with status', () => {
    renderLine({ type: 'issue', number: 100, status: 'solved', reason: 'closed with PR', pr: 200 }, false);
    expect(log).toHaveBeenCalled();
    const msg = log.mock.calls[0][0];
    expect(msg).toContain('100');
    expect(msg).toContain('solved');
  });

  test('renders skipped line', () => {
    renderLine({ type: 'skipped', number: 200, reason: 'already in pipeline' }, false);
    expect(log).toHaveBeenCalled();
    const msg = log.mock.calls[0][0];
    expect(msg).toContain('200');
    expect(msg).toContain('skipped');
  });

  test('renders error line', () => {
    renderLine({ type: 'error', number: 300, message: 'DB error' }, false);
    expect(error).toHaveBeenCalled();
    const msg = error.mock.calls[0][0];
    expect(msg).toContain('300');
    expect(msg).toContain('DB error');
  });

  test('renders issue line with resource_name', () => {
    renderLine({ type: 'issue', number: 123, status: 'triaged', reason: 'needs triage', resource_name: 'azurerm_network_interface' }, false);
    expect(log).toHaveBeenCalled();
    const msg = log.mock.calls[0][0];
    expect(msg).toContain('[azurerm_network_interface]');
  });

  test('renders issue line with recommendation', () => {
    renderLine({ type: 'issue', number: 123, status: 'triaged', reason: 'needs triage', recommendation: 'PROCEED' }, false);
    expect(log).toHaveBeenCalled();
    const msg = log.mock.calls[0][0];
    expect(msg).toContain('PROCEED');
  });

  test('handles missing triage fields gracefully', () => {
    renderLine({ type: 'issue', number: 123, status: 'solved', reason: 'closed with merged PR' }, false);
    expect(log).toHaveBeenCalled();
    const msg = log.mock.calls[0][0];
    expect(msg).toContain('123');
    expect(msg).toContain('solved');
    expect(msg).not.toContain('[');
    expect(msg).not.toContain('PROCEED');
  });
});


// ══════════════════════════════════════════════════════
// renderSummary
// ══════════════════════════════════════════════════════

describe('renderSummary', () => {
  test('renders import summary', () => {
    renderSummary({ imported: 80, skipped: 15, errors: 5, by_status: { solved: 50, skipped: 30 } }, false);
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.includes('Import complete'))).toBe(true);
    expect(calls.some(c => c.includes('80'))).toBe(true);
  });

  test('renders dry run summary', () => {
    renderSummary({ imported: 10, skipped: 5, errors: 0, by_status: {} }, true);
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.includes('Dry run'))).toBe(true);
  });
});


// ══════════════════════════════════════════════════════
// cmdImport
// ══════════════════════════════════════════════════════

describe('cmdImport', () => {
  test('calls serviceRequestStream with correct path', async () => {
    serviceRequestStream.mockResolvedValue({ imported: 0 });
    await cmdImport({ mode: 'full' });
    expect(serviceRequestStream).toHaveBeenCalledWith(
      'POST',
      '/import/hashicorp/terraform-provider-azurerm',
      expect.any(Object),
      expect.any(Function),
    );
  });

  test('passes mode param', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ mode: 'full' });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.mode).toBe('full');
  });

  test('passes state param', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ state: 'open' });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.state).toBe('open');
  });

  test('passes since param converted from 30d', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ since: '30d' });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.since).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test('passes since param as ISO date', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ since: '2025-01-01' });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.since).toBe('2025-01-01');
  });

  test('passes labels param', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ labels: 'bug,enhancement' });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.labels).toBe('bug,enhancement');
  });

  test('passes limit param', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ limit: '100' });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.limit).toBe('100');
  });

  test('does not include skip_triage in queryParams', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ mode: 'full' });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params).not.toHaveProperty('skip_triage');
  });

  test('passes dryRun flag', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ dryRun: true });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.dry_run).toBe('true');
  });

  test('passes force flag', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ force: true });
    const params = serviceRequestStream.mock.calls[0][2];
    expect(params.force).toBe('true');
  });

  test('shows error when service URL not configured', async () => {
    getServiceUrl.mockReturnValue('');
    await cmdImport({});
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Service URL'));
  });

  test('shows error when repo not configured', async () => {
    const { loadConfig } = require('../../lib/config');
    loadConfig.mockReturnValue({ serviceUrl: 'https://x.com' });
    await cmdImport({});
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Repository'));
  });

  test('handles stream error gracefully', async () => {
    serviceRequestStream.mockRejectedValue(new Error('Network error'));
    await cmdImport({});
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Network error'));
  });

  test('renders DRY RUN in title', async () => {
    serviceRequestStream.mockResolvedValue(null);
    await cmdImport({ dryRun: true });
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.includes('DRY RUN'))).toBe(true);
  });
});


// ══════════════════════════════════════════════════════
// cmdImport --status
// ══════════════════════════════════════════════════════

describe('cmdImport --status', () => {
  test('shows import status', async () => {
    getServiceUrl.mockReturnValue('https://service.example.com');
    serviceRequest.mockResolvedValue({
      status: 200,
      data: {
        state: 'completed', mode: 'full', total_issues: 100,
        processed: 100, imported: 80, skipped: 15, errors: 5,
        started_at: '2025-01-01T00:00:00Z', completed_at: '2025-01-01T01:00:00Z',
      },
    });
    await cmdImport({ status: true });
    expect(serviceRequest).toHaveBeenCalledWith('GET', expect.stringContaining('/import/'));
    const calls = log.mock.calls.map(c => c[0]);
    expect(calls.some(c => c.includes('completed'))).toBe(true);
  });

  test('shows message when no import found', async () => {
    getServiceUrl.mockReturnValue('https://service.example.com');
    serviceRequest.mockResolvedValue({ status: 404, data: {} });
    await cmdImport({ status: true });
    expect(info).toHaveBeenCalledWith(expect.stringContaining('No import jobs'));
  });

  test('handles status query error', async () => {
    getServiceUrl.mockReturnValue('https://service.example.com');
    serviceRequest.mockResolvedValue({ status: 500, data: {} });
    await cmdImport({ status: true });
    expect(error).toHaveBeenCalledWith(expect.stringContaining('500'));
  });
});
