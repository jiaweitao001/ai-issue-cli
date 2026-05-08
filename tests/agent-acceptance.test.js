const fs = require('fs');

jest.mock('fs');

const {
  parseArgs,
  validateArgs,
  buildSolveCommand,
  renderMarkdown,
  main,
} = require('../scripts/agent-acceptance');

describe('agent acceptance harness', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('parses issue and agent lists', () => {
    expect(parseArgs(['--issues', '1,2,3,4,5', '--agents', 'copilot,claude-code'])).toEqual({
      issues: ['1', '2', '3', '4', '5'],
      agents: ['copilot', 'claude-code'],
      output: null,
      skipEval: false,
      branch: false,
      allowPartial: false,
      help: false,
    });
  });

  it('requires exactly five issues unless allowPartial is set', () => {
    expect(() => validateArgs({
      issues: ['1'],
      agents: ['claude-code'],
      skipEval: false,
      branch: false,
      allowPartial: false,
    })).toThrow('exactly five issues');

    expect(() => validateArgs({
      issues: ['1'],
      agents: ['claude-code'],
      skipEval: false,
      branch: false,
      allowPartial: true,
    })).not.toThrow();
  });

  it('builds solve commands with run-scoped agent overrides', () => {
    expect(buildSolveCommand('123', 'claude-code', { skipEval: true, branch: true }))
      .toBe('ai-issue --skip-eval solve 123 --agent claude-code --branch');
  });

  it('renders a markdown command matrix and result template', () => {
    const markdown = renderMarkdown({
      issues: ['1', '2', '3', '4', '5'],
      agents: ['copilot', 'claude-code'],
      skipEval: false,
      branch: false,
    });

    expect(markdown).toContain('ai-issue solve 1 --agent copilot');
    expect(markdown).toContain('ai-issue solve 1 --agent claude-code');
    expect(markdown).toContain('## Result matrix');
    expect(markdown).toContain('five-issue average duration');
  });

  it('writes the template to --output when requested', () => {
    const stdout = { write: jest.fn() };
    const stderr = { write: jest.fn() };

    const code = main(['--issues', '1,2,3,4,5', '--output', '/tmp/acceptance.md'], { stdout, stderr });

    expect(code).toBe(0);
    expect(fs.writeFileSync).toHaveBeenCalledWith('/tmp/acceptance.md', expect.stringContaining('# Agent Acceptance Plan'));
    expect(stdout.write).toHaveBeenCalledWith(expect.stringContaining('Wrote acceptance template'));
    expect(stderr.write).not.toHaveBeenCalled();
  });
});
