/**
 * Tests for commands/pipeline.js
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
  getServiceUrl: jest.fn(() => 'https://service.example.com'),
}));

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
  parseGitHubPrUrl,
} = require('../../lib/commands/pipeline');
const { serviceRequest, getServiceUrl } = require('../../lib/service-client');
const { log, success, warning } = require('../../lib/logger');

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
