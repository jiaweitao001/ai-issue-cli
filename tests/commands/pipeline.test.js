/**
 * Tests for commands/pipeline.js
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

// Mock config to avoid env-var pollution. cmdPipeline + cmdMarkPrCreated
// both call loadConfig() at runtime; mocking it directly is the pattern
// recommended in CLAUDE.md.
const mockLoadConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_CONFIG: {},
  CONFIG_FILE: '/mock/home/.ai-issue/config.json',
  saveConfig: jest.fn(),
  isConfigured: jest.fn(),
  validateConfig: jest.fn(),
  VERSION: '0.0.0-test',
}));

const {
  cmdMarkPrCreated,
  cmdPipeline,
  parseGitHubPrUrl,
  formatEntry,
  normalizePipelineEntries,
  sortPipelineEntriesByIssue,
} = require('../../lib/commands/pipeline');
const { serviceRequest, getServiceUrl } = require('../../lib/service-client');
const { log, error, info, success, warning } = require('../../lib/logger');

const PR_URL = 'https://github.com/hashicorp/terraform-provider-azurerm/pull/123';

beforeEach(() => {
  jest.clearAllMocks();
  getServiceUrl.mockReturnValue('https://service.example.com');
  mockLoadConfig.mockReturnValue({
    repo: 'hashicorp/terraform-provider-azurerm',
    serviceUrl: 'https://service.example.com',
  });
  serviceRequest.mockResolvedValue({
    status: 200,
    data: {
      ok: true,
      status: 'pr_created',
      pr_url: PR_URL,
      pr_number: 123,
    },
  });
});

describe('parseGitHubPrUrl', () => {
  it('parses PR number from GitHub PR URL', () => {
    expect(parseGitHubPrUrl(PR_URL)).toEqual({
      owner: 'hashicorp',
      repo: 'terraform-provider-azurerm',
      prNumber: 123,
    });
  });

  it('rejects non-PR GitHub URLs', () => {
    expect(() => parseGitHubPrUrl('https://github.com/hashicorp/terraform-provider-azurerm/issues/123'))
      .toThrow('pull');
  });

  it('rejects non-GitHub URLs', () => {
    expect(() => parseGitHubPrUrl('https://example.com/hashicorp/repo/pull/123'))
      .toThrow('github.com');
  });
});

describe('cmdMarkPrCreated', () => {
  it('sends expected endpoint and payload', async () => {
    await cmdMarkPrCreated('456', { repo: 'hashicorp/terraform-provider-azurerm', prUrl: PR_URL });

    expect(serviceRequest).toHaveBeenCalledWith(
      'POST',
      '/pipeline/hashicorp/terraform-provider-azurerm/456/pr-created',
      { pr_url: PR_URL, pr_number: 123 },
    );
  });

  it('uses configured repo when --repo is omitted', async () => {
    mockLoadConfig.mockReturnValue({ repo: 'configured/repo' });

    await cmdMarkPrCreated('456', { prUrl: PR_URL });

    expect(serviceRequest).toHaveBeenCalledWith(
      'POST',
      '/pipeline/configured/repo/456/pr-created',
      expect.any(Object),
    );
  });

  it('derives default repo from issueBaseUrl when repo is omitted', async () => {
    mockLoadConfig.mockReturnValue({
      issueBaseUrl: 'https://github.com/derived/repo/issues',
    });

    await cmdMarkPrCreated('456', { prUrl: PR_URL });

    expect(serviceRequest).toHaveBeenCalledWith(
      'POST',
      '/pipeline/derived/repo/456/pr-created',
      expect.any(Object),
    );
  });

  it('accepts explicit --repo over configured repo', async () => {
    mockLoadConfig.mockReturnValue({ repo: 'configured/repo' });

    await cmdMarkPrCreated('456', { repo: 'explicit/repo', prUrl: PR_URL });

    expect(serviceRequest).toHaveBeenCalledWith(
      'POST',
      '/pipeline/explicit/repo/456/pr-created',
      expect.any(Object),
    );
  });

  it('parses PR number from URL when --pr-number is omitted', async () => {
    await cmdMarkPrCreated('456', { prUrl: PR_URL });

    expect(serviceRequest.mock.calls[0][2]).toEqual({
      pr_url: PR_URL,
      pr_number: 123,
    });
  });

  it('uses explicit --pr-number when it matches the URL', async () => {
    await cmdMarkPrCreated('456', { prUrl: PR_URL, prNumber: '123' });

    expect(serviceRequest.mock.calls[0][2].pr_number).toBe(123);
  });

  it('rejects missing --pr-url without calling service', async () => {
    await expect(cmdMarkPrCreated('456', {})).rejects.toThrow('--pr-url is required');

    expect(serviceRequest).not.toHaveBeenCalled();
  });

  it('rejects invalid/non-PR URL without calling service', async () => {
    await expect(cmdMarkPrCreated('456', {
      prUrl: 'https://github.com/hashicorp/terraform-provider-azurerm/issues/123',
    })).rejects.toThrow('pull');

    expect(serviceRequest).not.toHaveBeenCalled();
  });

  it('rejects URL/number mismatch without calling service', async () => {
    await expect(cmdMarkPrCreated('456', { prUrl: PR_URL, prNumber: '999' }))
      .rejects.toThrow('does not match');

    expect(serviceRequest).not.toHaveBeenCalled();
  });

  it('prints success with PR URL and status', async () => {
    await cmdMarkPrCreated('456', { prUrl: PR_URL });

    expect(success).toHaveBeenCalledWith(expect.stringContaining('Issue #456'));
    const output = log.mock.calls.map(call => call[0]).join('\n');
    expect(output).toContain(PR_URL);
    expect(output).toContain('pr_created');
  });

  it('handles service API error with clear message', async () => {
    serviceRequest.mockResolvedValue({ status: 404, data: { detail: 'Pipeline entry not found' } });

    await expect(cmdMarkPrCreated('456', { prUrl: PR_URL }))
      .rejects.toThrow('Mark PR-created failed (HTTP 404): Pipeline entry not found');
  });

  it('prints warning when service says Trello sync failed', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: {
        ok: true,
        status: 'pr_created',
        pr_url: PR_URL,
        pr_number: 123,
        trello_warning: true,
      },
    });

    await cmdMarkPrCreated('456', { prUrl: PR_URL });

    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Trello sync warning'));
  });

  it('rejects when service URL is not configured', async () => {
    getServiceUrl.mockReturnValue('');

    await expect(cmdMarkPrCreated('456', { prUrl: PR_URL }))
      .rejects.toThrow('Service URL not configured');
    expect(serviceRequest).not.toHaveBeenCalled();
  });
});

describe('normalizePipelineEntries', () => {
  it('returns the input unchanged when given an array', () => {
    const arr = [{ issue: 1 }, { issue: 2 }];
    expect(normalizePipelineEntries(arr)).toBe(arr);
  });

  it('returns an empty array for non-array values', () => {
    expect(normalizePipelineEntries(null)).toEqual([]);
    expect(normalizePipelineEntries(undefined)).toEqual([]);
    expect(normalizePipelineEntries('oops')).toEqual([]);
    expect(normalizePipelineEntries({ unexpected: true })).toEqual([]);
    expect(normalizePipelineEntries(42)).toEqual([]);
  });
});

describe('formatEntry', () => {
  it('renders the issue number, status, title, owner and resource', () => {
    const row = formatEntry({
      issue: 12345,
      status: 'triaged',
      recommendation: 'PROCEED',
      title: 'Some bug title',
      assigned_to: 'alice',
      resource_name: 'azurerm_storage_account',
    });

    expect(row).toContain('#12345');
    expect(row).toContain('triaged');
    expect(row).toContain('Some bug title');
    expect(row).toContain('alice');
    expect(row).toContain('azurerm_storage_account');
  });

  it('falls back to "-" for missing owner and resource', () => {
    const row = formatEntry({
      issue: 7,
      status: 'queued',
      title: '',
    });

    expect(row).toContain('#7');
    expect(row).toContain('-');
  });
});

describe('cmdPipeline', () => {
  beforeEach(() => {
    serviceRequest.mockResolvedValue({ status: 200, data: [] });
  });

  it('queries /pipeline with default parameters', async () => {
    await cmdPipeline({});

    expect(serviceRequest).toHaveBeenCalledWith(
      'GET',
      '/pipeline',
      null,
      expect.objectContaining({
        owner: undefined,
        status: undefined,
        limit: 20,
      })
    );
  });

  it('forwards --owner, --status and --limit to the service', async () => {
    await cmdPipeline({ owner: 'alice', status: 'queued', limit: 50 });

    expect(serviceRequest).toHaveBeenCalledWith(
      'GET',
      '/pipeline',
      null,
      expect.objectContaining({
        owner: 'alice',
        status: 'queued',
        limit: 50,
      })
    );
  });

  it('reports an error and stops rendering when HTTP status is not 200', async () => {
    serviceRequest.mockResolvedValue({
      status: 500,
      data: { detail: 'boom' },
    });

    await cmdPipeline({});

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Pipeline query failed (HTTP 500)')
    );

    const issueLines = log.mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === 'string' && /#\d+/.test(s));
    expect(issueLines).toHaveLength(0);
  });

  it('reports an error when the service request rejects', async () => {
    serviceRequest.mockRejectedValue(new Error('ECONNREFUSED'));

    await cmdPipeline({});

    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('Pipeline query failed')
    );
  });

  it('treats non-array payloads as empty results', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: { unexpected: true },
    });

    await cmdPipeline({});

    expect(info).toHaveBeenCalledWith(
      expect.stringContaining('No pipeline entries found.')
    );
  });

  it('renders one row per pipeline entry', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: [
        { issue: 123, status: 'triaged', title: 'first' },
        { issue: 456, status: 'queued', title: 'second' },
      ],
    });

    await cmdPipeline({});

    const allLogs = log.mock.calls.map((c) => c[0]).join('\n');
    expect(allLogs).toContain('#123');
    expect(allLogs).toContain('#456');
  });

  it('summarizes counts independent of the input ordering', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: [
        { issue: 9, status: 'queued' },
        { issue: 10, status: 'solved' },
        { issue: 11, status: 'queued' },
      ],
    });

    await cmdPipeline({});

    const allLogs = log.mock.calls.map((c) => c[0]).join('\n');
    expect(allLogs).toContain('queued: 2');
    expect(allLogs).toContain('solved: 1');
    expect(allLogs).toContain('total: 3');
  });

  it('renders entries in ascending issue-number order regardless of service order', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: [
        { issue: 32263, status: 'triaged', title: 'newer' },
        { issue: 32244, status: 'triaged', title: 'older' },
        { issue: 32258, status: 'triaged', title: 'middle' },
      ],
    });

    await cmdPipeline({});

    const issueLines = log.mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === 'string' && /#\d+/.test(s));
    const issueNumbers = issueLines
      .map((line) => line.match(/#(\d+)/))
      .filter(Boolean)
      .map((m) => Number(m[1]));

    expect(issueNumbers).toEqual([32244, 32258, 32263]);
  });

  it('sorts numerically rather than lexicographically', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: [
        { issue: 100, status: 'triaged' },
        { issue: 9, status: 'triaged' },
        { issue: 20, status: 'triaged' },
      ],
    });

    await cmdPipeline({});

    const issueNumbers = log.mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === 'string')
      .map((line) => line.match(/#(\d+)/))
      .filter(Boolean)
      .map((m) => Number(m[1]));

    expect(issueNumbers).toEqual([9, 20, 100]);
  });

  it('keeps forwarding filters and limit unchanged when sorting is applied', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: [
        { issue: 30, status: 'queued' },
        { issue: 10, status: 'queued' },
        { issue: 20, status: 'queued' },
      ],
    });

    await cmdPipeline({ owner: 'alice', status: 'queued', limit: 2000 });

    expect(serviceRequest).toHaveBeenCalledWith(
      'GET',
      '/pipeline',
      null,
      expect.objectContaining({
        owner: 'alice',
        status: 'queued',
        limit: 2000,
      })
    );

    const issueNumbers = log.mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === 'string')
      .map((line) => line.match(/#(\d+)/))
      .filter(Boolean)
      .map((m) => Number(m[1]));

    expect(issueNumbers).toEqual([10, 20, 30]);
  });

  it('does not affect summary counts after sorting', async () => {
    serviceRequest.mockResolvedValue({
      status: 200,
      data: [
        { issue: 3, status: 'solved' },
        { issue: 1, status: 'queued' },
        { issue: 2, status: 'queued' },
      ],
    });

    await cmdPipeline({});

    const allLogs = log.mock.calls.map((c) => c[0]).join('\n');
    const issueNumbers = log.mock.calls
      .map((c) => c[0])
      .filter((s) => typeof s === 'string')
      .map((line) => line.match(/#(\d+)/))
      .filter(Boolean)
      .map((m) => Number(m[1]));

    expect(issueNumbers).toEqual([1, 2, 3]);
    expect(allLogs).toContain('queued: 2');
    expect(allLogs).toContain('solved: 1');
    expect(allLogs).toContain('total: 3');
  });
});

describe('sortPipelineEntriesByIssue', () => {
  it('sorts by numeric issue number ascending', () => {
    const sorted = sortPipelineEntriesByIssue([
      { issue: 32263 },
      { issue: 32244 },
      { issue: 32258 },
    ]);

    expect(sorted.map((e) => e.issue)).toEqual([32244, 32258, 32263]);
  });

  it('does not mutate the input array', () => {
    const input = [{ issue: 3 }, { issue: 1 }, { issue: 2 }];
    const original = [...input];

    const sorted = sortPipelineEntriesByIssue(input);

    expect(input).toEqual(original);
    expect(sorted).not.toBe(input);
  });

  it('coerces string issue numbers and treats numeric strings as numbers', () => {
    const sorted = sortPipelineEntriesByIssue([
      { issue: '100' },
      { issue: '9' },
      { issue: '20' },
    ]);

    expect(sorted.map((e) => e.issue)).toEqual(['9', '20', '100']);
  });

  it('places entries with missing or non-numeric issue numbers at the end, preserving their order', () => {
    const sorted = sortPipelineEntriesByIssue([
      { issue: 'abc', tag: 'a' },
      { issue: 10, tag: 'b' },
      { issue: null, tag: 'c' },
      { issue: 2, tag: 'd' },
    ]);

    expect(sorted.map((e) => e.tag)).toEqual(['d', 'b', 'a', 'c']);
  });

  it('keeps original relative order when issue numbers are equal', () => {
    const sorted = sortPipelineEntriesByIssue([
      { issue: 5, tag: 'first' },
      { issue: 5, tag: 'second' },
      { issue: 5, tag: 'third' },
    ]);

    expect(sorted.map((e) => e.tag)).toEqual(['first', 'second', 'third']);
  });

  it('returns an empty array for non-array input', () => {
    expect(sortPipelineEntriesByIssue(null)).toEqual([]);
    expect(sortPipelineEntriesByIssue(undefined)).toEqual([]);
    expect(sortPipelineEntriesByIssue('oops')).toEqual([]);
  });
});
