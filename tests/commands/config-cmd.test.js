/**
 * Tests for commands/config-cmd.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock logger to suppress output
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const { cmdConfig } = require('../../lib/commands/config-cmd');
const { log, error, success, info } = require('../../lib/logger');

describe('commands/config-cmd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      model: 'gpt-4'
    }));
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    
    // Mock process.exit
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    process.exit.mockRestore();
  });

  describe('show action', () => {
    it('should display current configuration', () => {
      cmdConfig('show');
      
      expect(log).toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Config file'));
    });
  });

  describe('set action', () => {
    it('should set a configuration value', () => {
      cmdConfig('set', 'repoPath', '/new/path');
      
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(success).toHaveBeenCalled();
    });

    it('should set a dotted per-agent model value', () => {
      cmdConfig('set', 'agents.claude-code.model', 'sonnet');

      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.agents['claude-code'].model).toBe('sonnet');
    });

    it('should reject dotted per-agent model for unknown agents', () => {
      expect(() => cmdConfig('set', 'agents.unknown.model', 'x')).toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown agent'));
    });

    it('should exit with error when key is missing', () => {
      expect(() => cmdConfig('set')).toThrow('process.exit called');
      expect(error).toHaveBeenCalled();
    });

    it('should exit with error when value is missing', () => {
      expect(() => cmdConfig('set', 'repoPath')).toThrow('process.exit called');
      expect(error).toHaveBeenCalled();
    });

    it('should warn when setting model to an unknown id', () => {
      const modelCatalog = require('../../lib/model-catalog');
      modelCatalog._resetCache();
      modelCatalog._resetWarned();
      // catalog read returns a valid catalog so validator can compare against it
      fs.readFileSync.mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith('models.json')) {
          return JSON.stringify({
            schemaVersion: 1,
            recommended: 'claude-sonnet-4.6',
            models: [{ id: 'claude-sonnet-4.6', vendor: 'Anthropic' }],
          });
        }
        return JSON.stringify({ model: 'gpt-4' });
      });
      fs.existsSync.mockImplementation((p) => {
        if (typeof p === 'string' && p.endsWith(`${require('path').sep}models.json`)) {
          return p.includes('lib') === false; // built-in path under data/, not the override
        }
        return true;
      });

      const { warning } = require('../../lib/logger');
      cmdConfig('set', 'model', 'totally-bogus-model-id');
      expect(warning).toHaveBeenCalledWith(
        expect.stringContaining('totally-bogus-model-id')
      );
    });

    it('should NOT warn when setting non-model keys', () => {
      const modelCatalog = require('../../lib/model-catalog');
      modelCatalog._resetCache();
      modelCatalog._resetWarned();
      const { warning } = require('../../lib/logger');
      cmdConfig('set', 'repoPath', '/some/path');
      expect(warning).not.toHaveBeenCalled();
    });

    it('should coerce skillsMetricsEnabled "true" to native boolean true', () => {
      cmdConfig('set', 'skillsMetricsEnabled', 'true');
      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.skillsMetricsEnabled).toBe(true);
    });

    it('should coerce skillsMetricsEnabled "false" to native boolean false', () => {
      cmdConfig('set', 'skillsMetricsEnabled', 'false');
      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.skillsMetricsEnabled).toBe(false);
    });

    it('should reject skillsMetricsEnabled with a non-boolean string', () => {
      expect(() => cmdConfig('set', 'skillsMetricsEnabled', 'yes')).toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('must be "true" or "false"'));
    });

    it('should accept skillsMetricsPath as a plain string', () => {
      cmdConfig('set', 'skillsMetricsPath', '/custom/metrics.jsonl');
      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.skillsMetricsPath).toBe('/custom/metrics.jsonl');
    });

    // TUI proposal §5.2 PR-0 (v1.1 N8): uiMode reuses the existing v3.4
    // ENUM_VALUES framework. Tests live here (not a new file) per N8.
    it('should accept uiMode "auto"', () => {
      cmdConfig('set', 'uiMode', 'auto');
      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.uiMode).toBe('auto');
    });

    it('should accept uiMode "plain"', () => {
      cmdConfig('set', 'uiMode', 'plain');
      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.uiMode).toBe('plain');
    });

    it('should accept uiMode "tui"', () => {
      cmdConfig('set', 'uiMode', 'tui');
      const saved = JSON.parse(fs.writeFileSync.mock.calls[0][1]);
      expect(saved.uiMode).toBe('tui');
    });

    it('should reject invalid uiMode (case-sensitive enum)', () => {
      expect(() => cmdConfig('set', 'uiMode', 'TUI')).toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid uiMode'));
    });

    it('should reject unknown uiMode value', () => {
      expect(() => cmdConfig('set', 'uiMode', 'fancy')).toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid uiMode'));
    });
  });

  describe('get action', () => {
    it('should get a configuration value', () => {
      cmdConfig('get', 'repoPath');
      
      expect(log).toHaveBeenCalledWith('/test/repo');
    });

    it('should get a dotted configuration value', () => {
      fs.readFileSync.mockReturnValue(JSON.stringify({
        agents: { 'claude-code': { model: 'sonnet' } }
      }));

      cmdConfig('get', 'agents.claude-code.model');

      expect(log).toHaveBeenCalledWith('sonnet');
    });

    it('should return empty string for non-existent key', () => {
      cmdConfig('get', 'nonExistent');
      
      expect(log).toHaveBeenCalledWith('');
    });

    it('should exit with error when key is missing', () => {
      expect(() => cmdConfig('get')).toThrow('process.exit called');
      expect(error).toHaveBeenCalled();
    });
  });

  describe('reset action', () => {
    it('should reset configuration to defaults', () => {
      cmdConfig('reset');
      
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(success).toHaveBeenCalledWith(expect.stringContaining('reset'));
    });
  });

  describe('unknown action', () => {
    it('should exit with error for unknown action', () => {
      expect(() => cmdConfig('unknown')).toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown action'));
    });
  });
});
