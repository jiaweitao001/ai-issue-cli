/**
 * Tests for lib/update/state.js
 *
 * Covers UPDATE_COMMAND_PROPOSAL.md §4.3.3 mode-aware identity check + ownership.
 */

const path = require('path');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home'),
}));

const fs = require('fs');

const {
  ensureStateOwnership,
  readState,
  writeState,
  statePathFor,
  hashPath,
  AI_ISSUE_DIR,
  STATE_DIR,
} = require('../../lib/update/state');

describe('lib/update/state', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('hashPath / statePathFor', () => {
    it('produces a 12-char hex hash', () => {
      const h = hashPath('/some/path');
      expect(h).toMatch(/^[0-9a-f]{12}$/);
    });

    it('different inputs produce different hashes', () => {
      expect(hashPath('/a')).not.toBe(hashPath('/b'));
    });

    it('same input is stable across calls', () => {
      expect(hashPath('/a')).toBe(hashPath('/a'));
    });

    it('statePathFor lives under STATE_DIR', () => {
      const p = statePathFor('/foo');
      expect(p.startsWith(STATE_DIR)).toBe(true);
      expect(p.endsWith('.json')).toBe(true);
    });

    it('STATE_DIR sits inside ~/.ai-issue', () => {
      expect(STATE_DIR.startsWith(AI_ISSUE_DIR)).toBe(true);
    });
  });

  describe('ensureStateOwnership', () => {
    let originalGetUid;
    beforeEach(() => {
      originalGetUid = process.getuid;
    });
    afterEach(() => {
      if (originalGetUid) {
        process.getuid = originalGetUid;
      } else {
        delete process.getuid;
      }
    });

    it('no-ops when ~/.ai-issue does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      process.getuid = jest.fn(() => 501);
      expect(() => ensureStateOwnership()).not.toThrow();
    });

    it('passes when ~/.ai-issue uid matches current uid', () => {
      fs.existsSync.mockReturnValue(true);
      fs.lstatSync.mockReturnValue({ uid: 501 });
      process.getuid = jest.fn(() => 501);
      expect(() => ensureStateOwnership()).not.toThrow();
    });

    it('throws OWNERSHIP error when uids differ', () => {
      fs.existsSync.mockReturnValue(true);
      fs.lstatSync.mockReturnValue({ uid: 0 });
      process.getuid = jest.fn(() => 501);
      let caught;
      try { ensureStateOwnership(); } catch (e) { caught = e; }
      expect(caught).toBeDefined();
      expect(caught.code).toBe('OWNERSHIP');
      expect(caught.message).toMatch(/uid 0/);
      expect(caught.message).toMatch(/501/);
      expect(caught.message).toMatch(/sudo chown/);
    });

    it('no-ops on Windows (process.getuid undefined)', () => {
      delete process.getuid;
      fs.existsSync.mockReturnValue(true);
      fs.lstatSync.mockReturnValue({ uid: 9999 });
      expect(() => ensureStateOwnership()).not.toThrow();
    });

    it('does not throw when lstat fails (treat as best-effort)', () => {
      fs.existsSync.mockReturnValue(true);
      fs.lstatSync.mockImplementation(() => { throw new Error('boom'); });
      process.getuid = jest.fn(() => 501);
      expect(() => ensureStateOwnership()).not.toThrow();
    });
  });

  describe('readState', () => {
    it('returns null when no state file', () => {
      fs.existsSync.mockReturnValue(false);
      expect(readState({ globalPkg: '/g' })).toBeNull();
    });

    it('returns null when state JSON is corrupt', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('{not valid json');
      expect(readState({ globalPkg: '/g' })).toBeNull();
    });

    it('returns the state object when mode matches and no sourceClone change', () => {
      const state = {
        commit: 'abc',
        ref: 'refs/tags/v0.9.1',
        channel: 'tag',
        mode: 'copy',
        sourceClone: null,
      };
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify(state));
      const r = readState({ mode: 'copy', globalPkg: '/g' });
      expect(r).toEqual(state);
      expect(r.__stale).toBeUndefined();
    });

    it('returns __stale when mode flipped (copy -> link)', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ mode: 'copy', commit: 'abc' }));
      const r = readState({ mode: 'link', globalPkg: '/g', sourceClone: '/clone' });
      expect(r.__stale).toBe(true);
      expect(r.reason).toMatch(/install mode changed/);
      expect(r.prev.commit).toBe('abc');
    });

    it('returns __stale when sourceClone differs in link mode', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        mode: 'link',
        sourceClone: '/old/clone',
        commit: 'abc',
      }));
      const r = readState({ mode: 'link', globalPkg: '/g', sourceClone: '/new/clone' });
      expect(r.__stale).toBe(true);
      expect(r.reason).toMatch(/source clone changed/);
    });

    it('does not flag stale when modes match and sourceClones match', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        mode: 'link',
        sourceClone: '/clone',
      }));
      const r = readState({ mode: 'link', globalPkg: '/g', sourceClone: '/clone' });
      expect(r.__stale).toBeUndefined();
    });

    it('does not flag stale when state has no recorded mode (legacy file)', () => {
      // backward-compat path: identity check skipped if state.mode missing
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({ commit: 'abc' }));
      const r = readState({ mode: 'link', globalPkg: '/g', sourceClone: '/clone' });
      expect(r.__stale).toBeUndefined();
      expect(r.commit).toBe('abc');
    });
  });

  describe('writeState', () => {
    it('creates STATE_DIR when missing and writes merged JSON', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockReturnValue(undefined);
      fs.writeFileSync.mockReturnValue(undefined);

      const merged = writeState(
        { mode: 'copy', globalPkg: '/g' },
        { commit: 'abc123', ref: 'refs/tags/v0.9.1', channel: 'tag' }
      );

      expect(fs.mkdirSync).toHaveBeenCalledWith(STATE_DIR, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenStr = fs.writeFileSync.mock.calls[0][1];
      const written = JSON.parse(writtenStr);
      expect(written.commit).toBe('abc123');
      expect(written.ref).toBe('refs/tags/v0.9.1');
      expect(written.channel).toBe('tag');
      expect(written.mode).toBe('copy');
      expect(written.sourceClone).toBeNull();
      expect(written.installedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(written.installedBy).toBe('ai-issue-update');
      expect(merged).toEqual(written);
    });

    it('records sourceClone for link installs', () => {
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      writeState(
        { mode: 'link', globalPkg: '/g', sourceClone: '/clone' },
        { commit: 'abc' }
      );
      const written = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(written.mode).toBe('link');
      expect(written.sourceClone).toBe('/clone');
    });

    it('throws when detected.globalPkg missing (caller bug)', () => {
      expect(() => writeState({ mode: 'copy' }, {})).toThrow(/globalPkg/);
    });

    it('writes to the hash-derived path under STATE_DIR', () => {
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      writeState({ mode: 'copy', globalPkg: '/some/path' }, {});
      const writtenPath = fs.writeFileSync.mock.calls[0][0];
      expect(writtenPath).toBe(statePathFor('/some/path'));
      expect(writtenPath).toContain(STATE_DIR);
    });
  });
});
