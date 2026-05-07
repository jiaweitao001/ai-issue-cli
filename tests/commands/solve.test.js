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

// Mock AgentRunner for solve Phase 1/2
const { mockCreateAgentModule, mockRunTask, mockResetAgentMocks } = require('../helpers/mock-agent');
jest.mock('../../lib/agents', () => mockCreateAgentModule());

// Mock evaluate command
jest.mock('../../lib/commands/evaluate', () => ({
  cmdEvaluate: jest.fn()
}));

// Mock service-client (Phase 3)
jest.mock('../../lib/service-client', () => ({
  serviceRequest: jest.fn().mockResolvedValue({ status: 200, data: [] }),
  getServiceUrl: jest.fn(() => ''),
  getServiceApiKey: jest.fn(() => ''),
  updateSolutionSummary: jest.fn().mockResolvedValue({ status: 200, data: { ok: true } }),
}));

// Mock summary-extractor (Phase 6)
jest.mock('../../lib/summary-extractor', () => ({
  extractSolutionSummary: jest.fn(() => 'Extracted summary'),
}));

// Mock logger
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const { cmdSolve } = require('../../lib/commands/solve');
const { runTask } = require('../../lib/agents');
const { cmdEvaluate } = require('../../lib/commands/evaluate');
const { serviceRequest, getServiceUrl, updateSolutionSummary } = require('../../lib/service-client');
const { extractSolutionSummary } = require('../../lib/summary-extractor');
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
    
    mockResetAgentMocks();
    mockRunTask.mockImplementation(async (_config, request) => {
      const artifacts = {};
      for (const spec of request.expectedArtifacts || []) {
        artifacts[spec.path] = request.taskType === 'research'
          ? '# Research Report\n\n## Problem Classification\n\n**Type**: 🔧 CODE_CHANGE'
          : '# Analysis and Solution';
      }
      return {
        success: true,
        artifacts,
        git: { beforeHead: 'aaa111', afterHead: 'aaa111', commits: [], changedFiles: [] }
      };
    });
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
    
    const promise = cmdSolve('12345', { skipEval: true });
    
    // Fast-forward timers for waitForFile
    jest.advanceTimersByTime(1000);
    
    await promise;
    
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('reports'),
      expect.objectContaining({ recursive: true })
    );
  });

  it('should run Phase 1 research with correct prompt', async () => {
    const promise = cmdSolve('12345', { skipEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(runTask).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        taskType: 'research',
        prompt: expect.stringContaining('Phase 1 Research'),
        mcpProfile: 'phase1',
        permissionProfile: 'noninteractive-full-auto',
        gitPolicy: { commitBehavior: 'no-commit' },
        expectedArtifacts: expect.arrayContaining([
          expect.objectContaining({
            kind: 'file',
            path: expect.stringContaining('research.md'),
            failureMode: 'throw',
            requiredSection: /^## Problem Classification/m
          })
        ])
      })
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
    mockRunTask.mockRejectedValueOnce(new Error('Research report not generated at /test/reports/issue-12345-research.md after 60s timeout'));

    await expect(cmdSolve('12345', {})).rejects.toThrow('Research report not generated');
  });

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
      if (path.includes('PHASE1_RESEARCH_PROMPT.md')) return '# Phase 1';
      if (path.includes('PHASE2_GUIDANCE_PROMPT.md')) return '# Phase 2 Guidance';
      if (path.includes('PHASE2_SOLUTION_PROMPT.md')) return '# Phase 2 Solution';
      return '';
    });
    mockRunTask.mockImplementation(async (_config, request) => {
      const artifacts = {};
      for (const spec of request.expectedArtifacts || []) {
        artifacts[spec.path] = request.taskType === 'research'
          ? '# Research Report\n\n## Problem Classification\n\n**Type**: 📖 GUIDANCE'
          : '# Guidance Analysis';
      }
      return {
        success: true,
        artifacts,
        git: { beforeHead: 'aaa111', afterHead: 'aaa111', commits: [], changedFiles: [] }
      };
    });
    
    const promise = cmdSolve('12345', { skipEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    // Should use GUIDANCE prompt (check second call which is Phase 2)
    const secondCall = runTask.mock.calls[1];
    expect(secondCall[1].prompt).toContain('Phase 2 Guidance');
  });

  it('should clean up research file after Phase 2', async () => {
    const promise = cmdSolve('12345', { skipEval: true });
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

  it('should skip evaluation when skipEval option is true', async () => {
    const promise = cmdSolve('12345', { skipEval: true });
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

    const promise = cmdSolve('12345', { skipEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    expect(runTask).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        taskType: 'auto_review',
        prompt: expect.stringContaining('/code-review-committed-changes'),
        mcpProfile: 'phase2'
      })
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

    const promise = cmdSolve('12345', { skipEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    // Verify installer was executed via execFileSync
    expect(execFileSync).toHaveBeenCalledWith(
      'bash',
      expect.arrayContaining([expect.stringContaining('install-copilot-setup.sh')]),
      expect.any(Object)
    );

    // Verify review was run after install
    expect(runTask).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        taskType: 'auto_review',
        prompt: expect.stringContaining('/code-review-committed-changes'),
        mcpProfile: 'phase2'
      })
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

    const promise = cmdSolve('12345', { skipEval: true });
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
    expect(runTask).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        taskType: 'auto_review',
        prompt: expect.stringContaining('/code-review-committed-changes'),
        mcpProfile: 'phase2'
      })
    );
  });

  it('should use silent mode when silent option is true', async () => {
    const promise = cmdSolve('12345', { silent: true, skipEval: true });
    jest.advanceTimersByTime(1000);
    await promise;
    
    expect(runTask).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ silent: true })
    );
  });

  it('should throw error when agent execution fails', async () => {
    mockRunTask.mockRejectedValue(new Error('Agent failed'));
    
    await expect(cmdSolve('12345', {}))
      .rejects.toThrow('Agent failed');
    
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Execution failed'));
  });

  it('should override config model when --model option is specified', async () => {
    const promise = cmdSolve('12345', { model: 'claude-opus-4.5', skipEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    // Both Phase 1 and Phase 2 calls should use the overridden model
    for (const call of runTask.mock.calls) {
      const configArg = call[0];
      const requestArg = call[1];
      expect(configArg.model).toBe('claude-opus-4.5');
      expect(requestArg.model).toBe('claude-opus-4.5');
    }
  });

  it('should use config file model when --model option is not specified', async () => {
    const promise = cmdSolve('12345', { skipEval: true });
    jest.advanceTimersByTime(1000);
    await promise;

    for (const call of runTask.mock.calls) {
      const configArg = call[0];
      const requestArg = call[1];
      expect(configArg.model).toBe('gpt-4');
      expect(requestArg.model).toBe('gpt-4');
    }
  });

  describe('pipeline status reporting', () => {
    it('should report solving status before Phase 1 when service URL is set', async () => {
      getServiceUrl.mockReturnValue('http://localhost:8000');

      const promise = cmdSolve('12345', { skipEval: true });
      jest.advanceTimersByTime(1000);
      await promise;

      // serviceRequest should have been called with /solving endpoint
      const solvingCalls = serviceRequest.mock.calls.filter(
        call => call[0] === 'POST' && call[1].includes('/solving')
      );
      expect(solvingCalls).toHaveLength(1);
      expect(solvingCalls[0][1]).toBe('/pipeline/test/repo/12345/solving');
    });

    it('should report solving before solved in call order', async () => {
      getServiceUrl.mockReturnValue('http://localhost:8000');

      const promise = cmdSolve('12345', { skipEval: true });
      jest.advanceTimersByTime(1000);
      await promise;

      const postCalls = serviceRequest.mock.calls
        .filter(call => call[0] === 'POST')
        .map(call => call[1]);

      const solvingIdx = postCalls.findIndex(url => url.includes('/solving'));
      const solvedIdx = postCalls.findIndex(url => url.includes('/solved'));

      expect(solvingIdx).toBeGreaterThanOrEqual(0);
      expect(solvedIdx).toBeGreaterThanOrEqual(0);
      expect(solvingIdx).toBeLessThan(solvedIdx);
    });

    it('should not report solving when service URL is empty', async () => {
      getServiceUrl.mockReturnValue('');

      const promise = cmdSolve('12345', { skipEval: true });
      jest.advanceTimersByTime(1000);
      await promise;

      const solvingCalls = serviceRequest.mock.calls.filter(
        call => call[0] === 'POST' && call[1].includes('/solving')
      );
      expect(solvingCalls).toHaveLength(0);
    });

    it('should not block solve when solving status report fails', async () => {
      getServiceUrl.mockReturnValue('http://localhost:8000');
      serviceRequest.mockImplementation((method, url) => {
        if (url.includes('/solving')) {
          return Promise.reject(new Error('Network error'));
        }
        return Promise.resolve({ status: 200, data: [] });
      });

      const promise = cmdSolve('12345', { skipEval: true });
      jest.advanceTimersByTime(1000);
      await promise;

      // Solve should still complete — Phase 1 and Phase 2 ran
      expect(runTask).toHaveBeenCalledTimes(2);
    });

    it('should report solved status after Phase 2 when service URL is set', async () => {
      getServiceUrl.mockReturnValue('http://localhost:8000');

      const promise = cmdSolve('12345', { skipEval: true });
      jest.advanceTimersByTime(1000);
      await promise;

      const solvedCalls = serviceRequest.mock.calls.filter(
        call => call[0] === 'POST' && call[1].includes('/solved')
      );
      expect(solvedCalls).toHaveLength(1);
      expect(solvedCalls[0][2]).toEqual(expect.objectContaining({
        branch: '',
        solved_by: expect.any(String),
      }));
    });

    it('should report failed status when solve throws', async () => {
      getServiceUrl.mockReturnValue('http://localhost:8000');
      mockRunTask.mockRejectedValueOnce(new Error('Phase 1 crash'));

      await expect(cmdSolve('12345', {})).rejects.toThrow('Phase 1 crash');

      const failedCalls = serviceRequest.mock.calls.filter(
        call => call[0] === 'POST' && call[1].includes('/failed')
      );
      expect(failedCalls).toHaveLength(1);
    });
  });

  describe('solution summary upload', () => {
    beforeEach(() => {
      getServiceUrl.mockReturnValue('https://service.example.com');
    });

    it('should upload solution summary when serviceUrl is configured', async () => {
      await cmdSolve('12345', { skipEval: true });

      expect(extractSolutionSummary).toHaveBeenCalled();
      expect(updateSolutionSummary).toHaveBeenCalled();
    });

    it('should not upload summary when serviceUrl is not configured', async () => {
      getServiceUrl.mockReturnValue('');

      await cmdSolve('12345', { skipEval: true });

      expect(updateSolutionSummary).not.toHaveBeenCalled();
    });

    it('should not crash when summary upload fails', async () => {
      updateSolutionSummary.mockRejectedValue(new Error('Network error'));

      await expect(cmdSolve('12345', { skipEval: true })).resolves.toBeUndefined();
    });
  });

  describe('--skip-eval flag (B-23-01 regression)', () => {
    it('should skip evaluation when skipEval is true', async () => {
      const promise = cmdSolve('12345', { skipEval: true });
      jest.advanceTimersByTime(1000);
      await promise;

      expect(cmdEvaluate).not.toHaveBeenCalled();
    });

    it('should run evaluation when skipEval is false', async () => {
      const promise = cmdSolve('12345', { skipEval: false });
      jest.advanceTimersByTime(1000);
      await promise;

      expect(cmdEvaluate).toHaveBeenCalledWith('12345', expect.any(Object));
    });

    it('should run evaluation when skipEval is absent', async () => {
      const promise = cmdSolve('12345', {});
      jest.advanceTimersByTime(1000);
      await promise;

      expect(cmdEvaluate).toHaveBeenCalledWith('12345', expect.any(Object));
    });

    it('should NOT skip evaluation when old noEval key is used (regression)', async () => {
      const promise = cmdSolve('12345', { noEval: true });
      jest.advanceTimersByTime(1000);
      await promise;

      // noEval is no longer recognized, so evaluation should still run
      expect(cmdEvaluate).toHaveBeenCalledWith('12345', expect.any(Object));
    });
  });
});
