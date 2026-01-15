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

const { loadConfig, saveConfig, isConfigured, validateConfig, DEFAULT_CONFIG } = require('../lib/config');

describe('config', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadConfig', () => {
    it('should return default config when no config file exists', () => {
      fs.existsSync.mockReturnValue(false);
      
      const config = loadConfig();
      
      expect(config).toMatchObject({
        model: expect.any(String),
        logLevel: expect.any(String)
      });
    });

    it('should merge user config with defaults', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(JSON.stringify({
        repoPath: '/custom/repo',
        model: 'gpt-4'
      }));
      
      const config = loadConfig();
      
      expect(config.repoPath).toBe('/custom/repo');
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
  });
});
