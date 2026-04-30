// @ts-check
'use strict';

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home'),
}));
jest.mock('child_process', () => ({
  execFileSync: jest.fn(),
  spawnSync: jest.fn(),
}));

const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

const worker = require('../../lib/update/worker');

function fakeFs() {
  const written = new Map();
  fs.readFileSync = jest.fn((p) => {
    if (written.has(String(p))) return written.get(String(p));
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  });
  fs.writeFileSync = jest.fn((p, contents) => { written.set(String(p), String(contents)); });
  fs.unlinkSync = jest.fn((p) => { written.delete(String(p)); });
  fs.mkdirSync = jest.fn();
  fs.existsSync = jest.fn((p) => written.has(String(p)));
  return { written };
}

describe('lib/update/worker', () => {
  let written;
  let exitSpy;
  let stdoutSpy;

  beforeEach(() => {
    jest.clearAllMocks();
    ({ written } = fakeFs());
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code) => {
      throw new Error(`process.exit(${code})`);
    }));
    stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  describe('parsePlanArg', () => {
    test('extracts plan path from --plan arg', () => {
      expect(worker.parsePlanArg(['--plan', '/tmp/plan.json'])).toBe('/tmp/plan.json');
    });
    test('throws when --plan is missing', () => {
      expect(() => worker.parsePlanArg([])).toThrow(/--plan/);
    });
    test('throws when --plan has no value', () => {
      expect(() => worker.parsePlanArg(['--plan'])).toThrow(/--plan/);
    });
  });

  describe('stripVPrefix', () => {
    test('strips leading v', () => {
      expect(worker.stripVPrefix('v1.2.3')).toBe('1.2.3');
    });
    test('handles bare semver', () => {
      expect(worker.stripVPrefix('1.2.3')).toBe('1.2.3');
    });
    test('preserves prerelease suffix', () => {
      expect(worker.stripVPrefix('v1.2.3-rc.1')).toBe('1.2.3-rc.1');
    });
    test('returns null for non-semver', () => {
      expect(worker.stripVPrefix('main@abc1234')).toBeNull();
      expect(worker.stripVPrefix(null)).toBeNull();
      expect(worker.stripVPrefix('')).toBeNull();
    });
  });

  describe('statePathFor', () => {
    test('produces hash-derived path under ~/.ai-issue/state/', () => {
      const p = worker.statePathFor('/usr/local/lib/node_modules/ai-issue-cli');
      expect(p).toMatch(/\/mock\/home\/\.ai-issue\/state\/install-[0-9a-f]{12}\.json$/);
    });
    test('is stable for same input', () => {
      const a = worker.statePathFor('/x');
      const b = worker.statePathFor('/x');
      expect(a).toBe(b);
    });
  });

  describe('runLinkUpdate', () => {
    const goodPlan = {
      mode: 'link',
      sourceClone: '/repo',
      targetBranch: 'main',
      toCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      skipSkills: false,
    };

    test('runs git fetch + git merge --ff-only + npm install + skills:install in order', () => {
      execFileSync.mockReturnValue('');
      worker.runLinkUpdate(goodPlan);
      const calls = execFileSync.mock.calls.map(c => c.slice(0, 2));
      expect(calls).toEqual([
        ['git', ['fetch', 'origin', 'main']],
        ['git', ['merge', '--ff-only', goodPlan.toCommit]],
        ['npm', ['install']],
        ['npm', ['run', 'skills:install']],
      ]);
      expect(execFileSync.mock.calls[0][2].cwd).toBe('/repo');
    });

    test('skips skills:install when skipSkills=true', () => {
      execFileSync.mockReturnValue('');
      worker.runLinkUpdate({ ...goodPlan, skipSkills: true });
      const bins = execFileSync.mock.calls.map(c => c[1].join(' '));
      expect(bins).not.toContain('run skills:install');
    });

    test('skills:install failure is non-fatal (warning only)', () => {
      execFileSync
        .mockReturnValueOnce('')   // git fetch
        .mockReturnValueOnce('')   // git merge
        .mockReturnValueOnce('')   // npm install
        .mockImplementationOnce(() => { throw Object.assign(new Error('skills failed'), { status: 5 }); });
      expect(() => worker.runLinkUpdate(goodPlan)).not.toThrow();
    });

    test('git fetch failure throws with exitCode propagated', () => {
      execFileSync.mockImplementationOnce(() => {
        throw Object.assign(new Error('boom'), { status: 128 });
      });
      try {
        worker.runLinkUpdate(goodPlan);
        throw new Error('expected throw');
      } catch (e) {
        expect(e.exitCode).toBe(128);
        expect(e.message).toMatch(/git fetch origin main/);
      }
    });

    test('throws when sourceClone missing', () => {
      expect(() => worker.runLinkUpdate({ ...goodPlan, sourceClone: null })).toThrow(/sourceClone/);
    });
    test('throws when targetBranch missing', () => {
      expect(() => worker.runLinkUpdate({ ...goodPlan, targetBranch: null })).toThrow(/targetBranch/);
    });
    test('throws when toCommit missing', () => {
      expect(() => worker.runLinkUpdate({ ...goodPlan, toCommit: null })).toThrow(/toCommit/);
    });
  });

  describe('runCopyUpdate', () => {
    test('throws "not implemented yet" with exit code 12 (P2 work)', () => {
      try {
        worker.runCopyUpdate({});
        throw new Error('expected throw');
      } catch (e) {
        expect(e.message).toMatch(/copy-mode/i);
        expect(e.exitCode).toBe(12);
      }
    });
  });

  describe('writeStateFile', () => {
    const plan = {
      globalPkg: '/usr/local/lib/node_modules/ai-issue-cli',
      mode: 'link',
      sourceClone: '/repo',
      effectiveChannel: 'branch',
      resolvedTargetRef: 'refs/heads/main',
      toCommit: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
      toLabel: 'main@bbbbbbb',
      fromVersion: '0.9.0',
    };

    test('writes JSON with mode + sourceClone + commit + ref + channel', () => {
      worker.writeStateFile(plan);
      const writes = fs.writeFileSync.mock.calls.filter(c => /install-[0-9a-f]{12}\.json$/.test(String(c[0])));
      expect(writes).toHaveLength(1);
      const data = JSON.parse(writes[0][1]);
      expect(data.mode).toBe('link');
      expect(data.sourceClone).toBe('/repo');
      expect(data.commit).toBe(plan.toCommit);
      expect(data.ref).toBe('refs/heads/main');
      expect(data.channel).toBe('branch');
      expect(data.installedBy).toBe('ai-issue-update-worker');
      expect(data.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    test('strips v-prefix from toLabel for tag updates', () => {
      const tagPlan = { ...plan, toLabel: 'v1.2.3', resolvedTargetRef: 'refs/tags/v1.2.3' };
      worker.writeStateFile(tagPlan);
      const writes = fs.writeFileSync.mock.calls.filter(c => /install-[0-9a-f]{12}\.json$/.test(String(c[0])));
      const data = JSON.parse(writes[0][1]);
      expect(data.version).toBe('1.2.3');
    });

    test('falls back to fromVersion when toLabel is non-semver (branch update)', () => {
      worker.writeStateFile(plan);
      const writes = fs.writeFileSync.mock.calls.filter(c => /install-[0-9a-f]{12}\.json$/.test(String(c[0])));
      const data = JSON.parse(writes[0][1]);
      expect(data.version).toBe('0.9.0');
    });

    test('no-op when globalPkg missing (defensive)', () => {
      worker.writeStateFile({ ...plan, globalPkg: null });
      const stateWrites = fs.writeFileSync.mock.calls.filter(c => /install-/.test(String(c[0])));
      expect(stateWrites).toHaveLength(0);
    });
  });

  describe('takeOverLock + releaseLock', () => {
    test('takeOverLock writes lock file with worker pid + role=worker', () => {
      worker.takeOverLock();
      const writes = fs.writeFileSync.mock.calls.filter(c => /update\.lock$/.test(String(c[0])));
      expect(writes).toHaveLength(1);
      const data = JSON.parse(writes[0][1]);
      expect(data.pid).toBe(process.pid);
      expect(data.role).toBe('worker');
    });

    test('takeOverLock swallows errors (best-effort)', () => {
      fs.writeFileSync.mockImplementationOnce(() => { throw new Error('disk full'); });
      expect(() => worker.takeOverLock()).not.toThrow();
    });

    test('releaseLock unlinks update.lock', () => {
      worker.releaseLock();
      const unlinks = fs.unlinkSync.mock.calls.filter(c => /update\.lock$/.test(String(c[0])));
      expect(unlinks).toHaveLength(1);
    });

    test('releaseLock is idempotent (swallows ENOENT)', () => {
      fs.unlinkSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
      expect(() => worker.releaseLock()).not.toThrow();
    });
  });

  describe('main', () => {
    function setupPlan(plan) {
      const planPath = '/tmp/plan.json';
      fs.readFileSync.mockImplementation((p) => {
        if (String(p) === planPath) return JSON.stringify(plan);
        throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      });
      return planPath;
    }

    test('happy path: link mode, exits 0, releases lock', () => {
      const planPath = setupPlan({
        mode: 'link',
        sourceClone: '/repo',
        globalPkg: '/g',
        targetBranch: 'main',
        toCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        toLabel: 'main@aaaaaaa',
        resolvedTargetRef: 'refs/heads/main',
        effectiveChannel: 'branch',
        fromLabel: 'main@bbbbbbb',
        fromVersion: '0.9.0',
        skipSkills: false,
      });
      execFileSync.mockReturnValue('');
      try { worker.main(['--plan', planPath]); } catch (e) {
        expect(e.message).toBe('process.exit(0)');
      }
      expect(exitSpy).toHaveBeenCalledWith(0);
      const unlinks = fs.unlinkSync.mock.calls.filter(c => /update\.lock$/.test(String(c[0])));
      expect(unlinks.length).toBeGreaterThan(0);
    });

    test('failure path: exits non-zero, still releases lock', () => {
      const planPath = setupPlan({
        mode: 'link',
        sourceClone: '/repo',
        globalPkg: '/g',
        targetBranch: 'main',
        toCommit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        toLabel: 'main@aaaaaaa',
        resolvedTargetRef: 'refs/heads/main',
        effectiveChannel: 'branch',
        fromLabel: 'main@bbbbbbb',
        fromVersion: '0.9.0',
        skipSkills: true,
      });
      execFileSync.mockImplementationOnce(() => { throw Object.assign(new Error('git boom'), { status: 128 }); });
      try { worker.main(['--plan', planPath]); } catch (e) { /* expected */ }
      expect(exitSpy).toHaveBeenCalledWith(128);
      const unlinks = fs.unlinkSync.mock.calls.filter(c => /update\.lock$/.test(String(c[0])));
      expect(unlinks.length).toBeGreaterThan(0);
    });

    test('unsupported mode -> exit 12, lock released', () => {
      const planPath = setupPlan({ mode: 'weird', globalPkg: '/g', fromLabel: 'x', toLabel: 'y' });
      try { worker.main(['--plan', planPath]); } catch (_e) { /* expected */ }
      expect(exitSpy).toHaveBeenCalledWith(12);
    });

    test('bootstrap failure (no --plan) exits 99', () => {
      try { worker.main([]); } catch (_e) { /* expected */ }
      expect(exitSpy).toHaveBeenCalledWith(99);
    });
  });
});
