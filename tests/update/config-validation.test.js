/**
 * Tests for config-cmd validation logic added in UPDATE_COMMAND_PROPOSAL.md v3.4 §4.7.
 *
 * Two layers of validation:
 *   1) key whitelist (ALLOWED_CONFIG_KEYS = Object.keys(DEFAULT_CONFIG))
 *      -> typo'd keys like `updateChnnel` get rejected
 *   2) value enum (ENUM_VALUES.updateChannel)
 *      -> non-enum values like `xyz` get rejected
 *
 * The whole point of layer 1 is that v3.3's value-only validation could not
 * catch typo'd keys (`config[key] = value` would silently accept anything).
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock logger to suppress output (CLAUDE.md§Testing Patterns).
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const { cmdConfig, validateConfigSet, ALLOWED_CONFIG_KEYS, ENUM_VALUES } =
  require('../../lib/commands/config-cmd');
const { error, success } = require('../../lib/logger');
const { DEFAULT_CONFIG } = require('../../lib/config');

describe('config-cmd v3.4 validation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo'
    }));
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    process.exit.mockRestore();
  });

  describe('ALLOWED_CONFIG_KEYS', () => {
    it('contains updateChannel (added in v3.3)', () => {
      expect(ALLOWED_CONFIG_KEYS).toContain('updateChannel');
    });

    it('mirrors Object.keys(DEFAULT_CONFIG) so new defaults are auto-allowed', () => {
      expect([...ALLOWED_CONFIG_KEYS].sort()).toEqual([...Object.keys(DEFAULT_CONFIG)].sort());
    });

    it('contains existing settable keys (regression)', () => {
      ['repoPath', 'reportPath', 'model', 'logLevel', 'issueBaseUrl'].forEach(k => {
        expect(ALLOWED_CONFIG_KEYS).toContain(k);
      });
    });
  });

  describe('ENUM_VALUES.updateChannel', () => {
    it('exposes the three accepted channel values', () => {
      expect([...ENUM_VALUES.updateChannel].sort()).toEqual(['auto', 'branch', 'tag']);
    });

    it('preserves declaration order auto/tag/branch (used in error messages)', () => {
      expect(ENUM_VALUES.updateChannel).toEqual(['auto', 'tag', 'branch']);
    });
  });

  describe('validateConfigSet (pure function)', () => {
    it('accepts every allowed key with arbitrary value when no enum is defined', () => {
      expect(() => validateConfigSet('repoPath', '/anything')).not.toThrow();
      expect(() => validateConfigSet('model', 'totally-made-up-model')).not.toThrow();
    });

    it('rejects unknown keys with a message listing allowed keys', () => {
      expect(() => validateConfigSet('updateChnnel', 'branch')).toThrow(/Unknown config key/);
      expect(() => validateConfigSet('updateChnnel', 'branch')).toThrow(/updateChannel/);
    });

    it('rejects empty key', () => {
      expect(() => validateConfigSet('', 'value')).toThrow(/Unknown config key/);
    });

    it('accepts every enum value for updateChannel', () => {
      ['auto', 'tag', 'branch'].forEach(v => {
        expect(() => validateConfigSet('updateChannel', v)).not.toThrow();
      });
    });

    it('rejects out-of-enum values for updateChannel', () => {
      expect(() => validateConfigSet('updateChannel', 'xyz')).toThrow(/Invalid updateChannel/);
      expect(() => validateConfigSet('updateChannel', 'xyz')).toThrow(/auto, tag, branch/);
    });

    it('is case-sensitive on enum values (TAG != tag)', () => {
      expect(() => validateConfigSet('updateChannel', 'TAG')).toThrow(/Invalid updateChannel/);
    });

    it('accepts typed verifyLoop dotted keys', () => {
      expect(() => validateConfigSet('verifyLoop.enabled', 'true')).not.toThrow();
      expect(() => validateConfigSet('verifyLoop.maxAttempts', '2')).not.toThrow();
      expect(() => validateConfigSet('verifyLoop.phaseATimeoutSec', '120')).not.toThrow();
      expect(() => validateConfigSet('verifyLoop.phaseBTimeoutSec', '900')).not.toThrow();
      expect(() => validateConfigSet('verifyLoop.parallelism', 'auto')).not.toThrow();
      expect(() => validateConfigSet('verifyLoop.parallelism', '4')).not.toThrow();
      expect(() => validateConfigSet('verifyLoop.skipGates', 'website-lint,unit-test')).not.toThrow();
      expect(() => validateConfigSet('verifyLoop.skipGates', '["website-lint"]')).not.toThrow();
    });

    it('rejects invalid verifyLoop dotted values', () => {
      expect(() => validateConfigSet('verifyLoop.enabled', 'yes')).toThrow(/true.*false/);
      expect(() => validateConfigSet('verifyLoop.maxAttempts', '0')).toThrow(/positive integer/);
      expect(() => validateConfigSet('verifyLoop.parallelism', 'fast')).toThrow(/auto.*positive integer/);
      expect(() => validateConfigSet('verifyLoop.skipGates', '[1]')).toThrow(/array/);
      expect(() => validateConfigSet('verifyLoop.unknown', 'x')).toThrow(/Unknown verifyLoop key/);
      expect(() => validateConfigSet('verifyLoop', '{}')).toThrow(/verifyLoop\.<key>/);
    });
  });

  describe('cmdConfig set integration', () => {
    it('writes valid updateChannel values', () => {
      cmdConfig('set', 'updateChannel', 'tag');
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });

    it('coerces verifyLoop dotted values before writing config', () => {
      cmdConfig('set', 'verifyLoop.maxAttempts', '2');

      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.verifyLoop.maxAttempts).toBe(2);
    });

    it('coerces verifyLoop skipGates comma list before writing config', () => {
      cmdConfig('set', 'verifyLoop.skipGates', 'website-lint,unit-test');

      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.verifyLoop.skipGates).toEqual(['website-lint', 'unit-test']);
    });

    it('exits with code 2 on typo key (not silently accepted)', () => {
      expect(() => cmdConfig('set', 'updateChnnel', 'branch'))
        .toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown config key'));
      expect(process.exit).toHaveBeenCalledWith(2);
      // Critical: nothing should be written when validation fails.
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('exits with code 2 on invalid updateChannel value', () => {
      expect(() => cmdConfig('set', 'updateChannel', 'xyz'))
        .toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid updateChannel'));
      expect(process.exit).toHaveBeenCalledWith(2);
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('error message lists all allowed channel values for discoverability', () => {
      expect(() => cmdConfig('set', 'updateChannel', 'production'))
        .toThrow('process.exit called');
      const messages = error.mock.calls.map(c => c[0]).join(' ');
      expect(messages).toMatch(/auto/);
      expect(messages).toMatch(/tag/);
      expect(messages).toMatch(/branch/);
    });
  });

  describe('cmdConfig get behavior for new field', () => {
    it('returns "auto" when updateChannel is unset (DEFAULT_CONFIG fallback)', () => {
      // loadConfig() merges DEFAULT_CONFIG so the get path picks up 'auto'.
      // Mock a config file that does NOT have updateChannel.
      fs.readFileSync.mockReturnValue(JSON.stringify({ repoPath: '/test/repo' }));
      const { log } = require('../../lib/logger');
      cmdConfig('get', 'updateChannel');
      expect(log).toHaveBeenCalledWith('auto');
    });

    it('returns explicitly set value when present', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '/test/repo',
        updateChannel: 'tag'
      }));
      const { log } = require('../../lib/logger');
      cmdConfig('get', 'updateChannel');
      expect(log).toHaveBeenCalledWith('tag');
    });
  });

  describe('cmdConfig reset behavior', () => {
    it('writes DEFAULT_CONFIG which includes updateChannel=auto', () => {
      cmdConfig('reset');
      expect(fs.writeFileSync).toHaveBeenCalled();
      const written = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(written);
      expect(parsed.updateChannel).toBe('auto');
    });
  });
});
