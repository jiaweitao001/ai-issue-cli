/**
 * Tests for lib/commands/update.js (--check path, P0 scope only).
 *
 * Mocks all the lib/update/* modules so we can exercise the cmdUpdate
 * orchestration without depending on real fs / git / network.
 *
 * Covers UPDATE_COMMAND_PROPOSAL.md §4.5 (cmdUpdate skeleton) and
 * §3.4 (exit codes) for the read-only --check path.
 */

// Mock dependencies BEFORE requiring cmdUpdate.
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const mockEnsureStateOwnership = jest.fn();
const mockReadState = jest.fn();
jest.mock('../../lib/update/state', () => ({
  ensureStateOwnership: mockEnsureStateOwnership,
  readState: mockReadState,
}));

const mockDetect = jest.fn();
jest.mock('../../lib/update/detect', () => ({
  detectCliInstall: mockDetect,
}));

const mockCheckCliVersion = jest.fn();
const mockPrintCheckReport = jest.fn();
const mockResolveEffectiveChannel = jest.fn();
jest.mock('../../lib/update/version-check', () => ({
  checkCliVersion: mockCheckCliVersion,
  printCheckReport: mockPrintCheckReport,
  resolveEffectiveChannel: mockResolveEffectiveChannel,
}));

const mockLoadConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_CONFIG: {},
  CONFIG_FILE: '/mock/config.json',
}));

const { cmdUpdate } = require('../../lib/commands/update');
const { error } = require('../../lib/logger');

describe('commands/update --check (P0)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockEnsureStateOwnership.mockReturnValue(undefined);
    mockReadState.mockReturnValue(null);
    mockResolveEffectiveChannel.mockReturnValue('branch');
    mockLoadConfig.mockReturnValue({ updateChannel: 'auto' });
  });

  afterEach(() => {
    process.exit.mockRestore();
  });

  describe('exit codes', () => {
    it('exits 12 when ensureStateOwnership throws', async () => {
      mockEnsureStateOwnership.mockImplementation(() => {
        const e = new Error('owned by root');
        e.code = 'OWNERSHIP';
        throw e;
      });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('owned by root'));
    });

    it('exits 12 when install mode is unknown', async () => {
      mockDetect.mockReturnValue({ mode: 'unknown', reason: 'npm root -g failed' });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Could not detect'));
      expect(error).toHaveBeenCalledWith(expect.stringContaining('npm root -g failed'));
    });

    it('exits 0 when --check finds no update needed', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockCheckCliVersion.mockResolvedValue({
        needsUpdate: false,
        effectiveChannel: 'branch',
        configuredChannel: 'auto',
        channelReason: 'auto-link',
      });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(0);
      expect(mockPrintCheckReport).toHaveBeenCalled();
    });

    it('exits 10 when --check finds update available', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockCheckCliVersion.mockResolvedValue({
        needsUpdate: true,
        effectiveChannel: 'branch',
        configuredChannel: 'auto',
        channelReason: 'auto-link',
      });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(10);
      expect(mockPrintCheckReport).toHaveBeenCalled();
    });

    it('exits 20 on NETWORK error', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      const e = new Error('ls-remote failed');
      e.code = 'NETWORK';
      mockCheckCliVersion.mockRejectedValue(e);
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(20);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Network error'));
    });

    it('exits 12 on NO_TAGS error', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      const e = new Error('no tags found');
      e.code = 'NO_TAGS';
      mockCheckCliVersion.mockRejectedValue(e);
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('no tags found'));
    });

    it('exits 12 on NO_BRANCH error', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      const e = new Error('branch missing');
      e.code = 'NO_BRANCH';
      mockCheckCliVersion.mockRejectedValue(e);
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(12);
    });

    it('exits 12 on NO_URL error', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      const e = new Error('no upstream');
      e.code = 'NO_URL';
      mockCheckCliVersion.mockRejectedValue(e);
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(12);
    });

    it('exits 12 on unknown error code (defensive)', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      mockCheckCliVersion.mockRejectedValue(new Error('weird thing'));
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('weird thing'));
    });

    it('exits 12 when called WITHOUT --check (P0 scope: not implemented)', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      await expect(cmdUpdate({})).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('not yet implemented'));
    });
  });

  describe('channel resolution', () => {
    it('passes effectiveChannel from resolveEffectiveChannel to checkCliVersion', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      mockResolveEffectiveChannel.mockReturnValue('tag');
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(mockResolveEffectiveChannel).toHaveBeenCalledWith(
        { updateChannel: 'auto' },
        'copy'
      );
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'copy' }),
        'tag',
        expect.any(Object),
        expect.any(Object)
      );
    });

    it('uses pinned channel when --ref is provided (skips resolveEffectiveChannel)', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true, ref: 'v0.9.1' })).rejects.toThrow('process.exit called');
      expect(mockResolveEffectiveChannel).not.toHaveBeenCalled();
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        expect.any(Object),
        'pinned',
        expect.objectContaining({ ref: 'v0.9.1' }),
        expect.any(Object)
      );
    });
  });

  describe('state identity check', () => {
    it('passes usable state to checkCliVersion', async () => {
      const realState = { commit: 'abc', mode: 'copy', sourceClone: null };
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      mockReadState.mockReturnValue(realState);
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ state: realState })
      );
    });

    it('discards stale state (mode mismatch) and passes null', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockReadState.mockReturnValue({
        __stale: true,
        reason: 'install mode changed (state: copy, detected: link)',
      });
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ state: null })
      );
    });
  });
});
