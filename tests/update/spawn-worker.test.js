// @ts-check
'use strict';

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home'),
}));

const mockSpawn = jest.fn();
jest.mock('child_process', () => ({
  spawn: mockSpawn,
}));

const fs = require('fs');
const path = require('path');
const { spawnWorker, cleanupStaleCache, CACHE_DIR_DEFAULT } = require('../../lib/update/spawn-worker');

describe('lib/update/spawn-worker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.readFileSync = jest.fn();
    fs.writeFileSync = jest.fn();
    fs.mkdirSync = jest.fn();
    fs.readdirSync = jest.fn();
    fs.statSync = jest.fn();
    fs.unlinkSync = jest.fn();
  });

  describe('CACHE_DIR_DEFAULT', () => {
    test('lives under ~/.ai-issue/cache', () => {
      expect(CACHE_DIR_DEFAULT).toBe(path.join('/mock/home', '.ai-issue', 'cache'));
    });
  });

  describe('spawnWorker', () => {
    function makeChild() {
      return { pid: 4242, unref: jest.fn() };
    }

    test('reads worker source, content-hashes it, writes staged copy + plan, spawns detached', () => {
      const workerSrc = '// pretend worker.js\n';
      fs.readFileSync.mockReturnValue(workerSrc);
      const child = makeChild();
      mockSpawn.mockReturnValue(child);

      const plan = { mode: 'link', sourceClone: '/repo', targetBranch: 'main' };
      const result = spawnWorker(plan, { workerSrcPath: '/lib/update/worker.js', execPath: '/usr/bin/node' });

      expect(fs.readFileSync).toHaveBeenCalledWith('/lib/update/worker.js', 'utf8');
      expect(fs.mkdirSync).toHaveBeenCalledWith(CACHE_DIR_DEFAULT, { recursive: true });

      const writeCalls = fs.writeFileSync.mock.calls;
      expect(writeCalls.length).toBe(2);

      // Staged worker
      const workerWrite = writeCalls.find(c => /update-worker-[0-9a-f]{12}\.js$/.test(String(c[0])));
      expect(workerWrite).toBeDefined();
      expect(workerWrite[1]).toBe(workerSrc);

      // Plan JSON
      const planWrite = writeCalls.find(c => /update-worker-[0-9a-f]{12}\.json$/.test(String(c[0])));
      expect(planWrite).toBeDefined();
      expect(JSON.parse(planWrite[1])).toEqual(plan);

      // Spawn was detached + stdio inherit + plan arg
      expect(mockSpawn).toHaveBeenCalledTimes(1);
      const [spawnedExec, spawnedArgs, spawnedOpts] = mockSpawn.mock.calls[0];
      expect(spawnedExec).toBe('/usr/bin/node');
      expect(spawnedArgs[0]).toBe(result.workerPath);
      expect(spawnedArgs[1]).toBe('--plan');
      expect(spawnedArgs[2]).toBe(result.planPath);
      expect(spawnedOpts.detached).toBe(true);
      expect(spawnedOpts.stdio).toBe('inherit');
      expect(spawnedOpts.env.AI_ISSUE_SELF_UPDATE).toBe('1');

      expect(child.unref).toHaveBeenCalled();
      expect(result.pid).toBe(4242);
    });

    test('content-hashes worker source so identical sources reuse the same staged path', () => {
      fs.readFileSync.mockReturnValue('worker A');
      mockSpawn.mockReturnValue(makeChild());
      const r1 = spawnWorker({ mode: 'link' }, { execPath: '/n' });
      jest.clearAllMocks();
      fs.readFileSync = jest.fn().mockReturnValue('worker A');
      fs.writeFileSync = jest.fn();
      fs.mkdirSync = jest.fn();
      mockSpawn.mockReturnValue(makeChild());
      const r2 = spawnWorker({ mode: 'link' }, { execPath: '/n' });
      expect(r1.workerPath).toBe(r2.workerPath);
    });

    test('different worker source -> different staged path', () => {
      fs.readFileSync.mockReturnValueOnce('worker A');
      mockSpawn.mockReturnValue(makeChild());
      const r1 = spawnWorker({}, { execPath: '/n' });
      jest.clearAllMocks();
      fs.readFileSync = jest.fn().mockReturnValueOnce('worker B (different)');
      fs.writeFileSync = jest.fn();
      fs.mkdirSync = jest.fn();
      mockSpawn.mockReturnValue(makeChild());
      const r2 = spawnWorker({}, { execPath: '/n' });
      expect(r1.workerPath).not.toBe(r2.workerPath);
    });
  });

  describe('cleanupStaleCache', () => {
    test('returns [] when cache dir does not exist', () => {
      fs.readdirSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
      expect(cleanupStaleCache()).toEqual([]);
    });

    test('removes only matching files older than maxAgeMs', () => {
      fs.readdirSync.mockReturnValue([
        'update-worker-aaaaaaaaaaaa.js',     // old
        'update-worker-aaaaaaaaaaaa.json',   // old
        'update-worker-bbbbbbbbbbbb.js',     // fresh
        'unrelated.txt',                      // ignored
      ]);
      const now = 1_000_000_000_000;
      fs.statSync.mockImplementation((p) => {
        if (String(p).includes('aaaaaaaaaaaa')) return { mtimeMs: now - (40 * 24 * 60 * 60 * 1000) };
        return { mtimeMs: now - 1000 };
      });
      const removed = cleanupStaleCache({ now: () => now });
      expect(removed.length).toBe(2);
      expect(removed.every(p => /aaaaaaaaaaaa/.test(p))).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalledTimes(2);
    });

    test('swallows unlink failures', () => {
      fs.readdirSync.mockReturnValue(['update-worker-aaaaaaaaaaaa.js']);
      fs.statSync.mockReturnValue({ mtimeMs: 0 });
      fs.unlinkSync.mockImplementation(() => { throw new Error('EBUSY'); });
      expect(() => cleanupStaleCache({ now: () => Date.now() })).not.toThrow();
    });

    test('respects custom maxAgeMs', () => {
      fs.readdirSync.mockReturnValue(['update-worker-aaaaaaaaaaaa.js']);
      fs.statSync.mockReturnValue({ mtimeMs: Date.now() - 2000 });
      const removed = cleanupStaleCache({ maxAgeMs: 1000 });
      expect(removed.length).toBe(1);
    });
  });
});
