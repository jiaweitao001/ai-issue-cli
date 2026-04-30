/**
 * Tests for lib/commands/update.js — full surface as of P1.
 *
 * Mocks all the lib/update/* modules so we can exercise cmdUpdate
 * orchestration without depending on real fs / git / network / spawn.
 *
 * Covers UPDATE_COMMAND_PROPOSAL.md §4.5 (cmdUpdate skeleton) and §3.4 (exit codes).
 */

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

const mockBuildUpdatePlan = jest.fn();
jest.mock('../../lib/update/plan', () => ({
  buildUpdatePlan: mockBuildUpdatePlan,
}));

const mockAcquireUpdateLock = jest.fn();
const mockReleaseUpdateLock = jest.fn();
jest.mock('../../lib/update/lock', () => ({
  acquireUpdateLock: mockAcquireUpdateLock,
  releaseUpdateLock: mockReleaseUpdateLock,
}));

const mockSpawnWorker = jest.fn();
const mockCleanupStaleCache = jest.fn();
jest.mock('../../lib/update/spawn-worker', () => ({
  spawnWorker: mockSpawnWorker,
  cleanupStaleCache: mockCleanupStaleCache,
}));

const mockLoadConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_CONFIG: {},
  CONFIG_FILE: '/mock/config.json',
}));

const { cmdUpdate } = require('../../lib/commands/update');
const { error, log } = require('../../lib/logger');

function basePlan(overrides = {}) {
  return {
    mode: 'link',
    sourceClone: '/repo',
    globalPkg: '/g',
    currentBranch: 'main',
    workingTreeDirty: false,
    upstreamUrl: 'https://github.com/x/y.git',
    configuredChannel: 'auto',
    effectiveChannel: 'branch',
    channelReason: 'auto-link',
    fromVersion: '0.9.0',
    fromCommit: 'aaaaaaa',
    fromLabel: 'main@aaaaaaa',
    toCommit: 'bbbbbbb',
    toLabel: 'main@bbbbbbb',
    resolvedTargetRef: 'refs/heads/main',
    targetBranch: 'main',
    needsUpdate: true,
    isDowngrade: false,
    refChangesHead: false,
    skipSkills: false,
    ...overrides,
  };
}

