/**
 * Tests for lib/update/version-check.js
 *
 * Covers UPDATE_COMMAND_PROPOSAL.md §4.3.1 (channel resolution),
 * §4.3.2 (three-state tag detection), §4.5 (report contract).
 */

jest.mock('fs');
jest.mock('child_process');

const fs = require('fs');
const { execFileSync } = require('child_process');

const {
  resolveEffectiveChannel,
  channelReasonOf,
  parseLsRemoteTags,
  probeRemote,
  getUpstreamUrl,
  getInstalledVersion,
  checkCliVersion,
  printCheckReport,
  normalizeRepoUrl,
  REASON_LABELS,
} = require('../../lib/update/version-check');

describe('lib/update/version-check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('resolveEffectiveChannel (mode-split auto)', () => {
    it('auto + link mode -> branch', () => {
      expect(resolveEffectiveChannel({ updateChannel: 'auto' }, 'link')).toBe('branch');
    });

    it('auto + copy mode -> tag', () => {
      expect(resolveEffectiveChannel({ updateChannel: 'auto' }, 'copy')).toBe('tag');
    });

    it('explicit tag overrides regardless of mode', () => {
      expect(resolveEffectiveChannel({ updateChannel: 'tag' }, 'link')).toBe('tag');
      expect(resolveEffectiveChannel({ updateChannel: 'tag' }, 'copy')).toBe('tag');
    });

    it('explicit branch overrides regardless of mode', () => {
      expect(resolveEffectiveChannel({ updateChannel: 'branch' }, 'link')).toBe('branch');
      expect(resolveEffectiveChannel({ updateChannel: 'branch' }, 'copy')).toBe('branch');
    });

    it('treats missing updateChannel as auto', () => {
      expect(resolveEffectiveChannel({}, 'link')).toBe('branch');
      expect(resolveEffectiveChannel({}, 'copy')).toBe('tag');
      expect(resolveEffectiveChannel(null, 'copy')).toBe('tag');
    });
  });

  describe('channelReasonOf', () => {
    it('returns pinned when --ref present (regardless of config)', () => {
      expect(channelReasonOf({ updateChannel: 'tag' }, 'link', true)).toBe('pinned');
      expect(channelReasonOf({ updateChannel: 'auto' }, 'copy', true)).toBe('pinned');
    });

    it('returns auto-link / auto-copy when channel=auto', () => {
      expect(channelReasonOf({ updateChannel: 'auto' }, 'link', false)).toBe('auto-link');
      expect(channelReasonOf({ updateChannel: 'auto' }, 'copy', false)).toBe('auto-copy');
    });

    it('returns explicit when channel is not auto', () => {
      expect(channelReasonOf({ updateChannel: 'tag' }, 'link', false)).toBe('explicit');
      expect(channelReasonOf({ updateChannel: 'branch' }, 'copy', false)).toBe('explicit');
    });

    it('REASON_LABELS covers all four reasons', () => {
      expect(REASON_LABELS['auto-link']).toBeDefined();
      expect(REASON_LABELS['auto-copy']).toBeDefined();
      expect(REASON_LABELS['explicit']).toBeDefined();
      expect(REASON_LABELS['pinned']).toBeDefined();
    });
  });

  describe('parseLsRemoteTags', () => {
    it('extracts stable semver tags', () => {
      const out =
        'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v0.9.0\n' +
        'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222\trefs/tags/v0.9.1\n' +
        'cccc3333cccc3333cccc3333cccc3333cccc3333\trefs/tags/v1.0.0\n';
      const { stable, prerelease } = parseLsRemoteTags(out);
      expect(prerelease).toEqual([]);
      expect(stable.map(s => s.tag)).toEqual(['v1.0.0', 'v0.9.1', 'v0.9.0']);
      expect(stable[0].commit).toBe('cccc3333cccc3333cccc3333cccc3333cccc3333');
    });

    it('separates prereleases from stable', () => {
      const out =
        'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v1.0.0-rc.1\n' +
        'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222\trefs/tags/v0.9.1\n';
      const { stable, prerelease } = parseLsRemoteTags(out);
      expect(stable.map(s => s.tag)).toEqual(['v0.9.1']);
      expect(prerelease.map(p => p.tag)).toEqual(['v1.0.0-rc.1']);
    });

    it('drops non-semver tags (e.g. release-2024-Q1)', () => {
      const out =
        'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/release-2024-Q1\n' +
        'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222\trefs/tags/v0.9.1\n';
      const { stable } = parseLsRemoteTags(out);
      expect(stable.map(s => s.tag)).toEqual(['v0.9.1']);
    });

    it('prefers dereferenced commit (^{}) for annotated tags', () => {
      const out =
        '0000000000000000000000000000000000000000\trefs/tags/v0.9.1\n' +
        'ffffffffffffffffffffffffffffffffffffffff\trefs/tags/v0.9.1^{}\n';
      const { stable } = parseLsRemoteTags(out);
      expect(stable[0].commit).toBe('ffffffffffffffffffffffffffffffffffffffff');
    });

    it('returns empty arrays on empty input', () => {
      expect(parseLsRemoteTags('')).toEqual({ stable: [], prerelease: [] });
      expect(parseLsRemoteTags(null)).toEqual({ stable: [], prerelease: [] });
    });

    it('sorts stable correctly across major.minor.patch', () => {
      const lines = [
        '1111111111111111111111111111111111111111\trefs/tags/v0.9.10',
        '2222222222222222222222222222222222222222\trefs/tags/v0.9.2',
        '3333333333333333333333333333333333333333\trefs/tags/v1.0.0',
        '4444444444444444444444444444444444444444\trefs/tags/v0.10.0',
      ].join('\n');
      const { stable } = parseLsRemoteTags(lines);
      expect(stable.map(s => s.tag)).toEqual(['v1.0.0', 'v0.10.0', 'v0.9.10', 'v0.9.2']);
    });
  });

  describe('probeRemote', () => {
    it('throws code=NETWORK when ls-remote --tags fails', () => {
      execFileSync.mockImplementation(() => { throw new Error('Could not resolve host'); });
      let caught;
      try { probeRemote('https://example/repo.git'); } catch (e) { caught = e; }
      expect(caught.code).toBe('NETWORK');
      expect(caught.message).toMatch(/git ls-remote/);
    });

    it('returns parsed tags + symref + headSha on success', () => {
      execFileSync.mockImplementation((cmd, args) => {
        if (args[0] === 'ls-remote' && args[1] === '--tags') {
          return 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v0.9.1\n';
        }
        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return 'ref: refs/heads/main\tHEAD\nabcdef1234567890abcdef1234567890abcdef12\tHEAD\n';
        }
        throw new Error('unexpected');
      });
      const r = probeRemote('https://example/repo.git');
      expect(r.stable).toHaveLength(1);
      expect(r.symrefHead).toBe('refs/heads/main');
      expect(r.headSha).toBe('abcdef1234567890abcdef1234567890abcdef12');
    });

    it('tolerates symref failure (returns null symref/headSha but still returns tags)', () => {
      let calls = 0;
      execFileSync.mockImplementation((cmd, args) => {
        calls++;
        if (args[1] === '--tags') {
          return 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v0.9.1\n';
        }
        throw new Error('symref unsupported');
      });
      const r = probeRemote('https://example/repo.git');
      expect(r.stable).toHaveLength(1);
      expect(r.symrefHead).toBeNull();
      expect(r.headSha).toBeNull();
    });
  });

  describe('normalizeRepoUrl', () => {
    it('strips git+ prefix', () => {
      expect(normalizeRepoUrl('git+https://github.com/x/y.git')).toBe('https://github.com/x/y.git');
    });

    it('rewrites git@ to https://', () => {
      expect(normalizeRepoUrl('git@github.com:x/y.git')).toBe('https://github.com/x/y.git');
    });

    it('returns null for falsy input', () => {
      expect(normalizeRepoUrl(null)).toBeNull();
      expect(normalizeRepoUrl('')).toBeNull();
    });
  });

  describe('getUpstreamUrl', () => {
    it('prefers git remote get-url origin from sourceClone', () => {
      execFileSync.mockReturnValue('https://github.com/x/y.git\n');
      const url = getUpstreamUrl({ sourceClone: '/clone', mode: 'link' });
      expect(url).toBe('https://github.com/x/y.git');
    });

    it('falls back to package.json#repository.url when git remote fails', () => {
      execFileSync.mockImplementation(() => { throw new Error('no remote'); });
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repository: { url: 'git+https://github.com/x/y.git' },
      }));
      const url = getUpstreamUrl({ sourceClone: '/clone', mode: 'link' });
      expect(url).toBe('https://github.com/x/y.git');
    });

    it('falls back to globalPkg/package.json for copy mode', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repository: { url: 'https://github.com/x/y.git' },
      }));
      const url = getUpstreamUrl({ globalPkg: '/g', mode: 'copy' });
      expect(url).toBe('https://github.com/x/y.git');
    });

    it('returns null when nothing available', () => {
      execFileSync.mockImplementation(() => { throw new Error('x'); });
      fs.readFileSync.mockImplementation(() => { throw new Error('no pkg'); });
      const url = getUpstreamUrl({ sourceClone: '/clone' });
      expect(url).toBeNull();
    });
  });

  describe('getInstalledVersion', () => {
    it('reads version from package.json in sourceClone for link mode', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '0.9.0' }));
      execFileSync.mockReturnValue('abc123def\n');
      const r = getInstalledVersion({ mode: 'link', sourceClone: '/c' }, null);
      expect(r.version).toBe('0.9.0');
      expect(r.commit).toBe('abc123def');
    });

    it('falls back to state.commit when git rev-parse fails (copy mode)', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '0.9.1' }));
      const r = getInstalledVersion(
        { mode: 'copy', globalPkg: '/g' },
        { commit: 'state-commit' }
      );
      expect(r.version).toBe('0.9.1');
      expect(r.commit).toBe('state-commit');
    });

    it('returns version=null when package.json unreadable', () => {
      fs.readFileSync.mockImplementation(() => { throw new Error('ENOENT'); });
      const r = getInstalledVersion({ mode: 'copy', globalPkg: '/g' }, null);
      expect(r.version).toBeNull();
      expect(r.commit).toBeNull();
    });
  });

  describe('checkCliVersion', () => {
    function setupHappy({ tags, branch, pkgVersion = '0.9.0', sourceClone = '/clone', mode = 'link', currentBranch = 'main' } = {}) {
      execFileSync.mockImplementation((cmd, args) => {
        if (args[0] === 'remote' && args[1] === 'get-url') return 'https://github.com/x/y.git\n';
        if (args[0] === 'ls-remote' && args[1] === '--tags') return tags;
        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return 'ref: refs/heads/main\tHEAD\n0000000000000000000000000000000000000000\tHEAD\n';
        }
        if (args[0] === 'ls-remote' && !args[1].startsWith('-')) {
          // ls-remote <url> <ref>
          if (branch && branch[args[2]]) return `${branch[args[2]]}\t${args[2]}\n`;
          return '';
        }
        if (args[0] === 'rev-parse') return 'abcdef1234567890abcdef1234567890abcdef12\n';
        throw new Error(`unexpected ${cmd} ${args.join(' ')}`);
      });
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: pkgVersion }));
      return {
        mode,
        sourceClone,
        globalPkg: '/g',
        currentBranch,
      };
    }

    it('tag channel: returns latest stable tag when remote has stable tags', async () => {
      const detected = setupHappy({
        tags: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v0.9.1\n' +
              'bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222\trefs/tags/v1.0.0\n',
        mode: 'copy',
      });
      const r = await checkCliVersion(detected, 'tag', {}, { config: { updateChannel: 'auto' } });
      expect(r.toLabel).toBe('v1.0.0');
      expect(r.toCommit).toBe('bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222');
      expect(r.effectiveChannel).toBe('tag');
      expect(r.configuredChannel).toBe('auto');
      expect(r.channelReason).toBe('auto-copy');
      expect(r.needsUpdate).toBe(true); // installed 0.9.0 vs latest 1.0.0
    });

    it('tag channel: throws NO_TAGS when remote has only prereleases', async () => {
      const detected = setupHappy({
        tags: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v1.0.0-rc.1\n',
        mode: 'copy',
      });
      let caught;
      try { await checkCliVersion(detected, 'tag', {}, { config: {} }); } catch (e) { caught = e; }
      expect(caught.code).toBe('NO_TAGS');
      expect(caught.message).toMatch(/Only prerelease tags exist/);
      expect(caught.message).toMatch(/v1\.0\.0-rc\.1/);
    });

    it('tag channel: throws NO_TAGS with different message when no tags at all', async () => {
      const detected = setupHappy({ tags: '', mode: 'copy' });
      let caught;
      try { await checkCliVersion(detected, 'tag', {}, { config: {} }); } catch (e) { caught = e; }
      expect(caught.code).toBe('NO_TAGS');
      expect(caught.message).toMatch(/No tags found at all/);
    });

    it('branch channel link mode: uses currentBranch from detected', async () => {
      const detected = setupHappy({
        tags: '',
        branch: { 'refs/heads/main': '1111111111111111111111111111111111111111' },
        mode: 'link',
        currentBranch: 'main',
      });
      const r = await checkCliVersion(detected, 'branch', {}, { config: { updateChannel: 'auto' } });
      expect(r.effectiveChannel).toBe('branch');
      expect(r.channelReason).toBe('auto-link');
      expect(r.toLabel).toMatch(/^main@1111111$/);
      expect(r.toCommit).toBe('1111111111111111111111111111111111111111');
      expect(r.fromCommit).toBe('abcdef1234567890abcdef1234567890abcdef12');
      expect(r.needsUpdate).toBe(true);
    });

    it('branch channel: needsUpdate=false when current commit equals remote', async () => {
      const sameSha = 'abcdef1234567890abcdef1234567890abcdef12';
      execFileSync.mockImplementation((cmd, args) => {
        if (args[0] === 'remote' && args[1] === 'get-url') return 'https://github.com/x/y.git\n';
        if (args[0] === 'ls-remote' && args[1] === '--tags') return '';
        if (args[0] === 'ls-remote' && args[1] === '--symref') {
          return 'ref: refs/heads/main\tHEAD\n' + sameSha + '\tHEAD\n';
        }
        if (args[0] === 'ls-remote') return `${sameSha}\trefs/heads/main\n`;
        if (args[0] === 'rev-parse') return sameSha + '\n';
        throw new Error('unexpected');
      });
      fs.readFileSync.mockReturnValue(JSON.stringify({ version: '0.9.0' }));

      const r = await checkCliVersion(
        { mode: 'link', sourceClone: '/c', globalPkg: '/g', currentBranch: 'main' },
        'branch',
        {},
        { config: {} }
      );
      expect(r.needsUpdate).toBe(false);
      expect(r.fromLabel).toBe(sameSha.slice(0, 7));
    });

    it('throws NO_URL when no upstream URL found', async () => {
      execFileSync.mockImplementation(() => { throw new Error('no remote'); });
      fs.readFileSync.mockImplementation(() => { throw new Error('no pkg'); });
      let caught;
      try {
        await checkCliVersion({ mode: 'copy', globalPkg: '/g' }, 'tag', {}, { config: {} });
      } catch (e) { caught = e; }
      expect(caught.code).toBe('NO_URL');
    });

    it('produces channelReason=explicit when config has non-auto channel', async () => {
      const detected = setupHappy({
        tags: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v0.9.1\n',
        mode: 'link',
      });
      const r = await checkCliVersion(detected, 'tag', {}, { config: { updateChannel: 'tag' } });
      expect(r.channelReason).toBe('explicit');
    });

    it('produces channelReason=pinned when --ref present', async () => {
      const detected = setupHappy({
        tags: 'aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111\trefs/tags/v0.9.1\n',
        mode: 'copy',
      });
      const r = await checkCliVersion(detected, 'pinned', { ref: 'v0.9.1' }, { config: { updateChannel: 'auto' } });
      expect(r.channelReason).toBe('pinned');
      expect(r.toLabel).toBe('v0.9.1');
      expect(r.toRef).toBe('v0.9.1');
    });
  });

  describe('printCheckReport', () => {
    it('produces channel line in §3.3 contract format', () => {
      const lines = [];
      const fakeLog = (m) => lines.push(m);
      printCheckReport({
        mode: 'link',
        sourceClone: '/clone',
        globalPkg: '/g',
        configuredChannel: 'auto',
        effectiveChannel: 'branch',
        channelReason: 'auto-link',
        fromVersion: '0.9.0',
        fromLabel: 'abc1234',
        fromCommit: 'abc1234567890',
        toLabel: 'main@def5678',
        toCommit: 'def5678',
        toRef: 'refs/heads/main',
        needsUpdate: true,
        upstreamUrl: 'https://github.com/x/y.git',
      }, { log: fakeLog });

      const channelLine = lines.find(l => typeof l === 'string' && l.startsWith('Channel'));
      expect(channelLine).toBeDefined();
      expect(channelLine).toMatch(/^Channel\s+:\s+branch\s+\(configured: auto, resolved: auto, link mode default\)$/);
    });

    it('shows "up to date" when needsUpdate=false and omits override hint', () => {
      const lines = [];
      printCheckReport({
        mode: 'copy',
        sourceClone: null,
        globalPkg: '/g',
        configuredChannel: 'auto',
        effectiveChannel: 'tag',
        channelReason: 'auto-copy',
        fromVersion: '1.0.0',
        fromLabel: 'v1.0.0',
        fromCommit: null,
        toLabel: 'v1.0.0',
        toCommit: 'aaa',
        toRef: 'refs/tags/v1.0.0',
        needsUpdate: false,
        upstreamUrl: 'https://github.com/x/y.git',
      }, { log: (m) => lines.push(m) });
      const status = lines.find(l => typeof l === 'string' && l.startsWith('Status'));
      expect(status).toMatch(/up to date/);
      expect(lines.find(l => typeof l === 'string' && l.includes("Run 'ai-issue update'"))).toBeUndefined();
    });

    it('suggests opposite channel when configuredChannel=auto and update available', () => {
      const lines = [];
      printCheckReport({
        mode: 'copy',
        sourceClone: null,
        globalPkg: '/g',
        configuredChannel: 'auto',
        effectiveChannel: 'tag',
        channelReason: 'auto-copy',
        fromVersion: '0.9.0',
        fromLabel: 'v0.9.0',
        fromCommit: null,
        toLabel: 'v1.0.0',
        toCommit: 'bbb',
        toRef: 'refs/tags/v1.0.0',
        needsUpdate: true,
        upstreamUrl: 'https://github.com/x/y.git',
      }, { log: (m) => lines.push(m) });
      expect(lines.find(l => typeof l === 'string' && l.includes('updateChannel branch'))).toBeDefined();
    });

    it('does not suggest override when channel is explicitly set', () => {
      const lines = [];
      printCheckReport({
        mode: 'link',
        sourceClone: '/c',
        globalPkg: '/g',
        configuredChannel: 'tag',
        effectiveChannel: 'tag',
        channelReason: 'explicit',
        fromVersion: '0.9.0',
        fromLabel: 'v0.9.0',
        fromCommit: null,
        toLabel: 'v1.0.0',
        toCommit: 'b',
        toRef: 'refs/tags/v1.0.0',
        needsUpdate: true,
        upstreamUrl: 'https://github.com/x/y.git',
      }, { log: (m) => lines.push(m) });
      expect(lines.find(l => typeof l === 'string' && l.includes('Override channel'))).toBeUndefined();
    });
  });
});
