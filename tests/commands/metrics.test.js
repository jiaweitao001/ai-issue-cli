/**
 * Tests for commands/metrics.js
 */

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));
jest.mock('fs');
jest.mock('child_process');

// Mock logger
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

// Mock service-client
jest.mock('../../lib/service-client', () => ({
  serviceRequest: jest.fn(),
  getServiceUrl: jest.fn(() => 'https://service.example.com'),
  getServiceApiKey: jest.fn(() => 'test-key'),
}));

// Mock display-helpers rendering functions
jest.mock('../../lib/display-helpers', () => ({
  STATUS_STYLE: {},
  RECOMMENDATION_STYLE: {},
  renderMetricsTable: jest.fn(),
  renderMetricsList: jest.fn(),
}));

const fs = require('fs');
const { cmdMetrics, displayMetrics, formatPercent, formatHours, formatPeriod } = require('../../lib/commands/metrics');
const { serviceRequest, getServiceUrl } = require('../../lib/service-client');
const { renderMetricsTable, renderMetricsList } = require('../../lib/display-helpers');
const { log, error, info, warning } = require('../../lib/logger');

// Sample metrics response
const SAMPLE_METRICS = {
  period: { since: '2026-03-15T00:00:00+00:00', until: '2026-04-14T23:59:59+00:00' },
  summary: {
    total_issues: 42,
    solved: 30,
    failed: 5,
    in_progress: 4,
    pending: 3,
    solve_rate: 0.857,
  },
  by_engineer: [
    {
      owner: 'alice',
      total_issues: 15,
      solved: 12,
      failed: 1,
      in_progress: 1,
      pending: 1,
      solve_rate: 0.923,
      avg_response_time_hours: 1.8,
      p50_response_time_hours: 0.8,
      p90_response_time_hours: 4.2,
      avg_solve_time_hours: 12.5,
      p50_solve_time_hours: 8.0,
      p90_solve_time_hours: 24.0,
    },
    {
      owner: 'bob',
      total_issues: 14,
      solved: 10,
      failed: 2,
      in_progress: 2,
      pending: 0,
      solve_rate: 0.833,
      avg_response_time_hours: 3.1,
      p50_response_time_hours: 1.5,
      p90_response_time_hours: 8.0,
      avg_solve_time_hours: 22.0,
      p50_solve_time_hours: 15.0,
      p90_solve_time_hours: 40.0,
    },
  ],
  by_status: { triaged: 3, queued: 0, solving: 4, solved: 30, failed: 5 },
  by_complexity: { LOW: 12, MEDIUM: 20, HIGH: 8, CRITICAL: 2 },
};

