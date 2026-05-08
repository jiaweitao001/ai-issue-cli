/**
 * Tests for lib/model-catalog.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home'),
}));

const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());

const catalog = require('../lib/model-catalog');
const { warning } = require('../lib/logger');

const BUILTIN_PATH = catalog._BUILTIN_PATH;
const USER_OVERRIDE_PATH = catalog._USER_OVERRIDE_PATH;

const SAMPLE_BUILTIN = {
  schemaVersion: 1,
  catalogVersion: '2026-04-29',
  recommended: 'claude-sonnet-4.6',
  models: [
    { id: 'claude-sonnet-4.6', vendor: 'Anthropic', tier: 'standard', tags: ['coding'] },
    { id: 'claude-sonnet-4.5', vendor: 'Anthropic', tier: 'standard', tags: ['coding'] },
    { id: 'gpt-5.4', vendor: 'OpenAI', tier: 'standard', tags: ['coding'] },
  ],
};

/**
 * Build an fs.readFileSync mock that returns the right body per path.
 * Throws ENOENT for paths that aren't in the map (mimicking fs).
 */
function mockFsRead(filesByPath) {
  fs.readFileSync.mockImplementation((p) => {
    if (Object.prototype.hasOwnProperty.call(filesByPath, p)) {
      return filesByPath[p];
    }
    const err = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  });
  fs.existsSync.mockImplementation((p) => Object.prototype.hasOwnProperty.call(filesByPath, p));
}

