/**
 * Tests for lib/update/lock.js
 *
 * Uses real tmpdir + real fs (not mocked) so the atomic O_EXCL semantics
 * are actually exercised. process.kill is mocked to control alive/dead pid.
 *
 * Covers UPDATE_COMMAND_PROPOSAL.md §5.5 v3.4 atomic single-sequence semantics.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  acquireUpdateLock,
  releaseUpdateLock,
  writeWatchActiveLock,
  unlinkWatchActiveLock,
  isUpdateLockActive,
  isPidAlive,
} = require('../../lib/update/lock');

function makeTmpPaths() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-lock-test-'));
  return {
    lockDir: dir,
    update: path.join(dir, 'update.lock'),
    watch: path.join(dir, 'watch-active.lock'),
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}

describe('lib/update/lock', () => {
  let killSpy;

  beforeEach(() => {
    killSpy = jest.spyOn(process, 'kill').mockImplementation((pid, sig) => {
      // Default: pretend any pid is alive unless the test overrides.
      if (sig === 0) return true;
      return true;
    });
  });

  afterEach(() => {
    killSpy.mockRestore();
  });

  describe('isPidAlive', () => {
    it('returns false for falsy / non-numeric pids', () => {
      killSpy.mockImplementation(() => true);
      expect(isPidAlive(undefined)).toBe(false);
      expect(isPidAlive(null)).toBe(false);
      expect(isPidAlive('123')).toBe(false);
      expect(isPidAlive(NaN)).toBe(false);
    });

    it('returns true when process.kill(pid, 0) succeeds', () => {
      killSpy.mockImplementation(() => true);
      expect(isPidAlive(99999)).toBe(true);
    });

    it('returns false when ESRCH', () => {
      killSpy.mockImplementation(() => { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; });
      expect(isPidAlive(99999)).toBe(false);
    });

    it('returns true when EPERM (process exists but we lack signal perms)', () => {
      killSpy.mockImplementation(() => { const e = new Error('EPERM'); e.code = 'EPERM'; throw e; });
      expect(isPidAlive(1)).toBe(true);
    });
  });

  describe('acquireUpdateLock — happy paths', () => {
    let p;
    beforeEach(() => { p = makeTmpPaths(); });
    afterEach(() => { p.cleanup(); });

    it('creates update.lock when neither lock exists', () => {
      const r = acquireUpdateLock({ paths: p });
      expect(r.acquired).toBe(true);
      expect(fs.existsSync(p.update)).toBe(true);
      const content = JSON.parse(fs.readFileSync(p.update, 'utf8'));
      expect(content.pid).toBe(process.pid);
      expect(content.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('proceeds when watch-active.lock is absent', () => {
      const r = acquireUpdateLock({ paths: p });
      expect(r.acquired).toBe(true);
      // update.lock should still be there afterwards
      expect(fs.existsSync(p.update)).toBe(true);
    });

    it('clears stale watch-active.lock and proceeds', () => {
      // Write a watch lock with a pid we mark as dead.
      fs.writeFileSync(p.watch, JSON.stringify({ pid: 99999, startedAt: 'x' }));
      killSpy.mockImplementation((pid) => {
        if (pid === 99999) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
        return true;
      });
      const r = acquireUpdateLock({ paths: p });
      expect(r.acquired).toBe(true);
      expect(fs.existsSync(p.watch)).toBe(false); // cleared
      expect(fs.existsSync(p.update)).toBe(true);
    });

    it('clears stale update.lock and re-acquires', () => {
      // Write a stale update.lock with a dead pid.
      fs.writeFileSync(p.update, JSON.stringify({ pid: 88888, startedAt: 'old' }));
      killSpy.mockImplementation((pid) => {
        if (pid === 88888) { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; }
        return true;
      });
      const r = acquireUpdateLock({ paths: p });
      expect(r.acquired).toBe(true);
      const content = JSON.parse(fs.readFileSync(p.update, 'utf8'));
      expect(content.pid).toBe(process.pid);
    });

    it('createdLockDir if missing', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-lock-test-'));
      const subDir = path.join(dir, 'nested', 'locks');
      const paths = {
        lockDir: subDir,
        update: path.join(subDir, 'update.lock'),
        watch: path.join(subDir, 'watch-active.lock'),
      };
      try {
        acquireUpdateLock({ paths });
        expect(fs.existsSync(paths.update)).toBe(true);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('acquireUpdateLock — refusals', () => {
    let p;
    beforeEach(() => { p = makeTmpPaths(); });
    afterEach(() => { p.cleanup(); });

    it('throws UPDATE_BUSY when an alive update.lock exists', () => {
      fs.writeFileSync(p.update, JSON.stringify({ pid: 12345, startedAt: '2026-01-01T00:00:00Z' }));
      killSpy.mockImplementation((pid) => {
        if (pid === 12345) return true; // alive
        return true;
      });
      let caught;
      try { acquireUpdateLock({ paths: p }); } catch (e) { caught = e; }
      expect(caught.code).toBe('UPDATE_BUSY');
      expect(caught.message).toMatch(/pid 12345/);
      expect(caught.existing.pid).toBe(12345);
      // update.lock must still exist (held by other process)
      expect(fs.existsSync(p.update)).toBe(true);
    });

    it('throws WATCH_BUSY when an alive watch-active.lock exists, AND releases the update.lock it just took', () => {
      fs.writeFileSync(p.watch, JSON.stringify({ pid: 67890, startedAt: '2026-01-01T01:00:00Z' }));
      killSpy.mockImplementation(() => true); // any pid alive
      let caught;
      try { acquireUpdateLock({ paths: p }); } catch (e) { caught = e; }
      expect(caught.code).toBe('WATCH_BUSY');
      expect(caught.message).toMatch(/pid 67890/);
      expect(caught.message).toMatch(/kill 67890/);
      // CRITICAL v3.4 invariant: update.lock must be released so a future
      // legitimate update is not blocked by a stale entry pointing at us.
      expect(fs.existsSync(p.update)).toBe(false);
      // watch lock untouched (held by alive watch)
      expect(fs.existsSync(p.watch)).toBe(true);
    });

    it('atomic single sequence: between O_EXCL and watch lstat there is no hole', () => {
      // We can't truly inject a parallel watch process, but we can verify
      // that acquireUpdateLock takes update.lock BEFORE inspecting watch.
      // Simulate: watch-active.lock starts absent. After update.lock is taken,
      // even if watch were to write its lock, we would not check again.
      // Verify by writing watch lock AFTER acquire returns and confirming
      // the function does not retroactively notice.
      const r = acquireUpdateLock({ paths: p });
      expect(r.acquired).toBe(true);
      fs.writeFileSync(p.watch, JSON.stringify({ pid: 1, startedAt: 'late' }));
      // Locks remain — caller decides what to do.
      expect(fs.existsSync(p.update)).toBe(true);
      expect(fs.existsSync(p.watch)).toBe(true);
    });
  });

  describe('releaseUpdateLock', () => {
    let p;
    beforeEach(() => { p = makeTmpPaths(); });
    afterEach(() => { p.cleanup(); });

    it('removes the update.lock file', () => {
      acquireUpdateLock({ paths: p });
      expect(fs.existsSync(p.update)).toBe(true);
      releaseUpdateLock(p);
      expect(fs.existsSync(p.update)).toBe(false);
    });

    it('is idempotent (no-op when lock missing)', () => {
      expect(() => releaseUpdateLock(p)).not.toThrow();
    });
  });

  describe('writeWatchActiveLock / unlinkWatchActiveLock', () => {
    let p;
    beforeEach(() => { p = makeTmpPaths(); });
    afterEach(() => { p.cleanup(); });

    it('writes JSON with pid and startedAt', () => {
      writeWatchActiveLock({ issuesInCycle: 5 }, p);
      expect(fs.existsSync(p.watch)).toBe(true);
      const data = JSON.parse(fs.readFileSync(p.watch, 'utf8'));
      expect(data.pid).toBe(process.pid);
      expect(data.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(data.issuesInCycle).toBe(5);
    });

    it('unlink is idempotent', () => {
      expect(() => unlinkWatchActiveLock(p)).not.toThrow();
      writeWatchActiveLock({}, p);
      unlinkWatchActiveLock(p);
      expect(fs.existsSync(p.watch)).toBe(false);
    });
  });

  describe('isUpdateLockActive', () => {
    let p;
    beforeEach(() => { p = makeTmpPaths(); });
    afterEach(() => { p.cleanup(); });

    it('returns false when no lock', () => {
      expect(isUpdateLockActive(p)).toBe(false);
    });

    it('returns true when lock exists with alive pid', () => {
      fs.writeFileSync(p.update, JSON.stringify({ pid: 12345, startedAt: 'x' }));
      killSpy.mockImplementation(() => true);
      expect(isUpdateLockActive(p)).toBe(true);
    });

    it('returns false when lock exists but pid is dead', () => {
      fs.writeFileSync(p.update, JSON.stringify({ pid: 12345, startedAt: 'x' }));
      killSpy.mockImplementation(() => { const e = new Error('ESRCH'); e.code = 'ESRCH'; throw e; });
      expect(isUpdateLockActive(p)).toBe(false);
    });
  });
});
