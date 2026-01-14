/**
 * Tests for config.js
 */
const path = require('path');
const fs = require('fs');
const os = require('os');

// Mock os.homedir before requiring config
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock fs
jest.mock('fs');

const { loadConfig, saveConfig, isConfigured, DEFAULT_CONFIG } = require('../lib/config');

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
        issueBaseUrl: 'https://github.com/test/repo/issues'
      }));
      
      expect(isConfigured()).toBe(true);
    });
  });
});
