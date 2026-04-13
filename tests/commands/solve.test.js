/**
 * Tests for commands/solve.js
 */
const fs = require('fs');
const { execSync, execFileSync } = require('child_process');

jest.mock('fs');
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn()
}));
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

// Mock service-client (Phase 3)
jest.mock('../../lib/service-client', () => ({
  serviceRequest: jest.fn().mockResolvedValue({ status: 200, data: [] }),
  getServiceUrl: jest.fn(() => ''),
  getServiceApiKey: jest.fn(() => ''),
}));

// Mock logger
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const { cmdSolve } = require('../../lib/commands/solve');
const { runCopilot } = require('../../lib/copilot');
const { cmdEvaluate } = require('../../lib/commands/evaluate');
const { success, error, info, debug } = require('../../lib/logger');

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

    execSync.mockImplementation((command) => {
      if (command.includes('git rev-parse HEAD')) {
        return 'aaa111\n';
      }
      if (command.includes('git status --porcelain')) {
        return '';
      }
      if (command.includes('git add -A')) {
        return '';
      }
      if (command.includes('git commit -m')) {
        return '[test-branch abc123] commit\n';
      }
      return '';
    });
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
      expect.objectContaining({ phase: 'phase1' })
    );
  });

  it('should throw error when Phase 1 prompt file is not found', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('PHASE1_RESEARCH_PROMPT.md')) return false;
      return true;
    });
    
    await expect(cmdSolve('12345', {}))
      .rejects.toThrow('Prompt file not found');
  });

  it('should throw error when research report is not generated', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('research.md')) return false;
      return true;
    });
    
    const promise = cmdSolve('12345', {});
    
    // Fast-forward past the new timeout (60 seconds)
    // With 1000ms poll interval, need to advance 60+ times
    for (let i = 0; i < 65; i++) {
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Allow pending promises to settle
    }
    
    await expect(promise).rejects.toThrow('Research report not generated');
  }, 70000); // Increased timeout for test itself

  it('should detect GUIDANCE issue type from research report', async () => {
    fs.existsSync.mockImplementation((path) => {
      // For Phase 2, check SOLUTION vs GUIDANCE prompt file paths
      // First check in root (__dirname/../../PHASE2_*), return false for SOLUTION  
      if (path.endsWith('PHASE2_SOLUTION_PROMPT.md')) return false;
      // Then check GUIDANCE in lib (__dirname/../PHASE2_*), return true
      if (path.includes('PHASE2_GUIDANCE_PROMPT.md')) return true;
      return true;
    });
    
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
        return '# Research Report\n\n**Type**: 📖 GUIDANCE';
      }
      if (path.includes('PHASE1_RESEARCH_PROMPT.md')) {
        return '# Phase 1';
      }
      if (path.includes('PHASE2_GUIDANCE_PROMPT.md')) {
        return '# Phase 2 Guidance';
      }
      if (path.includes('PHASE2_SOLUTION_PROMPT.md')) {
        return '# Phase 2 Solution';
      }
      return '';
    });
    
    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    // Should use GUIDANCE prompt (check second call which is Phase 2)
    const secondCall = runCopilot.mock.calls[1];
    expect(secondCall[0]).toContain('Phase 2 Guidance');
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

  it('should auto commit and run terraform review when tool is installed', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('code-review-committed-changes.prompt.md')) return true;
      return true;
    });

    let revParseCall = 0;
    execSync.mockImplementation((command) => {
      if (command.includes('git rev-parse HEAD')) {
        revParseCall += 1;
        // First call (before Phase 2) returns old HEAD, second call (after Phase 2) returns new HEAD
        return revParseCall === 1 ? 'aaa111\n' : 'bbb222\n';
      }
      if (command.includes('git status --porcelain')) {
        return '';
      }
      if (command.includes('git stash')) return '';
      if (command.includes('git add -A')) return '';
      if (command.includes('git commit')) return 'ok';
      return '';
    });

    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    expect(runCopilot).toHaveBeenCalledWith(
      expect.stringContaining('/code-review-committed-changes'),
      expect.any(Object),
      expect.objectContaining({ phase: 'phase2' })
    );
  });

  it('should auto-install review tool when installer script exists but tool not in repo', async () => {
    // Simulate: tool not in repo initially, installer script exists, tool in repo after install
    let installRan = false;
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('code-review-committed-changes.prompt.md')) return installRan;
      if (p.includes('code-review-local-changes.prompt.md')) return false;
      if (p.includes('code-review-committed-changes.chatmode.md')) return false;
      if (p.includes('install-copilot-setup.sh')) return true;
      return true;
    });

    let revParseCall = 0;
    execSync.mockImplementation((command) => {
      if (command.includes('git rev-parse HEAD')) {
        revParseCall += 1;
        return revParseCall === 1 ? 'aaa111\n' : 'bbb222\n';
      }
      if (command.includes('git status --porcelain')) return '';
      if (command.includes('git stash')) return '';
      if (command.includes('git add -A')) return '';
      if (command.includes('git commit')) return 'ok';
      return '';
    });

    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'bash' && args[0].includes('install-copilot-setup')) {
        installRan = true;
        return '';
      }
      return '';
    });

    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    // Verify installer was executed via execFileSync
    expect(execFileSync).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining([expect.stringContaining('install-copilot-setup.sh')]),
      expect.any(Object)
    );

    // Verify review was run after install
    expect(runCopilot).toHaveBeenCalledWith(
      expect.stringContaining('/code-review-committed-changes'),
      expect.any(Object),
      expect.objectContaining({ phase: 'phase2' })
    );
  });

  it('should auto-clone and install review tool when not present locally', async () => {
    let cloneRan = false;
    let installRan = false;
    fs.existsSync.mockImplementation((p) => {
      if (p.includes('code-review-committed-changes.prompt.md')) return installRan;
      if (p.includes('code-review-local-changes.prompt.md')) return false;
      if (p.includes('code-review-committed-changes.chatmode.md')) return false;
      if (p.includes('install-copilot-setup.sh')) return cloneRan;
      if (p.includes('install-copilot-setup.ps1')) return false;
      // Installer directory doesn't exist before clone
      if (p.includes('.terraform-azurerm-ai-installer') && !p.includes('install-copilot-setup')) return false;
      return true;
    });

    let revParseCall = 0;
    execSync.mockImplementation((command) => {
      if (command.includes('git rev-parse HEAD')) {
        revParseCall += 1;
        return revParseCall === 1 ? 'aaa111\n' : 'bbb222\n';
      }
      if (command.includes('git status --porcelain')) return '';
      if (command.includes('git stash')) return '';
      if (command.includes('git add -A')) return '';
      if (command.includes('git commit')) return 'ok';
      return '';
    });

    execFileSync.mockImplementation((cmd, args) => {
      if (cmd === 'git' && args[0] === 'clone') {
        cloneRan = true;
        return '';
      }
      if (cmd === 'bash' && args[0].includes('install-copilot-setup')) {
        installRan = true;
        return '';
      }
      return '';
    });

    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    // Verify clone was called with the hardcoded repo URL via execFileSync
    expect(execFileSync).toHaveBeenCalledWith(
      'git',
      expect.arrayContaining([
        'clone', '--depth', '1',
        'https://github.com/WodansSon/terraform-azurerm-ai-assisted-development.git'
      ]),
      expect.any(Object)
    );

    // Verify review was run
    expect(runCopilot).toHaveBeenCalledWith(
      expect.stringContaining('/code-review-committed-changes'),
      expect.any(Object),
      expect.objectContaining({ phase: 'phase2' })
    );
  });

  it('should use silent mode when silent option is true', async () => {
    const promise = cmdSolve('12345', { silent: true, noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(runCopilot).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      expect.objectContaining({ silent: true })
    );
  });

  it('should throw error when copilot execution fails', async () => {
    runCopilot.mockRejectedValue(new Error('Copilot failed'));
    
    await expect(cmdSolve('12345', {}))
      .rejects.toThrow('Copilot failed');
    
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Execution failed'));
  });

  it('should override config model when --model option is specified', async () => {
    const promise = cmdSolve('12345', { model: 'claude-opus-4.5', noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    // Both Phase 1 and Phase 2 calls should use the overridden model
    for (const call of runCopilot.mock.calls) {
      const configArg = call[1];
      expect(configArg.model).toBe('claude-opus-4.5');
    }
  });

  it('should use config file model when --model option is not specified', async () => {
    const promise = cmdSolve('12345', { noEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    for (const call of runCopilot.mock.calls) {
      const configArg = call[1];
      expect(configArg.model).toBe('gpt-4');
    }
  });
});