describe('commands/metrics', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      reportPath: '/test/reports',
      repo: 'test/repo',
    }));
    getServiceUrl.mockReturnValue('https://service.example.com');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cmdMetrics', () => {
    it('should fetch and display metrics with default options', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_METRICS });

      await cmdMetrics({});

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/metrics/test/repo', null, {
        owner: undefined,
        since: '30d',
        until: undefined,
      });
      // Should call renderMetricsTable (wide terminal default)
      expect(renderMetricsTable).toHaveBeenCalled();
    });

    it('should pass --owner filter to API', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_METRICS });

      await cmdMetrics({ owner: 'alice' });

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/metrics/test/repo', null,
        expect.objectContaining({ owner: 'alice' })
      );
    });

    it('should pass --since parameter to API', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_METRICS });

      await cmdMetrics({ since: '7d' });

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/metrics/test/repo', null,
        expect.objectContaining({ since: '7d' })
      );
    });

    it('should pass --until parameter to API', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_METRICS });

      await cmdMetrics({ until: '2026-04-01' });

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/metrics/test/repo', null,
        expect.objectContaining({ until: '2026-04-01' })
      );
    });

    it('should show empty data message when no issues', async () => {
      const emptyData = {
        ...SAMPLE_METRICS,
        summary: { ...SAMPLE_METRICS.summary, total_issues: 0 },
      };
      serviceRequest.mockResolvedValue({ status: 200, data: emptyData });

      await cmdMetrics({});

      expect(info).toHaveBeenCalledWith('No data for this period.');
      expect(renderMetricsTable).not.toHaveBeenCalled();
    });

    it('should handle HTTP error', async () => {
      serviceRequest.mockResolvedValue({ status: 500, data: { detail: 'Internal error' } });

      await cmdMetrics({});

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Metrics query failed (HTTP 500)'));
    });

    it('should handle 403 permission denied', async () => {
      serviceRequest.mockResolvedValue({ status: 403, data: { detail: 'Forbidden' } });

      await cmdMetrics({});

      expect(error).toHaveBeenCalledWith('Permission denied. Only managers can view metrics.');
    });

    it('should handle network error', async () => {
      serviceRequest.mockRejectedValue(new Error('ECONNREFUSED'));

      await cmdMetrics({});

      expect(error).toHaveBeenCalledWith('Metrics query failed: ECONNREFUSED');
    });

    it('should show error when serviceUrl not configured', async () => {
      getServiceUrl.mockReturnValue('');

      await cmdMetrics({});

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Service URL not configured'));
      expect(serviceRequest).not.toHaveBeenCalled();
    });

    it('should show error when repo not configured', async () => {
      // Must mock config module to return empty config without issueBaseUrl
      // (DEFAULT_CONFIG has a hardcoded issueBaseUrl fallback)
      jest.resetModules();
      jest.doMock('../../lib/config', () => ({
        loadConfig: () => ({}),
        DEFAULT_CONFIG: {},
        CONFIG_FILE: '/mock/home/.ai-issue/config.json',
      }));
      jest.doMock('../../lib/logger', () => mockCreateLogger());
      jest.doMock('../../lib/service-client', () => ({
        serviceRequest: jest.fn(),
        getServiceUrl: jest.fn(() => 'https://service.example.com'),
      }));

      delete process.env.AI_ISSUE_REPO;

      const { cmdMetrics: freshCmdMetrics } = require('../../lib/commands/metrics');
      const { error: freshError } = require('../../lib/logger');

      await freshCmdMetrics({});

      expect(freshError).toHaveBeenCalledWith(expect.stringContaining('Repository not configured'));
    });
  });

  describe('displayMetrics', () => {
    it('should use renderMetricsList for narrow terminals', () => {
      // Mock narrow terminal
      const origColumns = process.stdout.columns;
      Object.defineProperty(process.stdout, 'columns', { value: 60, writable: true });

      displayMetrics(SAMPLE_METRICS, {});

      expect(renderMetricsList).toHaveBeenCalledWith(SAMPLE_METRICS.by_engineer);
      expect(renderMetricsTable).not.toHaveBeenCalled();

      Object.defineProperty(process.stdout, 'columns', { value: origColumns, writable: true });
    });

    it('should use renderMetricsTable for wide terminals', () => {
      Object.defineProperty(process.stdout, 'columns', { value: 120, writable: true });

      displayMetrics(SAMPLE_METRICS, {});

      expect(renderMetricsTable).toHaveBeenCalledWith(SAMPLE_METRICS.by_engineer);
    });

    it('should display summary line with counts', () => {
      Object.defineProperty(process.stdout, 'columns', { value: 120, writable: true });

      displayMetrics(SAMPLE_METRICS, {});

      // Verify log was called with summary info
      const logCalls = log.mock.calls.map(c => c[0]);
      const summaryLine = logCalls.find(l => l && l.includes('42'));
      expect(summaryLine).toBeDefined();
    });
  });

  describe('formatPercent', () => {
    it('should format 0.714 as 71.4%', () => {
      expect(formatPercent(0.714)).toBe('71.4%');
    });

    it('should format 1.0 as 100.0%', () => {
      expect(formatPercent(1.0)).toBe('100.0%');
    });

    it('should format 0 as 0.0%', () => {
      expect(formatPercent(0)).toBe('0.0%');
    });

    it('should return N/A for null', () => {
      expect(formatPercent(null)).toBe('N/A');
    });
  });

  describe('formatHours', () => {
    it('should format 2.5 as 2.5h', () => {
      expect(formatHours(2.5)).toBe('2.5h');
    });

    it('should format 0 as 0.0h', () => {
      expect(formatHours(0)).toBe('0.0h');
    });

    it('should return - for null', () => {
      expect(formatHours(null)).toBe('-');
    });
  });

  describe('formatPeriod', () => {
    it('should format ISO dates to date-only range', () => {
      const result = formatPeriod({
        since: '2026-03-15T00:00:00+00:00',
        until: '2026-04-14T23:59:59+00:00',
      });
      expect(result).toBe('2026-03-15 ~ 2026-04-14');
    });
  });
});
