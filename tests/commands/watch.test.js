/**
 * Tests for commands/watch.js
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
  getServiceApiKey: jest.fn(() => ''),
}));

// Mock solve command
jest.mock('../../lib/commands/solve', () => ({
  cmdSolve: jest.fn(),
}));

const { mockCreateAgentModule, mockCreateAgent, mockResetAgentMocks } = require('../helpers/mock-agent');
jest.mock('../../lib/agents', () => mockCreateAgentModule());

const fs = require('fs');
const { watchCycle, fetchQueuedIssues, cmdWatch } = require('../../lib/commands/watch');
const { serviceRequest, getServiceUrl } = require('../../lib/service-client');
const { cmdSolve } = require('../../lib/commands/solve');
const { log, error, info, success, warning } = require('../../lib/logger');

describe('commands/watch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetAgentMocks();
    mockCreateAgent.mockReturnValue({
      name: 'copilot',
      displayName: 'Copilot CLI',
      validateInstallationSync: jest.fn(() => ({ installed: true, version: '1.0.0', errors: [] }))
    });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      reportPath: '/test/reports',
      issueBaseUrl: 'https://github.com/test/repo/issues',
    }));
  });

  describe('fetchQueuedIssues', () => {
    it('should return queued issues for owner', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: [
          { issue: 100, title: 'Bug 1', status: 'queued' },
          { issue: 101, title: 'Bug 2', status: 'queued' },
        ],
      });

      const issues = await fetchQueuedIssues('test/repo', 'alice');
      expect(issues).toHaveLength(2);
      expect(serviceRequest).toHaveBeenCalledWith('GET', '/pipeline', null, {
        repo: 'test/repo',
        owner: 'alice',
        status: 'queued',
        limit: 10,
      });
    });

    it('should return empty array on empty response', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: [] });

      const issues = await fetchQueuedIssues('test/repo', 'alice');
      expect(issues).toEqual([]);
    });

    it('should throw on HTTP error', async () => {
      serviceRequest.mockResolvedValue({ status: 500, data: { detail: 'error' } });

      await expect(fetchQueuedIssues('test/repo', 'alice')).rejects.toThrow('Pipeline query failed');
    });

    it('should handle non-array response', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: 'unexpected' });

      const issues = await fetchQueuedIssues('test/repo', 'alice');
      expect(issues).toEqual([]);
    });
  });

  describe('watchCycle', () => {
    const config = {
      repoPath: '/test/repo',
      reportPath: '/test/reports',
      issueBaseUrl: 'https://github.com/test/repo/issues',
      repo: 'test/repo',
    };

    it('should solve all queued issues', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: [
          { issue: 100, title: 'Bug 1' },
          { issue: 101, title: 'Bug 2' },
        ],
      });
      cmdSolve.mockResolvedValue(undefined);

      const result = await watchCycle(config, 'alice', {});

      expect(result.processed).toBe(2);
      expect(result.solved).toBe(2);
      expect(result.failed).toBe(0);
      expect(cmdSolve).toHaveBeenCalledTimes(2);
    });

    it('should pass correct options to solve', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: [{ issue: 42, title: 'Test' }],
      });
      cmdSolve.mockResolvedValue(undefined);

      await watchCycle(config, 'alice', { pushFork: true });

      expect(cmdSolve).toHaveBeenCalledWith('42', expect.objectContaining({
        branch: true,
        force: true,
        silent: true,
        pushFork: true,
      }));
    });

    it('should count failures', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: [
          { issue: 100, title: 'Bug 1' },
          { issue: 101, title: 'Bug 2' },
        ],
      });
      cmdSolve.mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('LLM timeout'));

      const result = await watchCycle(config, 'alice', {});

      expect(result.solved).toBe(1);
      expect(result.failed).toBe(1);
    });

    it('should return zeros when no queued issues', async () => {
      serviceRequest.mockResolvedValue({ status: 200, data: [] });

      const result = await watchCycle(config, 'alice', {});

      expect(result.processed).toBe(0);
      expect(result.solved).toBe(0);
      expect(result.failed).toBe(0);
      expect(cmdSolve).not.toHaveBeenCalled();
    });

    it('should handle pipeline query error', async () => {
      serviceRequest.mockResolvedValue({ status: 500, data: {} });

      await expect(watchCycle(config, 'alice', {})).rejects.toThrow('Pipeline query failed');
    });
  });

  describe('cmdWatch', () => {
    it('should require --owner', async () => {
      await cmdWatch({});

      expect(error).toHaveBeenCalledWith(expect.stringContaining('--owner'));
    });

    it('should require service URL', async () => {
      getServiceUrl.mockReturnValue('');

      await cmdWatch({ owner: 'alice' });

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Service URL'));
    });

    it('should display startup info', async () => {
      getServiceUrl.mockReturnValue('https://service.example.com');
      // Make it exit after first check by having fetchQueuedIssues fail
      serviceRequest.mockRejectedValue(new Error('stop'));

      // Simulate SIGINT after a short delay to stop the loop
      const origOn = process.on.bind(process);
      let sigintHandler;
      jest.spyOn(process, 'on').mockImplementation((event, handler) => {
        if (event === 'SIGINT') sigintHandler = handler;
        return origOn(event, handler);
      });

      // Run cmdWatch with a very short interval and stop it quickly
      const watchPromise = cmdWatch({ owner: 'alice', interval: 0.001 });
      await new Promise(resolve => setTimeout(resolve, 50));
      if (sigintHandler) sigintHandler();
      await watchPromise;

      expect(info).toHaveBeenCalledWith(expect.stringContaining('alice'));
      process.on.mockRestore();
    });
  });
});