describe('model-catalog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    catalog._resetCache();
    catalog._resetWarned();
  });

  describe('loadCatalog', () => {
    it('loads the bundled catalog when no override exists', () => {
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN) });

      const c = catalog.loadCatalog();

      expect(c.recommended).toBe('claude-sonnet-4.6');
      expect(c.models.map((m) => m.id)).toEqual(['claude-sonnet-4.6', 'claude-sonnet-4.5', 'gpt-5.4']);
      expect(c.source.builtin).toBe(BUILTIN_PATH);
      expect(c.source.override).toBeNull();
    });

    it('caches across subsequent calls', () => {
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN) });

      catalog.loadCatalog();
      catalog.loadCatalog();
      catalog.loadCatalog();

      // existsSync may be called once for override probe; readFileSync once for builtin
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('merges user override: same id replaces in-place, new id appended at end', () => {
      const override = {
        schemaVersion: 1,
        models: [
          // override existing id (should NOT change list position)
          { id: 'claude-sonnet-4.5', vendor: 'Anthropic', tier: 'premium', tags: ['custom'] },
          // brand-new id (should append at end)
          { id: 'my-private-byok', vendor: 'Self', tier: 'fast', tags: ['byok'] },
        ],
      };
      mockFsRead({
        [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN),
        [USER_OVERRIDE_PATH]: JSON.stringify(override),
      });

      const c = catalog.loadCatalog();

      expect(c.models.map((m) => m.id)).toEqual([
        'claude-sonnet-4.6',
        'claude-sonnet-4.5',
        'gpt-5.4',
        'my-private-byok',
      ]);
      // overridden metadata replaces builtin
      const sonnet45 = c.models.find((m) => m.id === 'claude-sonnet-4.5');
      expect(sonnet45.tier).toBe('premium');
      expect(sonnet45.tags).toEqual(['custom']);
      expect(c.source.override).toBe(USER_OVERRIDE_PATH);
    });

    it('user override can supersede recommended', () => {
      const override = {
        schemaVersion: 1,
        recommended: 'gpt-5.4',
        models: [],
      };
      mockFsRead({
        [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN),
        [USER_OVERRIDE_PATH]: JSON.stringify(override),
      });

      expect(catalog.loadCatalog().recommended).toBe('gpt-5.4');
    });

    it('supports recommended models per agent', () => {
      const withAgentRecommended = {
        ...SAMPLE_BUILTIN,
        recommended: {
          copilot: 'claude-sonnet-4.6',
          'claude-code': 'sonnet'
        },
        models: [
          ...SAMPLE_BUILTIN.models,
          { id: 'sonnet', agent: 'claude-code', vendor: 'Anthropic' }
        ]
      };
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(withAgentRecommended) });

      const c = catalog.loadCatalog();

      expect(c.recommended).toBe('claude-sonnet-4.6');
      expect(c.recommendedByAgent['claude-code']).toBe('sonnet');
      expect(catalog.getRecommendedModel('claude-code')).toBe('sonnet');
    });

    it('merges override entries by agent and id', () => {
      const builtin = {
        ...SAMPLE_BUILTIN,
        models: [
          { id: 'shared', agent: 'copilot', tier: 'standard' },
          { id: 'shared', agent: 'claude-code', tier: 'standard' }
        ]
      };
      const override = {
        schemaVersion: 1,
        models: [
          { id: 'shared', agent: 'claude-code', tier: 'premium' }
        ]
      };
      mockFsRead({
        [BUILTIN_PATH]: JSON.stringify(builtin),
        [USER_OVERRIDE_PATH]: JSON.stringify(override),
      });

      const c = catalog.loadCatalog();

      expect(c.models).toHaveLength(2);
      expect(c.models.find(m => m.id === 'shared' && m.agent === 'copilot').tier).toBe('standard');
      expect(c.models.find(m => m.id === 'shared' && m.agent === 'claude-code').tier).toBe('premium');
    });

    it('falls back to builtin and warns when override JSON is corrupt', () => {
      mockFsRead({
        [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN),
        [USER_OVERRIDE_PATH]: '{not valid json',
      });

      const c = catalog.loadCatalog();

      expect(c.models).toHaveLength(3);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining(USER_OVERRIDE_PATH));
    });

    it('throws a clear error when builtin catalog is missing', () => {
      // existsSync returns false everywhere; readFileSync throws ENOENT
      fs.existsSync.mockReturnValue(false);
      fs.readFileSync.mockImplementation((p) => {
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      });

      expect(() => catalog.loadCatalog()).toThrow(/ENOENT/);
    });

    it('rejects builtin with unsupported schemaVersion', () => {
      const bad = { schemaVersion: 999, models: [] };
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(bad) });

      expect(() => catalog.loadCatalog()).toThrow(/invalid/i);
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('schemaVersion'));
    });

    it('skips override entries that lack a valid id', () => {
      const override = {
        schemaVersion: 1,
        models: [
          { vendor: 'Self' }, // no id
          { id: '', vendor: 'Self' }, // empty id
          { id: 'real-model', vendor: 'Self' },
        ],
      };
      mockFsRead({
        [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN),
        [USER_OVERRIDE_PATH]: JSON.stringify(override),
      });

      const c = catalog.loadCatalog();
      expect(c.models.map((m) => m.id)).toContain('real-model');
      expect(warning).toHaveBeenCalled();
    });
  });

  describe('isKnownModel', () => {
    beforeEach(() => {
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN) });
    });

    it('returns true for known ids', () => {
      expect(catalog.isKnownModel('claude-sonnet-4.5')).toBe(true);
      expect(catalog.isKnownModel('gpt-5.4')).toBe(true);
    });

    it('filters known ids by agent when requested', () => {
      const withClaude = {
        ...SAMPLE_BUILTIN,
        models: [
          ...SAMPLE_BUILTIN.models,
          { id: 'sonnet', agent: 'claude-code', vendor: 'Anthropic' }
        ]
      };
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(withClaude) });
      catalog._resetCache();

      expect(catalog.isKnownModel('sonnet', 'claude-code')).toBe(true);
      expect(catalog.isKnownModel('sonnet', 'copilot')).toBe(false);
    });

    it('returns false for unknown ids', () => {
      expect(catalog.isKnownModel('claude-sonet-4.5')).toBe(false);
      expect(catalog.isKnownModel('totally-made-up')).toBe(false);
    });

    it('handles non-string input gracefully', () => {
      expect(catalog.isKnownModel(undefined)).toBe(false);
      expect(catalog.isKnownModel(null)).toBe(false);
      expect(catalog.isKnownModel(42)).toBe(false);
    });
  });

  describe('suggestClosest', () => {
    beforeEach(() => {
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN) });
    });

    it('suggests the closest match for a typo', () => {
      expect(catalog.suggestClosest('claude-sonet-4.5')).toBe('claude-sonnet-4.5');
      expect(catalog.suggestClosest('Claude-Sonnet-4.5')).toBe('claude-sonnet-4.5');
    });

    it('returns null for ids too far from any known model', () => {
      expect(catalog.suggestClosest('completely-unrelated-model-xyz')).toBeNull();
    });

    it('returns null for empty / non-string', () => {
      expect(catalog.suggestClosest('')).toBeNull();
      expect(catalog.suggestClosest(undefined)).toBeNull();
    });
  });

  describe('validateAndWarnModelOnce', () => {
    beforeEach(() => {
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(SAMPLE_BUILTIN) });
    });

    it('does not warn for known model ids', () => {
      catalog.validateAndWarnModelOnce('claude-sonnet-4.5');
      expect(warning).not.toHaveBeenCalled();
    });

    it('does not warn for known model ids for the matching agent', () => {
      const withClaude = {
        ...SAMPLE_BUILTIN,
        models: [
          ...SAMPLE_BUILTIN.models,
          { id: 'sonnet', agent: 'claude-code', vendor: 'Anthropic' }
        ]
      };
      mockFsRead({ [BUILTIN_PATH]: JSON.stringify(withClaude) });
      catalog._resetCache();

      catalog.validateAndWarnModelOnce('sonnet', 'claude-code');

      expect(warning).not.toHaveBeenCalled();
    });

    it('warns once for an unknown model with suggestion', () => {
      catalog.validateAndWarnModelOnce('claude-sonet-4.5');
      expect(warning).toHaveBeenCalledTimes(1);
      const msg = warning.mock.calls[0][0];
      expect(msg).toContain('claude-sonet-4.5');
      expect(msg).toContain("Did you mean 'claude-sonnet-4.5'");
      expect(msg).toContain('BYOK');
    });

    it('warns once for unknown without suggestion (very different id)', () => {
      catalog.validateAndWarnModelOnce('zzz-no-match-zzz-zzz');
      expect(warning).toHaveBeenCalledTimes(1);
      expect(warning.mock.calls[0][0]).not.toContain('Did you mean');
    });

    it('dedups warnings for the same id over many calls', () => {
      for (let i = 0; i < 100; i++) {
        catalog.validateAndWarnModelOnce('claude-sonet-4.5');
      }
      expect(warning).toHaveBeenCalledTimes(1);
    });

    it('warns separately for different unknown ids', () => {
      catalog.validateAndWarnModelOnce('typo-one');
      catalog.validateAndWarnModelOnce('typo-two');
      expect(warning).toHaveBeenCalledTimes(2);
    });

    it('_resetWarned re-arms warnings for subsequent calls', () => {
      catalog.validateAndWarnModelOnce('typo-one');
      catalog._resetWarned();
      catalog.validateAndWarnModelOnce('typo-one');
      expect(warning).toHaveBeenCalledTimes(2);
    });

    it('ignores empty / non-string input silently', () => {
      catalog.validateAndWarnModelOnce('');
      catalog.validateAndWarnModelOnce(undefined);
      catalog.validateAndWarnModelOnce(null);
      expect(warning).not.toHaveBeenCalled();
    });
  });
});
