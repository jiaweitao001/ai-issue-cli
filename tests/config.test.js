/**
 * Tests for config.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');

// Mock os.homedir before requiring config
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock fs
jest.mock('fs');

// Mock child_process
jest.mock('child_process');

const { loadConfig, saveConfig, isConfigured, validateConfig, DEFAULT_CONFIG, expandHome } = require('../lib/config');

describe('config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('expandHome', () => {
    it('expands home path forms and leaves other values unchanged', () => {
      expect(expandHome('~')).toBe('/mock/home');
      expect(expandHome('~/foo')).toBe('/mock/home/foo');
      expect(expandHome('/abs/path')).toBe('/abs/path');
      expect(expandHome('relative/path')).toBe('relative/path');
      expect(expandHome('')).toBe('');
      expect(expandHome(undefined)).toBeUndefined();
    });
  });

  describe('DEFAULT_CONFIG', () => {
    it('exposes knowledge base defaults', () => {
      expect(DEFAULT_CONFIG.knowledgeBasePath).toBe('');
      expect(DEFAULT_CONFIG.knowledgeBaseEnabled).toBe(true);
      expect(DEFAULT_CONFIG.knowledgeBaseAutoUpdate).toBe(false);
    });
  });

  describe('loadConfig', () => {
    it('should return default config when no config file exists', () => {
      fs.existsSync.mockReturnValue(false);
      
      const config = loadConfig();
      
      expect(config).toMatchObject({
        agent: 'copilot',
        model: expect.any(String),
        logLevel: expect.any(String)
      });
    });

    it('should merge user config with defaults', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '~/repo',
        reportPath: '~/reports',
        knowledgeBasePath: '~/kb',
        model: 'gpt-4'
      }));
      
      const config = loadConfig();
      
      expect(config.repoPath).toBe('/mock/home/repo');
      expect(config.reportPath).toBe('/mock/home/reports');
      expect(config.knowledgeBasePath).toBe('/mock/home/kb');
      expect(config.model).toBe('gpt-4');
      expect(config.logLevel).toBe(DEFAULT_CONFIG.logLevel);
    });

    it('should handle corrupted config file gracefully', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('invalid json {{{');
      
      const config = loadConfig();
      
      // Should return default config without crashing
      expect(config).toBeDefined();
    });
  });

  describe('saveConfig', () => {
    it('should create config directory if not exists', () => {
      fs.existsSync.mockReturnValue(false);
      fs.mkdirSync.mockReturnValue(undefined);
      fs.writeFileSync.mockReturnValue(undefined);
      
      saveConfig({ repoPath: '/test' });
      
      expect(fs.mkdirSync).toHaveBeenCalledWith(
        expect.stringContaining('.ai-issue'),
        { recursive: true }
      );
    });

    it('should write config as JSON', () => {
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      
      const testConfig = { repoPath: '/test', model: 'gpt-4' };
      saveConfig(testConfig);
      
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('config.json'),
        expect.stringContaining('"repoPath"')
      );
    });
  });

  describe('isConfigured', () => {
    it('should return false when config file does not exist', () => {
      fs.existsSync.mockReturnValue(false);
      
      expect(isConfigured()).toBe(false);
    });

    it('should return false when repoPath is not set', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '',
        issueBaseUrl: 'https://github.com/test/repo/issues'
      }));
      
      expect(isConfigured()).toBe(false);
    });

    it('should return true when properly configured', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports'
      }));
      fs.writeFileSync.mockReturnValue(undefined);
      fs.unlinkSync.mockReturnValue(undefined);
      execSync.mockReturnValue('');
      
      expect(isConfigured()).toBe(true);
    });
  });

  describe('validateConfig', () => {
    beforeEach(() => {
      fs.existsSync.mockReturnValue(true);
      fs.writeFileSync.mockReturnValue(undefined);
      fs.unlinkSync.mockReturnValue(undefined);
      execSync.mockReturnValue('');
    });

    it('should return error when repoPath is not set', () => {
      const config = { repoPath: '', issueBaseUrl: 'https://github.com/test/repo/issues' };
      
      const { valid, errors } = validateConfig(config);
      
      expect(valid).toBe(false);
      expect(errors).toContain('repoPath is not set');
    });

    it('should return error when repoPath does not exist', () => {
      fs.existsSync.mockImplementation((path) => {
        if (path.includes('reportPath')) return true;
        return false; // repoPath does not exist
      });
      
      const config = { repoPath: '/nonexistent/path', issueBaseUrl: 'https://github.com/test/repo/issues' };
      
      const { valid, errors } = validateConfig(config);
      
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('does not exist'))).toBe(true);
    });

    it('should return error when repoPath is not a git repository', () => {
      execSync.mockImplementation(() => {
        throw new Error('Not a git repository');
      });
      
      const config = { repoPath: '/valid/path', issueBaseUrl: 'https://github.com/test/repo/issues' };
      
      const { valid, errors } = validateConfig(config);
      
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('not a git repository'))).toBe(true);
    });

    it('should return error when issueBaseUrl is not set', () => {
      const config = { repoPath: '/valid/path', issueBaseUrl: '' };
      
      const { valid, errors } = validateConfig(config);
      
      expect(valid).toBe(false);
      expect(errors).toContain('issueBaseUrl is not set');
    });

    it('should return error when issueBaseUrl format is invalid', () => {
      const config = { 
        repoPath: '/valid/path', 
        issueBaseUrl: 'https://github.com/test/repo' // missing /issues
      };
      
      const { valid, errors } = validateConfig(config);
      
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('format invalid'))).toBe(true);
    });

    it('should return error when reportPath is not writable', () => {
      fs.writeFileSync.mockImplementation(() => {
        throw new Error('Permission denied');
      });
      
      const config = { 
        repoPath: '/valid/path', 
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/readonly/path'
      };
      
      const { valid, errors } = validateConfig(config);
      
      expect(valid).toBe(false);
      expect(errors.some(e => e.includes('not writable'))).toBe(true);
    });

    it('should return valid when all checks pass', () => {
      const config = { 
        repoPath: '/valid/path', 
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports'
      };
      
      const { valid, errors } = validateConfig(config);
       
      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('should return warnings without invalidating config when knowledgeBasePath is missing', () => {
      fs.existsSync.mockImplementation((p) => p !== '/missing/kb');

      const result = validateConfig({
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
        knowledgeBasePath: '/missing/kb',
        knowledgeBaseEnabled: true,
        knowledgeBaseAutoUpdate: false
      });

      expect(result).toEqual(expect.objectContaining({
        valid: true,
        errors: [],
        warnings: expect.arrayContaining([expect.stringContaining('knowledgeBasePath does not exist yet')])
      }));
    });

    it('should warn when knowledgeBasePath is missing manifest.json', () => {
      fs.existsSync.mockImplementation((p) => p !== '/valid/kb/manifest.json');
      fs.statSync.mockReturnValue({ isDirectory: () => true });

      const { valid, errors, warnings } = validateConfig({
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
        knowledgeBasePath: '/valid/kb',
        knowledgeBaseEnabled: true,
        knowledgeBaseAutoUpdate: false
      });

      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
      expect(warnings.some(w => w.includes('missing manifest.json'))).toBe(true);
    });

    it('should reject non-boolean knowledge base toggles', () => {
      const { valid, errors } = validateConfig({
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
        knowledgeBaseEnabled: 'true',
        knowledgeBaseAutoUpdate: 'false'
      });

      expect(valid).toBe(false);
      expect(errors).toEqual(expect.arrayContaining([
        'knowledgeBaseEnabled must be a boolean',
        'knowledgeBaseAutoUpdate must be a boolean'
      ]));
    });

    it('should accept missing agent as copilot for backward compatibility', () => {
      const config = {
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports'
      };

      const { valid, errors } = validateConfig(config);

      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('should accept claude-code as supported agent in 5B', () => {
      const config = {
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
        agent: 'claude-code'
      };

      const { valid, errors } = validateConfig(config);

      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('should return error when agent is unsupported', () => {
      const config = {
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
        agent: 'unknown'
      };

      const { valid, errors } = validateConfig(config);

      expect(valid).toBe(false);
      expect(errors).toContain('Unknown agent: unknown. Available agents: copilot, claude-code');
    });

    it('should validate rubberDuckAgent and per-agent model config', () => {
      const config = {
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
        rubberDuckAgent: 'claude-code',
        agents: {
          'claude-code': { model: 'sonnet' }
        }
      };

      const { valid, errors } = validateConfig(config);

      expect(valid).toBe(true);
      expect(errors).toHaveLength(0);
    });

    it('should reject invalid nested agents config', () => {
      const config = {
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
        rubberDuckAgent: 'unknown',
        agents: {
          unknown: { model: 'x' },
          copilot: { model: '' }
        }
      };

      const { valid, errors } = validateConfig(config);

      expect(valid).toBe(false);
      expect(errors).toEqual(expect.arrayContaining([
        'Unknown rubberDuckAgent: unknown. Available agents: copilot, claude-code',
        'Unknown agents.unknown. Available agents: copilot, claude-code',
        'agents.copilot.model must be a non-empty string'
      ]));
    });

    it('should create reportPath if it does not exist', () => {
      let reportPathCreated = false;
      
      fs.existsSync.mockImplementation((path) => {
        if (path === '/new/reports' && !reportPathCreated) {
          return false; // reportPath doesn't exist initially
        }
        return true;
      });
      
      fs.mkdirSync.mockImplementation(() => {
        reportPathCreated = true;
      });
      
      const config = { 
        repoPath: '/valid/path', 
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/new/reports'
      };
      
      validateConfig(config);
      
      expect(fs.mkdirSync).toHaveBeenCalledWith('/new/reports', { recursive: true });
    });

    describe('serviceUrl validation', () => {
      const baseConfig = {
        repoPath: '/valid/path',
        issueBaseUrl: 'https://github.com/test/repo/issues',
        reportPath: '/valid/reports',
      };

      it('should accept empty serviceUrl (service integration is optional)', () => {
        const { valid, errors } = validateConfig({ ...baseConfig, serviceUrl: '' });
        expect(valid).toBe(true);
        expect(errors).toHaveLength(0);
      });

      it('should accept origin-only https URL', () => {
        const { valid } = validateConfig({ ...baseConfig, serviceUrl: 'https://svc.example.com' });
        expect(valid).toBe(true);
      });

      it('should accept origin-only URL with trailing slash', () => {
        const { valid } = validateConfig({ ...baseConfig, serviceUrl: 'https://svc.example.com/' });
        expect(valid).toBe(true);
      });

      it('should accept localhost http URL with port', () => {
        const { valid } = validateConfig({ ...baseConfig, serviceUrl: 'http://localhost:8000' });
        expect(valid).toBe(true);
      });

      it('should reject URL with sub-path (origin-only invariant)', () => {
        const { valid, errors } = validateConfig({ ...baseConfig, serviceUrl: 'https://svc.example.com/api' });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('origin-only'))).toBe(true);
      });

      it('should reject URL with deeper sub-path', () => {
        const { valid, errors } = validateConfig({ ...baseConfig, serviceUrl: 'https://svc.example.com/api/v1' });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('origin-only'))).toBe(true);
      });

      it('should reject URL missing schema', () => {
        const { valid, errors } = validateConfig({ ...baseConfig, serviceUrl: 'svc.example.com' });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('not a valid URL') || e.includes('http://'))).toBe(true);
      });

      it('should reject non-http(s) schema', () => {
        const { valid, errors } = validateConfig({ ...baseConfig, serviceUrl: 'ftp://svc.example.com' });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('http://'))).toBe(true);
      });

      it('should reject completely invalid URL', () => {
        const { valid, errors } = validateConfig({ ...baseConfig, serviceUrl: '://not a url' });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('not a valid URL'))).toBe(true);
      });

      it('should reject URL with query string', () => {
        const { valid, errors } = validateConfig({ ...baseConfig, serviceUrl: 'https://svc.example.com?foo=bar' });
        expect(valid).toBe(false);
        expect(errors.some(e => e.includes('query/fragment'))).toBe(true);
      });
    });
  });
});
