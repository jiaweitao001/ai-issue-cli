/**
 * Tests for commands/check.js
 */
const { execSync } = require('child_process');
const fs = require('fs');

jest.mock('child_process');
jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock logger
jest.mock('../../lib/logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  highlight: jest.fn(s => s),
  chalk: {
    bold: { cyan: jest.fn(s => s) },
    cyan: jest.fn(s => s),
    grey: jest.fn(s => s)
  }
}));

const { cmdCheck } = require('../../lib/commands/check');
const { log, error, success, warning } = require('../../lib/logger');

describe('commands/check', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock process.exit
    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    process.exit.mockRestore();
  });

  it('should pass all checks when environment is properly configured', () => {
    execSync.mockReturnValue('1.0.0');
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      reportPath: '/test/reports'
    }));
    
    cmdCheck();
    
    expect(success).toHaveBeenCalledWith(expect.stringContaining('All checks passed'));
  });

  it('should fail when Copilot CLI is not installed', () => {
    execSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      reportPath: '/test/reports'
    }));
    
    expect(() => cmdCheck()).toThrow('process.exit called');
    expect(error).toHaveBeenCalled();
  });

  it('should fail when repository path does not exist', () => {
    execSync.mockReturnValue('1.0.0');
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('repo')) return false;
      return true;
    });
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      reportPath: '/test/reports'
    }));
    
    expect(() => cmdCheck()).toThrow('process.exit called');
  });

  it('should display help messages for failed checks', () => {
    execSync.mockImplementation(() => {
      throw new Error('command not found');
    });
    fs.existsSync.mockReturnValue(false);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '',
      reportPath: ''
    }));
    
    expect(() => cmdCheck()).toThrow('process.exit called');
    expect(warning).toHaveBeenCalled();
  });
});