describe('commands/update', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
    mockEnsureStateOwnership.mockReturnValue(undefined);
    mockReadState.mockReturnValue(null);
    mockResolveEffectiveChannel.mockReturnValue('branch');
    mockLoadConfig.mockReturnValue({ updateChannel: 'auto' });
    mockSpawnWorker.mockReturnValue({ pid: 4242, workerPath: '/cache/w.js', planPath: '/cache/p.json' });
    mockCleanupStaleCache.mockReturnValue([]);
  });

  afterEach(() => {
    process.exit.mockRestore();
  });

  // ---------- --check path (P0) -----------------------------------------

  describe('--check path', () => {
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
    });

    it('exits 0 when --check finds no update needed', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(0);
      expect(mockPrintCheckReport).toHaveBeenCalled();
    });

    it('exits 10 when --check finds update available', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: true });
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(10);
    });

    it('exits 20 on NETWORK error', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      mockCheckCliVersion.mockRejectedValue(Object.assign(new Error('boom'), { code: 'NETWORK' }));
      await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
      expect(process.exit).toHaveBeenCalledWith(20);
    });

    it('exits 12 on NO_TAGS / NO_BRANCH / NO_URL errors', async () => {
      for (const code of ['NO_TAGS', 'NO_BRANCH', 'NO_URL']) {
        jest.clearAllMocks();
        mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
        mockCheckCliVersion.mockRejectedValue(Object.assign(new Error('x'), { code }));
        await expect(cmdUpdate({ check: true })).rejects.toThrow('process.exit called');
        expect(process.exit).toHaveBeenCalledWith(12);
      }
    });

    it('does NOT call buildUpdatePlan / acquireUpdateLock / spawnWorker on --check', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: true });
      await expect(cmdUpdate({ check: true })).rejects.toThrow();
      expect(mockBuildUpdatePlan).not.toHaveBeenCalled();
      expect(mockAcquireUpdateLock).not.toHaveBeenCalled();
      expect(mockSpawnWorker).not.toHaveBeenCalled();
    });
  });

  // ---------- channel resolution ----------------------------------------

  describe('channel resolution', () => {
    it('passes effectiveChannel from resolveEffectiveChannel to checkCliVersion', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      mockResolveEffectiveChannel.mockReturnValue('tag');
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true })).rejects.toThrow();
      expect(mockResolveEffectiveChannel).toHaveBeenCalledWith({ updateChannel: 'auto' }, 'copy');
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
      await expect(cmdUpdate({ check: true, ref: 'v0.9.1' })).rejects.toThrow();
      expect(mockResolveEffectiveChannel).not.toHaveBeenCalled();
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        expect.any(Object),
        'pinned',
        expect.objectContaining({ ref: 'v0.9.1' }),
        expect.any(Object)
      );
    });
  });

  // ---------- state identity check --------------------------------------

  describe('state identity check', () => {
    it('passes usable state to checkCliVersion', async () => {
      const realState = { commit: 'abc', mode: 'copy', sourceClone: null };
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      mockReadState.mockReturnValue(realState);
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true })).rejects.toThrow();
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ state: realState })
      );
    });

    it('discards stale state and passes null', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/c', globalPkg: '/g' });
      mockReadState.mockReturnValue({ __stale: true, reason: 'mode changed' });
      mockCheckCliVersion.mockResolvedValue({ needsUpdate: false });
      await expect(cmdUpdate({ check: true })).rejects.toThrow();
      expect(mockCheckCliVersion).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(String),
        expect.any(Object),
        expect.objectContaining({ state: null })
      );
    });
  });

  // ---------- P1 non-check path -----------------------------------------

  describe('non-check path (P1)', () => {
    it('exits 12 with P2 message when install mode is copy', async () => {
      mockDetect.mockReturnValue({ mode: 'copy', globalPkg: '/g' });
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('P2'));
      expect(mockBuildUpdatePlan).not.toHaveBeenCalled();
    });

    it('happy path: link mode, builds plan, acquires lock, spawns worker, exits 0', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan());
      mockAcquireUpdateLock.mockReturnValue({ acquired: true });

      await expect(cmdUpdate({})).rejects.toThrow();

      expect(mockBuildUpdatePlan).toHaveBeenCalled();
      expect(mockAcquireUpdateLock).toHaveBeenCalled();
      expect(mockSpawnWorker).toHaveBeenCalledWith(expect.objectContaining({ mode: 'link' }));
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('exits 2 with downgrade message when isDowngrade and no --confirm-downgrade', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({ isDowngrade: true, fromLabel: 'v1.5.0', toLabel: 'v1.0.0' }));
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(2);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('downgrade'));
      expect(mockAcquireUpdateLock).not.toHaveBeenCalled();
      expect(mockSpawnWorker).not.toHaveBeenCalled();
    });

    it('proceeds when isDowngrade is true and --confirm-downgrade is passed', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({ isDowngrade: true }));
      mockAcquireUpdateLock.mockReturnValue({ acquired: true });
      await expect(cmdUpdate({ confirmDowngrade: true })).rejects.toThrow();
      expect(mockSpawnWorker).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('exits 0 immediately (no spawn) when needsUpdate=false and no --force', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({ needsUpdate: false }));
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(0);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('Already up to date'));
      expect(mockAcquireUpdateLock).not.toHaveBeenCalled();
      expect(mockSpawnWorker).not.toHaveBeenCalled();
    });

    it('--force overrides the "already up to date" short-circuit', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({ needsUpdate: false }));
      mockAcquireUpdateLock.mockReturnValue({ acquired: true });
      await expect(cmdUpdate({ force: true })).rejects.toThrow();
      expect(mockSpawnWorker).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });

    it('exits 12 when working tree is dirty (link mode)', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({ workingTreeDirty: true }));
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('uncommitted'));
      expect(mockAcquireUpdateLock).not.toHaveBeenCalled();
    });

    it('exits 12 when on detached HEAD', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'HEAD' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({ currentBranch: 'HEAD' }));
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('detached HEAD'));
      expect(mockAcquireUpdateLock).not.toHaveBeenCalled();
    });

    it('exits 12 with full v3.4 refChangesHead message (3 fields shown)', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({
        refChangesHead: true,
        resolvedTargetRef: 'refs/tags/v1.0.0',
        toLabel: 'v1.0.0',
        channelReason: 'explicit',
      }));
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(12);
      // 3 fields per v3.4: source clone, current branch, channel reason
      const errorMessages = error.mock.calls.map(c => c[0]).join('\n');
      expect(errorMessages).toMatch(/Source clone/);
      expect(errorMessages).toMatch(/Current branch/);
      expect(errorMessages).toMatch(/Channel reason/);
      expect(errorMessages).toMatch(/refs\/tags\/v1\.0\.0/);
      expect(errorMessages).toMatch(/main/);
      expect(errorMessages).toMatch(/explicit/);
      expect(mockAcquireUpdateLock).not.toHaveBeenCalled();
    });

    it('refChangesHead message uses different guidance for explicit vs auto', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan({
        refChangesHead: true,
        resolvedTargetRef: 'refs/tags/v1.0.0',
        channelReason: 'auto-link',
      }));
      await expect(cmdUpdate({})).rejects.toThrow();
      const msgs = error.mock.calls.map(c => c[0]).join('\n');
      expect(msgs).toMatch(/track main HEAD instead of release tags/);
    });

    it('exits 12 when acquireUpdateLock throws WATCH_BUSY (and does not spawn)', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan());
      mockAcquireUpdateLock.mockImplementation(() => {
        throw Object.assign(new Error('watch is running pid 42'), { code: 'WATCH_BUSY' });
      });
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(error).toHaveBeenCalledWith(expect.stringContaining('watch is running'));
      expect(mockSpawnWorker).not.toHaveBeenCalled();
    });

    it('exits 12 when acquireUpdateLock throws UPDATE_BUSY', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan());
      mockAcquireUpdateLock.mockImplementation(() => {
        throw Object.assign(new Error('another update running'), { code: 'UPDATE_BUSY' });
      });
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(process.exit).toHaveBeenCalledWith(12);
      expect(mockSpawnWorker).not.toHaveBeenCalled();
    });

    it('releases the lock if spawnWorker throws', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan());
      mockAcquireUpdateLock.mockReturnValue({ acquired: true });
      mockSpawnWorker.mockImplementation(() => { throw new Error('exec format'); });
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(mockReleaseUpdateLock).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(12);
    });

    it('cleans up stale cache before staging the new worker', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan());
      mockAcquireUpdateLock.mockReturnValue({ acquired: true });
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(mockCleanupStaleCache).toHaveBeenCalled();
      // cleanupStaleCache should run BEFORE spawnWorker
      const cleanupOrder = mockCleanupStaleCache.mock.invocationCallOrder[0];
      const spawnOrder = mockSpawnWorker.mock.invocationCallOrder[0];
      expect(spawnOrder).toBeGreaterThan(cleanupOrder);
    });

    it('cleanupStaleCache failure does not block the spawn', async () => {
      mockDetect.mockReturnValue({ mode: 'link', sourceClone: '/repo', globalPkg: '/g', currentBranch: 'main' });
      mockBuildUpdatePlan.mockResolvedValue(basePlan());
      mockAcquireUpdateLock.mockReturnValue({ acquired: true });
      mockCleanupStaleCache.mockImplementation(() => { throw new Error('readdir failed'); });
      await expect(cmdUpdate({})).rejects.toThrow();
      expect(mockSpawnWorker).toHaveBeenCalled();
      expect(process.exit).toHaveBeenCalledWith(0);
    });
  });
});
