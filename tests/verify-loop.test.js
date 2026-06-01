const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());

const { buildVerifyFixPrompt, resolveParallelism, resolveVerifyLoopOptions } = require('../lib/verify-loop');

describe('verify-loop helpers', () => {
  it('deep-resolves verify loop options with defaults', () => {
    expect(resolveVerifyLoopOptions({ verifyLoop: { enabled: false } })).toEqual(expect.objectContaining({
      enabled: false,
      maxAttempts: 3,
      phaseATimeoutSec: 1800,
      phaseBTimeoutSec: 2400,
      parallelism: 'auto',
      skipGates: []
    }));
  });

  it('resolves explicit numeric parallelism', () => {
    expect(resolveParallelism({ parallelism: 4 })).toBe(4);
  });

  it('builds a retry prompt containing gate guidance, output, and generated diff', () => {
    const prompt = buildVerifyFixPrompt([
      {
        gateId: 'depscheck',
        passed: false,
        exitCode: 1,
        durationMs: 10,
        output: 'go.mod dirty',
        generatedDiff: 'diff --git a/go.mod b/go.mod',
        guidance: 'Run make depscheck'
      }
    ], '123', '/repo', 'abc123');

    expect(prompt).toContain('Gate: depscheck');
    expect(prompt).toContain('Run make depscheck');
    expect(prompt).toContain('go.mod dirty');
    expect(prompt).toContain('diff --git');
    expect(prompt).toContain('abc123..HEAD');
  });
});
