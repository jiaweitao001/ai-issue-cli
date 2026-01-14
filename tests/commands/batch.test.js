/**
 * Tests for commands/batch.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock solve command
jest.mock('../../lib/commands/solve', () => ({
  cmdSolve: jest.fn()
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
    bold: { 
      cyan: jest.fn(s => s),
      grey: jest.fn(s => s)
    },
    cyan: jest.fn(s => s),
    green: jest.fn(s => s),
    red: jest.fn(s => s)
  }
}));

const { cmdBatch } = require('../../lib/commands/batch');
const { cmdSolve } = require('../../lib/commands/solve');
const { success, error, info, log } = require('../../lib/logger');

describe('commands/batch', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Default mock setup
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      reportPath: '/test/reports'
    }));
    fs.mkdirSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
    fs.appendFileSync.mockReturnValue(undefined);
    
    cmdSolve.mockResolvedValue(undefined);
  });

  it('should create log directory if it does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('logs')) return false;
      return true;
    });
    
    await cmdBatch(['12345'], { concurrency: 1 });
    
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('logs'),
      expect.objectContaining({ recursive: true })
    );
  });

  it('should process single issue', async () => {
    await cmdBatch(['12345'], { concurrency: 1 });
    
    expect(cmdSolve).toHaveBeenCalledWith('12345', expect.any(Object));
    expect(success).toHaveBeenCalled();
  });

  it('should process multiple issues sequentially with concurrency 1', async () => {
    await cmdBatch(['12345', '67890'], { concurrency: 1 });
    
    expect(cmdSolve).toHaveBeenCalledTimes(2);
    expect(cmdSolve).toHaveBeenCalledWith('12345', expect.any(Object));
    expect(cmdSolve).toHaveBeenCalledWith('67890', expect.any(Object));
  });

  it('should process multiple issues with default concurrency', async () => {
    await cmdBatch(['12345', '67890', '11111'], {});
    
    expect(cmdSolve).toHaveBeenCalledTimes(3);
  });

  it('should report failed issues', async () => {
    cmdSolve.mockRejectedValueOnce(new Error('Failed to solve'));
    cmdSolve.mockResolvedValueOnce(undefined);
    
    await cmdBatch(['12345', '67890'], { concurrency: 1 });
    
    expect(error).toHaveBeenCalled();
    expect(success).toHaveBeenCalled();
  });

  it('should continue processing after failure', async () => {
    cmdSolve.mockRejectedValueOnce(new Error('Failed'));
    cmdSolve.mockResolvedValueOnce(undefined);
    
    await cmdBatch(['12345', '67890'], { concurrency: 1 });
    
    expect(cmdSolve).toHaveBeenCalledTimes(2);
  });

  it('should write batch log file', async () => {
    await cmdBatch(['12345'], { concurrency: 1 });
    
    expect(fs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('batch-'),
      expect.any(String)
    );
  });

  it('should append progress to log file', async () => {
    await cmdBatch(['12345'], { concurrency: 1 });
    
    expect(fs.appendFileSync).toHaveBeenCalled();
  });

  it('should display final statistics', async () => {
    await cmdBatch(['12345', '67890'], { concurrency: 1 });
    
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Total'));
  });

  it('should pass options to cmdSolve', async () => {
    await cmdBatch(['12345'], { 
      concurrency: 1, 
      model: 'gpt-4',
      noEval: true 
    });
    
    expect(cmdSolve).toHaveBeenCalledWith('12345', expect.objectContaining({
      model: 'gpt-4',
      noEval: true,
      skipHeader: true,
      quiet: true,
      silent: true
    }));
  });

  it('should log failed issues with error details', async () => {
    cmdSolve.mockRejectedValue(new Error('Specific error message'));
    
    await cmdBatch(['12345'], { concurrency: 1 });
    
    expect(fs.appendFileSync).toHaveBeenCalledWith(
      expect.any(String),
      expect.stringContaining('Specific error message')
    );
  });
});
