/**
 * Tests for commands/solve.js
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

// Mock evaluate command
jest.mock('../../lib/commands/evaluate', () => ({
  cmdEvaluate: jest.fn()
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
      blue: jest.fn(s => s),
      green: jest.fn(s => s),
      grey: jest.fn(s => s)
    },
    cyan: jest.fn(s => s),
    blue: jest.fn(s => s),
    green: jest.fn(s => s)
  }
}));

const { cmdSolve } = require('../../lib/commands/solve');
const { runCopilot } = require('../../lib/copilot');
const { cmdEvaluate } = require('../../lib/commands/evaluate');
const { success, error, info } = require('../../lib/logger');

describe('commands/solve', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    
    // Default mock setup
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockImplementation((path) => {
      if (path.includes('config.json')) {
        return JSON.stringify({
          repoPath: '/test/repo',
          reportPath: '/test/reports',
          issueBaseUrl: 'https://github.com/test/repo/issues',
          model: 'gpt-4',
          logLevel: 'info'
        });
      }
      if (path.includes('PHASE1_RESEARCH_PROMPT.md')) {
        return '# Phase 1 Research Prompt';
      }
      if (path.includes('PHASE2_SOLUTION_PROMPT.md')) {
        return '# Phase 2 Solution Prompt';
      }
      if (path.includes('PHASE2_GUIDANCE_PROMPT.md')) {
        return '# Phase 2 Guidance Prompt';
      }
      if (path.includes('research.md')) {
        return '# Research Report\n\n**类型**: 🔧 CODE_CHANGE';
      }
      return '';
    });
    fs.mkdirSync.mockReturnValue(undefined);
    fs.unlinkSync.mockReturnValue(undefined);
    fs.writeFileSync.mockReturnValue(undefined);
    
    runCopilot.mockResolvedValue(undefined);
    cmdEvaluate.mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should create report directory if it does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('reports') && !path.includes('.md')) return false;
      return true;
    });
    
    const promise = cmdSolve('12345', { noEval: true });
    
    // Fast-forward timers for waitForFile
    jest.advanceTimersByTime(1000);
    
    await promise;
    
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('reports'),
      expect.objectContaining({ recursive: true })
    );
  });

  it('should run Phase 1 research with correct prompt', async () => {
    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(runCopilot).toHaveBeenCalledWith(
      expect.stringContaining('Phase 1 Research'),
      expect.any(Object),
      expect.any(Array),
      expect.any(Boolean)
    );
  });

  it('should throw error when Phase 1 prompt file is not found', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('PHASE1_RESEARCH_PROMPT.md')) return false;
      return true;
    });
    
    await expect(cmdSolve('12345', {}))
      .rejects.toThrow('Phase 1 prompt file not found');
  });

  it('should throw error when research report is not generated', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('research.md')) return false;
      return true;
    });
    
    const promise = cmdSolve('12345', {});
    
    // Fast-forward past the timeout (10 seconds + buffer)
    for (let i = 0; i < 25; i++) {
      jest.advanceTimersByTime(500);
      await Promise.resolve(); // Allow pending promises to settle
    }
    
    await expect(promise).rejects.toThrow('Research report not generated');
  }, 15000);

  it('should detect GUIDANCE issue type from research report', async () => {
    fs.readFileSync.mockImplementation((path) => {
      if (path.includes('config.json')) {
        return JSON.stringify({
          repoPath: '/test/repo',
          reportPath: '/test/reports',
          issueBaseUrl: 'https://github.com/test/repo/issues',
          model: 'gpt-4',
          logLevel: 'info'
        });
      }
      if (path.includes('research.md')) {
        return '# Research Report\n\n**类型**: 📖 GUIDANCE';
      }
      if (path.includes('PHASE1_RESEARCH_PROMPT.md')) {
        return '# Phase 1';
      }
      if (path.includes('PHASE2_GUIDANCE_PROMPT.md')) {
        return '# Phase 2 Guidance';
      }
      return '';
    });
    
    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    // Should use GUIDANCE prompt
    expect(runCopilot).toHaveBeenCalledWith(
      expect.stringContaining('Phase 2 Guidance'),
      expect.any(Object),
      expect.any(Array),
      expect.any(Boolean)
    );
  });

  it('should clean up research file after Phase 2', async () => {
    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(fs.unlinkSync).toHaveBeenCalledWith(
      expect.stringContaining('research.md')
    );
  });

  it('should run evaluation by default', async () => {
    const promise = cmdSolve('12345', {});
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(cmdEvaluate).toHaveBeenCalledWith('12345', expect.any(Object));
  });

  it('should skip evaluation when noEval option is true', async () => {
    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(cmdEvaluate).not.toHaveBeenCalled();
  });

  it('should use silent mode when silent option is true', async () => {
    const promise = cmdSolve('12345', { silent: true, noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(runCopilot).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.any(Array),
      true
    );
  });

  it('should throw error when copilot execution fails', async () => {
    runCopilot.mockRejectedValue(new Error('Copilot failed'));
    
    await expect(cmdSolve('12345', {}))
      .rejects.toThrow('Copilot failed');
    
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Execution failed'));
  });
});
