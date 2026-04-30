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
    const goodPlan = {
      mode: 'copy',
      globalPkg: '/usr/local/lib/node_modules/ai-issue-cli',
      upstreamUrl: 'https://github.com/x/y.git',
      resolvedTargetRef: 'refs/tags/v1.0.0',
      toCommit: 'cccccccccccccccccccccccccccccccccccccccc',
      toLabel: 'v1.0.0',
      skipSkills: false,
    };

    test('first-time: clones, fetches, checks out, npm-installs locally + globally', () => {
      // existsSync(cloneDir) = false on first run
      fs.existsSync.mockImplementation(() => false);
      execFileSync.mockReturnValue('1.0.0\n');
      worker.runCopyUpdate(goodPlan);
      const cmds = execFileSync.mock.calls.map(c => `${c[0]} ${c[1].join(' ')}`);
      expect(cmds.some(c => /^git clone/.test(c))).toBe(true);
      expect(cmds.some(c => /^git fetch/.test(c))).toBe(true);
      expect(cmds.some(c => /^git checkout/.test(c))).toBe(true);
      expect(cmds.some(c => /^npm install --prefix/.test(c))).toBe(true);
      expect(cmds.some(c => /^npm install -g/.test(c))).toBe(true);
    });

    test('subsequent run: skips clone when cloneDir already exists', () => {
      fs.existsSync.mockImplementation((p) => /\.ai-issue\/source\/ai-issue-cli$/.test(String(p)));
      execFileSync.mockReturnValue('1.0.0\n');
      worker.runCopyUpdate(goodPlan);
      const cmds = execFileSync.mock.calls.map(c => `${c[0]} ${c[1].join(' ')}`);
      expect(cmds.some(c => /^git clone/.test(c))).toBe(false);
      expect(cmds.some(c => /^git fetch/.test(c))).toBe(true);
    });

    test('checkout uses toCommit when present', () => {
      fs.existsSync.mockReturnValue(false);
      execFileSync.mockReturnValue('1.0.0\n');
      worker.runCopyUpdate(goodPlan);
      const checkoutCall = execFileSync.mock.calls.find(c => c[0] === 'git' && c[1][0] === 'checkout');
      expect(checkoutCall).toBeDefined();
      expect(checkoutCall[1]).toContain(goodPlan.toCommit);
    });

    test('checkout falls back to resolvedTargetRef when toCommit missing', () => {
      fs.existsSync.mockReturnValue(false);
      execFileSync.mockReturnValue('1.0.0\n');
      worker.runCopyUpdate({ ...goodPlan, toCommit: null });
      const checkoutCall = execFileSync.mock.calls.find(c => c[0] === 'git' && c[1][0] === 'checkout');
      expect(checkoutCall).toBeDefined();
      expect(checkoutCall[1]).toContain('refs/tags/v1.0.0');
    });

    test('EACCES on npm install -g maps to exit code 21 with non-sudo guidance', () => {
      fs.existsSync.mockReturnValue(true);
      execFileSync.mockImplementation((cmd, args) => {
        const cmdline = `${cmd} ${args.join(' ')}`;
        if (/npm install -g/.test(cmdline)) {
          throw Object.assign(new Error('EACCES: permission denied, mkdir /usr/lib/node_modules'), { status: 1 });
        }
        return '';
      });
      try {
        worker.runCopyUpdate(goodPlan);
        throw new Error('expected throw');
      } catch (e) {
        expect(e.exitCode).toBe(21);
        expect(e.message).toMatch(/EACCES/i);
        expect(e.message).toMatch(/npm config set prefix/i);
        // CRITICAL: must NOT positively recommend sudo (UPDATE_COMMAND_PROPOSAL §4.2.4).
        // Warning AGAINST sudo is fine and desirable.
        expect(e.message).not.toMatch(/\btry\s+sudo\b/i);
        expect(e.message).not.toMatch(/\bsudo\s+npm\s+install\s*-g\s*$/im);
        // We DO want to see explicit "do NOT sudo" guidance:
        expect(e.message).toMatch(/(WITHOUT sudo|Do NOT.*sudo|don't.*sudo)/i);
      }
    });

    test('throws when upstreamUrl missing (caller bug)', () => {
      expect(() => worker.runCopyUpdate({ ...goodPlan, upstreamUrl: null })).toThrow(/upstreamUrl/);
    });

    test('throws when globalPkg missing (caller bug)', () => {
      expect(() => worker.runCopyUpdate({ ...goodPlan, globalPkg: null })).toThrow(/globalPkg/);
    });

    test('skipSkills=true skips skills:install step', () => {
      fs.existsSync.mockReturnValue(true);
      execFileSync.mockReturnValue('1.0.0\n');
      worker.runCopyUpdate({ ...goodPlan, skipSkills: true });
      const cmds = execFileSync.mock.calls.map(c => c[1].join(' '));
      expect(cmds.some(c => /skills:install/.test(c))).toBe(false);
    });

    test('skills:install failure is non-fatal', () => {
      fs.existsSync.mockReturnValue(true);
      execFileSync.mockImplementation((cmd, args) => {
        const cmdline = `${cmd} ${args.join(' ')}`;
        if (/skills:install/.test(cmdline)) {
          throw Object.assign(new Error('skills boom'), { status: 1 });
        }
        return '1.0.0\n';
      });
      expect(() => worker.runCopyUpdate(goodPlan)).not.toThrow();
    });
  });

  describe('whichBinary', () => {
    test('uses `which` on Unix and returns trimmed first line', () => {
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'darwin' });
      execFileSync.mockReturnValue('/opt/homebrew/bin/ai-issue\n');
      expect(worker.whichBinary('ai-issue')).toBe('/opt/homebrew/bin/ai-issue');
      expect(execFileSync.mock.calls[0][0]).toBe('which');
      Object.defineProperty(process, 'platform', origPlatform);
    });

    test('uses `where` on Windows and takes the first line', () => {
      const origPlatform = Object.getOwnPropertyDescriptor(process, 'platform');
      Object.defineProperty(process, 'platform', { value: 'win32' });
      execFileSync.mockReturnValue('C:\\Users\\me\\AppData\\Roaming\\npm\\ai-issue.cmd\r\nC:\\extra\\ai-issue\r\n');
      const result = worker.whichBinary('ai-issue');
      expect(result).toBe('C:\\Users\\me\\AppData\\Roaming\\npm\\ai-issue.cmd');
      expect(execFileSync.mock.calls[0][0]).toBe('where');
      Object.defineProperty(process, 'platform', origPlatform);
    });

    test('returns null when binary is not found', () => {
      execFileSync.mockImplementation(() => { throw new Error('not found'); });
      expect(worker.whichBinary('nope')).toBeNull();
    });
  });

  describe('verifyGlobalInstall', () => {
    test('runs `node <globalPkg>/ai-issue.js --version` (NOT execFileSync of .js directly — Windows-safe)', () => {
      execFileSync.mockReturnValue('0.10.0\n');
      worker.verifyGlobalInstall({ globalPkg: '/g' });
      const versionCall = execFileSync.mock.calls.find(c => c[0] === process.execPath);
      expect(versionCall).toBeDefined();
      expect(versionCall[1]).toEqual(['/g/ai-issue.js', '--version']);
    });

    test('warns but does NOT throw when version probe fails', () => {
      execFileSync.mockImplementation(() => { throw new Error('oops'); });
      expect(() => worker.verifyGlobalInstall({ globalPkg: '/g' })).not.toThrow();
    });
  });

  describe('looksLikeEACCES', () => {
    test('matches typical EACCES messages', () => {
      expect(worker.looksLikeEACCES(new Error('EACCES: permission denied'))).toBe(true);
      expect(worker.looksLikeEACCES(new Error('permission denied'))).toBe(true);
      expect(worker.looksLikeEACCES(new Error('Operation not permitted'))).toBe(true);
    });
    test('does not match unrelated errors', () => {
      expect(worker.looksLikeEACCES(new Error('ENOENT'))).toBe(false);
      expect(worker.looksLikeEACCES(null)).toBe(false);
    });
  });

  describe('managedCloneDir', () => {
    test('lives under ~/.ai-issue/source/ai-issue-cli', () => {
      expect(worker.managedCloneDir()).toBe('/mock/home/.ai-issue/source/ai-issue-cli');
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
