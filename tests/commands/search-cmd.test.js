/**
 * Tests for commands/search-cmd.js
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

const fs = require('fs');
const { cmdSearch, displaySearchResults } = require('../../lib/commands/search-cmd');
const { serviceRequest, getServiceUrl } = require('../../lib/service-client');
const { log, error, info } = require('../../lib/logger');

const SAMPLE_RESULTS = {
  results: [
    {
      issue: 30340,
      title: 'azurerm_key_vault_certificate: polling timeout during creation',
      status: 'solved',
      assigned_to: 'alice',
      solution_summary: 'Add custom poller with 30s interval in resource_key_vault_certificate.go',
      resource_name: 'azurerm_key_vault_certificate',
      recommendation: 'PROCEED',
      match_score: 0.92,
      match_highlight: 'polling <b>timeout</b> during creation',
      pr_url: 'https://github.com/test/repo/pull/30345',
      solved_at: '2026-03-20T10:30:00Z',
    },
    {
      issue: 31205,
      title: 'azurerm_cosmosdb_account: timeout waiting for update',
      status: 'solved',
      assigned_to: 'bob',
      solution_summary: 'Increase poller timeout to 60min for CosmosDB account update',
      resource_name: 'azurerm_cosmosdb_account',
      recommendation: 'PROCEED',
      match_score: 0.78,
      match_highlight: '<b>timeout</b> waiting for update',
      pr_url: '',
      solved_at: '2026-03-25T14:00:00Z',
    },
    {
      issue: 31890,
      title: 'azurerm_storage_account: creation polling fails',
      status: 'solving',
      assigned_to: 'carol',
      solution_summary: '',
      resource_name: 'azurerm_storage_account',
      recommendation: 'PROCEED',
      match_score: 0.71,
      match_highlight: '',
      pr_url: '',
      solved_at: '',
    },
  ],
  total: 3,
};

describe('commands/search-cmd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repo: 'test/repo',
    }));
    getServiceUrl.mockReturnValue('https://service.example.com');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('cmdSearch', () => {
    it('should fetch and display search results', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_RESULTS });

      await cmdSearch('timeout', {});

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/search/pipeline/test/repo', null, {
        q: 'timeout',
        owner: undefined,
        status: undefined,
        limit: 20,
      });

      const logCalls = log.mock.calls.map(c => c[0]);
      const output = logCalls.join('\n');
      expect(output).toContain('#30340');
      expect(output).toContain('timeout');
    });

    it('should pass --owner filter to API', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_RESULTS });

      await cmdSearch('timeout', { owner: 'alice' });

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/search/pipeline/test/repo', null,
        expect.objectContaining({ owner: 'alice' })
      );
    });

    it('should pass --status filter to API', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_RESULTS });

      await cmdSearch('timeout', { status: 'solved' });

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/search/pipeline/test/repo', null,
        expect.objectContaining({ status: 'solved' })
      );
    });

    it('should pass --limit to API', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: SAMPLE_RESULTS });

      await cmdSearch('timeout', { limit: 5 });

      expect(serviceRequest).toHaveBeenCalledWith('GET', '/search/pipeline/test/repo', null,
        expect.objectContaining({ limit: 5 })
      );
    });

    it('should show "no results" when empty', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: { results: [], total: 0 } });

      await cmdSearch('nonexistent', {});

      expect(info).toHaveBeenCalledWith(expect.stringContaining('No results found'));
    });

    it('should handle HTTP error', async () => {
      serviceRequest.mockResolvedValue({ status: 500, data: { detail: 'Internal error' } });

      await cmdSearch('timeout', {});

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Search failed (HTTP 500)'));
    });

    it('should handle 403 permission denied', async () => {
      serviceRequest.mockResolvedValue({ status: 403, data: { detail: 'Forbidden' } });

      await cmdSearch('timeout', {});

      expect(error).toHaveBeenCalledWith('Permission denied. Only managers can search pipeline.');
    });

    it('should handle network error', async () => {
      serviceRequest.mockRejectedValue(new Error('ECONNREFUSED'));

      await cmdSearch('timeout', {});

      expect(error).toHaveBeenCalledWith('Search failed: ECONNREFUSED');
    });

    it('should show error when serviceUrl not configured', async () => {
      getServiceUrl.mockReturnValue('');

      await cmdSearch('timeout', {});

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Service URL not configured'));
      expect(serviceRequest).not.toHaveBeenCalled();
    });

    it('should show error when repo not configured', async () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({}));
      delete process.env.AI_ISSUE_REPO;

      await cmdSearch('timeout', {});

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Repository not configured'));
    });
  });

  describe('displaySearchResults', () => {
    it('should display match count in header', () => {
      displaySearchResults('timeout', SAMPLE_RESULTS);

      const logCalls = log.mock.calls.map(c => c[0]);
      const header = logCalls.find(l => l && l.includes('3 matches'));
      expect(header).toBeDefined();
    });

    it('should show PR url when present', () => {
      displaySearchResults('timeout', SAMPLE_RESULTS);

      const logCalls = log.mock.calls.map(c => c[0]);
      const output = logCalls.join('\n');
      expect(output).toContain('pull/30345');
    });

    it('should not show PR line when pr_url is empty', () => {
      displaySearchResults('timeout', {
        results: [{ ...SAMPLE_RESULTS.results[1], pr_url: '' }],
        total: 1,
      });

      const logCalls = log.mock.calls.map(c => c[0]);
      const prLines = logCalls.filter(l => l && l.includes('PR:'));
      expect(prLines).toHaveLength(0);
    });

    it('should show "(in progress)" for empty solution_summary', () => {
      displaySearchResults('timeout', {
        results: [SAMPLE_RESULTS.results[2]],
        total: 1,
      });

      const logCalls = log.mock.calls.map(c => c[0]);
      const output = logCalls.join('\n');
      expect(output).toContain('in progress');
    });

    it('should use singular "match" for 1 result', () => {
      displaySearchResults('timeout', {
        results: [SAMPLE_RESULTS.results[0]],
        total: 1,
      });

      const logCalls = log.mock.calls.map(c => c[0]);
      const header = logCalls.find(l => l && l.includes('1 match'));
      expect(header).toBeDefined();
      // Should not say "1 matches"
      const wrongHeader = logCalls.find(l => l && l.includes('1 matches'));
      expect(wrongHeader).toBeUndefined();
    });
  });
});
