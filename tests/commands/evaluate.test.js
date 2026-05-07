/**
 * Tests for commands/evaluate.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

const { mockCreateAgentModule, mockRunTask, mockResetAgentMocks } = require('../helpers/mock-agent');
jest.mock('../../lib/agents', () => mockCreateAgentModule());

// Mock logger
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const { cmdEvaluate } = require('../../lib/commands/evaluate');
const { runTask } = require('../../lib/agents');
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
    
    mockResetAgentMocks();
    mockRunTask.mockResolvedValue({
      success: true,
      artifacts: { '/test/reports/issue-12345-evaluation.md': '# Evaluation' },
      warnings: [],
      git: { beforeHead: 'head1', afterHead: 'head1', commits: [], changedFiles: [] }
    });
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
      .rejects.toThrow('Prompt file not found');
  });

  it('should run AgentRunner with correct evaluation task contract', async () => {
    await cmdEvaluate('12345', {});
    
    expect(runTask).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        taskType: 'evaluation',
        prompt: expect.stringContaining('Issue #12345'),
        mcpProfile: 'evaluate',
        permissionProfile: 'noninteractive-full-auto',
        gitPolicy: { commitBehavior: 'forbid-commit' },
        expectedArtifacts: [expect.objectContaining({
          kind: 'file',
          path: '/test/reports/issue-12345-evaluation.md',
          failureMode: 'warn'
        })]
      })
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

    expect(runTask).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ silent: true, mcpProfile: 'evaluate' })
    );
  });

  it('should throw error when agent execution fails', async () => {
    mockRunTask.mockRejectedValue(new Error('Agent failed'));
    
    await expect(cmdEvaluate('12345', {}))
      .rejects.toThrow('Agent failed');
    
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Execution failed'));
  });

  it('should override config model when --model option is specified', async () => {
    await cmdEvaluate('12345', { model: 'claude-opus-4.5' });

    const configArg = runTask.mock.calls[0][0];
    expect(configArg.model).toBe('claude-opus-4.5');
  });

  it('should use config file model when --model option is not specified', async () => {
    await cmdEvaluate('12345', {});

    const configArg = runTask.mock.calls[0][0];
    expect(configArg.model).toBe('gpt-4');
  });
});
