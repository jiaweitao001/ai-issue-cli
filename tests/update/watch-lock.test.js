// @ts-check
'use strict';

const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const mockLoadConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_CONFIG: {},
  CONFIG_FILE: '/mock/home/.ai-issue/config.json',
  AI_ISSUE_DIR: '/mock/home/.ai-issue',
  ensureConfig: jest.fn(),
  saveConfig: jest.fn(),
  resetConfig: jest.fn(),
  VERSION: '0.0.0-test',
}));

const mockServiceRequest = jest.fn();
const mockGetServiceUrl = jest.fn(() => 'https://mock.svc');
jest.mock('../../lib/service-client', () => ({
  serviceRequest: mockServiceRequest,
  getServiceUrl: mockGetServiceUrl,
}));

const mockIsUpdateLockActive = jest.fn();
const mockWriteWatchActiveLock = jest.fn();
const mockUnlinkWatchActiveLock = jest.fn();
jest.mock('../../lib/update/lock', () => ({
  isUpdateLockActive: mockIsUpdateLockActive,
  writeWatchActiveLock: mockWriteWatchActiveLock,
  unlinkWatchActiveLock: mockUnlinkWatchActiveLock,
}));

const mockCmdSolve = jest.fn();
jest.mock('../../lib/commands/solve', () => ({ cmdSolve: mockCmdSolve }));

const watchModule = require('../../lib/commands/watch');

describe('lib/commands/watch — update.lock integration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadConfig.mockReturnValue({});
    mockServiceRequest.mockResolvedValue({ status: 200, data: [] });
    mockIsUpdateLockActive.mockReturnValue(false);
  });

  describe('watchIteration', () => {
    test('skips cycle entirely when isUpdateLockActive() is true', async () => {
      mockIsUpdateLockActive.mockReturnValue(true);
      const r = await watchModule.watchIteration({}, 'me', {});
      expect(r.skipped).toBe(true);
      expect(mockWriteWatchActiveLock).not.toHaveBeenCalled();
      expect(mockUnlinkWatchActiveLock).not.toHaveBeenCalled();
    });

    test('happy path: writes watch-active.lock, runs cycle, unlinks lock', async () => {
      const r = await watchModule.watchIteration({ repo: 'owner/repo' }, 'me', {});
      expect(r.skipped).toBe(false);
      expect(mockWriteWatchActiveLock).toHaveBeenCalledTimes(1);
      expect(mockUnlinkWatchActiveLock).toHaveBeenCalledTimes(1);

      const writeOrder = mockWriteWatchActiveLock.mock.invocationCallOrder[0];
      const unlinkOrder = mockUnlinkWatchActiveLock.mock.invocationCallOrder[0];
      expect(unlinkOrder).toBeGreaterThan(writeOrder);
    });

    test('writeWatchActiveLock receives a startedAt ISO timestamp', async () => {
      await watchModule.watchIteration({ repo: 'owner/repo' }, 'me', {});
      const meta = mockWriteWatchActiveLock.mock.calls[0][0];
      expect(meta).toBeDefined();
      expect(typeof meta.startedAt).toBe('string');
      expect(meta.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('unlinks even when watchCycle throws (finally block)', async () => {
      mockServiceRequest.mockRejectedValue(new Error('network down'));
      const r = await watchModule.watchIteration({ repo: 'owner/repo' }, 'me', {});
      expect(r.skipped).toBe(false);
      expect(r.error).toBeDefined();
      expect(r.error.message).toMatch(/network down/);
      expect(mockWriteWatchActiveLock).toHaveBeenCalledTimes(1);
      expect(mockUnlinkWatchActiveLock).toHaveBeenCalledTimes(1);
    });

    test('unlinkWatchActiveLock failure is swallowed (best-effort)', async () => {
      mockUnlinkWatchActiveLock.mockImplementation(() => { throw new Error('disk full'); });
      await expect(watchModule.watchIteration({ repo: 'owner/repo' }, 'me', {})).resolves.toBeDefined();
    });

    test('does NOT call unlinkWatchActiveLock when the cycle was skipped', async () => {
      mockIsUpdateLockActive.mockReturnValue(true);
      await watchModule.watchIteration({}, 'me', {});
      expect(mockUnlinkWatchActiveLock).not.toHaveBeenCalled();
    });
  });
});
