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
jest.mock('../../lib/logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  highlight: jest.fn(s => s),
  chalk: {
    bold: { cyan: jest.fn(s => s) },
    cyan: jest.fn(s => s)
  }
}));

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

    it('should exit with error when key is missing', () => {
      expect(() => cmdConfig('set')).toThrow('process.exit called');
      expect(error).toHaveBeenCalled();
    });

    it('should exit with error when value is missing', () => {
      expect(() => cmdConfig('set', 'repoPath')).toThrow('process.exit called');
      expect(error).toHaveBeenCalled();
    });
  });

  describe('get action', () => {
    it('should get a configuration value', () => {
      cmdConfig('get', 'repoPath');
      
      expect(log).toHaveBeenCalledWith('/test/repo');
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
