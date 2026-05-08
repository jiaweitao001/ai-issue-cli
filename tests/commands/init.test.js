/**
 * Tests for commands/init.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock logger
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const mockPromptInput = jest.fn();
jest.mock('../../lib/prompts', () => ({
  promptInput: mockPromptInput,
}));

const mockInstallKnowledgeBase = jest.fn();
jest.mock('../../lib/commands/kb', () => ({
  installKnowledgeBase: mockInstallKnowledgeBase,
}));

const { cmdInit } = require('../../lib/commands/init');
const { success, info, error } = require('../../lib/logger');

describe('commands/init', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPromptInput.mockResolvedValue('n');
    delete process.env.CI;
  });

  it('should skip initialization if config file already exists', async () => {
    fs.existsSync.mockReturnValue(true);
    
    await cmdInit();
    
    expect(info).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    expect(fs.writeFileSync).not.toHaveBeenCalled();
  });

  it('should create config file when it does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return false;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    
    await cmdInit();
    
    expect(fs.writeFileSync).toHaveBeenCalled();
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Initialization complete'));
  });

  it('should create report directory if it does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      if (path.includes('reports')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    
    await cmdInit();
    
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('reports'),
      expect.objectContaining({ recursive: true })
    );
  });

  it('should handle initialization errors gracefully', async () => {
    fs.existsSync.mockReturnValue(false);
    fs.writeFileSync.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    fs.mkdirSync.mockReturnValue(undefined);
    
    await cmdInit();
    
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize'));
  });

  it('should display instructions for next steps', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    
    await cmdInit();
    
    expect(info).toHaveBeenCalledWith(expect.stringContaining('repoPath'));
  });

  it('should skip KB prompt entirely in CI mode', async () => {
    process.env.CI = 'true';
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);

    await cmdInit();

    expect(mockPromptInput).not.toHaveBeenCalled();
    expect(mockInstallKnowledgeBase).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('CI mode'));
  });
});
