/**
 * Tests for lib/migration-notifier.js
 */

const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home'),
}));

// migration-notifier writes to stderr directly via process.stderr.write,
// not via the shared logger — so we don't mock logger here. We do spy on
// process.stderr.write to assert banner output.

let stderrSpy;

beforeEach(() => {
  jest.clearAllMocks();
  stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
});

afterEach(() => {
  stderrSpy.mockRestore();
});

describe('migration-notifier', () => {
  describe('maybeShowMigrationBanner', () => {
    it('renders the banner when no state file exists (first call)', () => {
      fs.readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');

      maybeShowMigrationBanner({ newUrl: 'https://new.example.com', deadline: '2026-06-15' });

      const all = stderrSpy.mock.calls.flat().join('');
      expect(all).toContain('migrating to a new Azure subscription');
      expect(all).toContain('https://new.example.com');
      expect(all).toContain('2026-06-15');
      expect(fs.writeFileSync).toHaveBeenCalled();
    });

    it('does NOT render when info is null/undefined/missing newUrl', () => {
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');
      maybeShowMigrationBanner(null);
      maybeShowMigrationBanner(undefined);
      maybeShowMigrationBanner({ newUrl: '' });
      expect(stderrSpy).not.toHaveBeenCalled();
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('throttles repeat calls within the 24h window', () => {
      // First call: no state.
      fs.readFileSync.mockImplementationOnce(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');

      maybeShowMigrationBanner({ newUrl: 'https://new.example.com' });
      expect(stderrSpy).toHaveBeenCalled();
      stderrSpy.mockClear();

      // Second call: state file exists with recent timestamp → throttled.
      fs.readFileSync.mockReturnValue(JSON.stringify({
        shown: { 'https://new.example.com': Date.now() - 1000 },
      }));
      maybeShowMigrationBanner({ newUrl: 'https://new.example.com' });
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('renders again after the throttle window has expired', () => {
      const TWENTY_FIVE_HOURS_MS = 25 * 60 * 60 * 1000;
      fs.readFileSync.mockReturnValue(JSON.stringify({
        shown: { 'https://new.example.com': Date.now() - TWENTY_FIVE_HOURS_MS },
      }));
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');

      maybeShowMigrationBanner({ newUrl: 'https://new.example.com' });
      expect(stderrSpy).toHaveBeenCalled();
    });

    it('self-heals on corrupted state file (treats as empty, then writes valid JSON)', () => {
      fs.readFileSync.mockReturnValue('this is not json {{{');
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');

      maybeShowMigrationBanner({ newUrl: 'https://new.example.com' });

      expect(stderrSpy).toHaveBeenCalled(); // banner was rendered despite corruption
      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenJson = fs.writeFileSync.mock.calls[0][1];
      // Result must be valid JSON (no parse error).
      expect(() => JSON.parse(writtenJson)).not.toThrow();
      const parsed = JSON.parse(writtenJson);
      expect(parsed.shown['https://new.example.com']).toEqual(expect.any(Number));
    });

    it('renders deadline-not-announced fallback when deadline is missing', () => {
      fs.readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');

      maybeShowMigrationBanner({ newUrl: 'https://new.example.com' });

      const all = stderrSpy.mock.calls.flat().join('');
      expect(all).toContain('not announced');
    });

    it('shows fallback message when newUrl fails URL validation', () => {
      fs.readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');

      maybeShowMigrationBanner({ newUrl: 'ftp://wrong-scheme.example.com' });

      const all = stderrSpy.mock.calls.flat().join('');
      expect(all).toContain('failed validation');
      // Must NOT include the copy-paste command line.
      expect(all).not.toContain('ai-issue config set serviceUrl ftp://');
    });

    it('never throws even when fs operations fail', () => {
      fs.readFileSync.mockImplementation(() => { throw new Error('disk on fire'); });
      fs.existsSync.mockImplementation(() => { throw new Error('disk on fire'); });
      fs.writeFileSync.mockImplementation(() => { throw new Error('disk on fire'); });
      fs.mkdirSync.mockImplementation(() => { throw new Error('disk on fire'); });
      const { maybeShowMigrationBanner } = require('../lib/migration-notifier');

      // Must NOT throw.
      expect(() => maybeShowMigrationBanner({ newUrl: 'https://new.example.com' })).not.toThrow();
    });
  });

  describe('showMigrationBannerForced', () => {
    it('renders even when state shows recent banner (bypasses throttle)', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        shown: { 'https://new.example.com': Date.now() - 1000 }, // 1s ago
      }));
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      const { showMigrationBannerForced } = require('../lib/migration-notifier');

      showMigrationBannerForced({ newUrl: 'https://new.example.com', deadline: '2026-06-15' });

      const all = stderrSpy.mock.calls.flat().join('');
      expect(all).toContain('https://new.example.com');
      expect(all).toContain('2026-06-15');
    });

    it('does nothing when info is null', () => {
      const { showMigrationBannerForced } = require('../lib/migration-notifier');
      showMigrationBannerForced(null);
      expect(stderrSpy).not.toHaveBeenCalled();
    });

    it('updates throttle timestamp so subsequent maybeShow calls are throttled', () => {
      fs.readFileSync.mockImplementation(() => { throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); });
      fs.existsSync.mockReturnValue(true);
      let storedJson = null;
      fs.writeFileSync.mockImplementation((p, d) => { storedJson = d; });
      const { showMigrationBannerForced, maybeShowMigrationBanner } = require('../lib/migration-notifier');

      showMigrationBannerForced({ newUrl: 'https://new.example.com' });
      expect(stderrSpy).toHaveBeenCalled();
      expect(storedJson).toBeTruthy();

      // Now a "regular" call right after should be throttled.
      stderrSpy.mockClear();
      fs.readFileSync.mockReturnValue(storedJson);
      maybeShowMigrationBanner({ newUrl: 'https://new.example.com' });
      expect(stderrSpy).not.toHaveBeenCalled();
    });
  });

  describe('_validateUrl helper', () => {
    it('accepts http and https URLs', () => {
      const { _validateUrl } = require('../lib/migration-notifier');
      expect(_validateUrl('http://example.com')).toBeTruthy();
      expect(_validateUrl('https://example.com/path')).toBeTruthy();
    });

    it('rejects non-http(s) schemes and malformed URLs', () => {
      const { _validateUrl } = require('../lib/migration-notifier');
      expect(_validateUrl('ftp://example.com')).toBeNull();
      expect(_validateUrl('://broken')).toBeNull();
      expect(_validateUrl('not a url')).toBeNull();
      expect(_validateUrl('')).toBeNull();
    });
  });
});
