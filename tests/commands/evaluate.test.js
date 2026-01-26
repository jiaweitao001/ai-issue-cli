/**
 * Tests for commands/evaluate.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock copilot
jest.mock('../../lib/copilot', () => ({
  runCopilot: jest.fn()
}));

// Mock logger
jest.mock('../../lib/logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  highlight: jest.fn(s => s),
  chalk: {
    bold: jest.fn(s => s),
    green: jest.fn(s => s)
  }
}));

const { cmdEvaluate } = require('../../lib/commands/evaluate');
const { runCopilot } = require('../../lib/copilot');
const { success, error, warning, info } = require('../../lib/logger');

describe('commands/evaluate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock: config file exists with valid config
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((path) => {
      if (path.includes('config.json')) {
        return JSON.stringify({
          repoPath: '/test/repo',
          reportPath: '/test/reports',
          model: 'gpt-4',
          logLevel: 'info'
        });
      }
      if (path.includes('analysis-and-solution.md')) {
        return '# Solution Report\n\nSolution content here';
      }
      if (path.includes('MANUAL_EVALUATION_PROMPT.md')) {
        return '# Evaluation Prompt\n\nEvaluate the solution';
      }
      return '';
    });
    
    runCopilot.mockResolvedValue(undefined);
  });

  it('should throw error when analysis file does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('analysis-and-solution.md')) return false;
      return true;
    });
    
    await expect(cmdEvaluate('12345', {}))
      .rejects.toThrow('Analysis and solution report does not exist');
  });

  it('should throw error when evaluation prompt file does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('MANUAL_EVALUATION_PROMPT.md')) return false;
      return true;
    });
    
    await expect(cmdEvaluate('12345', {}))
      .rejects.toThrow('Evaluation prompt file not found');
  });

  it('should run copilot with correct prompt', async () => {
    await cmdEvaluate('12345', {});
    
    expect(runCopilot).toHaveBeenCalledWith(
      expect.stringContaining('Issue #12345'),
      expect.any(Object),
      expect.any(Array),
      expect.any(Boolean),
      expect.any(Boolean) // debugMode
    );
  });

  it('should report success when evaluation file is generated', async () => {
    await cmdEvaluate('12345', {});
    
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Evaluation report generated'));
  });

  it('should warn when evaluation file is not generated', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('evaluation.md')) return false;
      return true;
    });
    
    await cmdEvaluate('12345', {});
    
    expect(warning).toHaveBeenCalled();
  });

  it('should skip header when skipHeader option is true', async () => {
    const { log } = require('../../lib/logger');
    
    await cmdEvaluate('12345', { skipHeader: true });
    
    // Should not log the header
    expect(log).not.toHaveBeenCalledWith(expect.stringContaining('Phase 3: Evaluate'));
  });

  it('should use silent mode when silent option is true', async () => {
    await cmdEvaluate('12345', { silent: true });
    
    expect(runCopilot).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Array),
      true, // silent mode
      expect.any(Boolean) // debugMode
    );
  });

  it('should throw error when copilot execution fails', async () => {
    runCopilot.mockRejectedValue(new Error('Copilot failed'));
    
    await expect(cmdEvaluate('12345', {}))
      .rejects.toThrow('Copilot failed');
    
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Execution failed'));
  });
});
