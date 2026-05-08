const { finalizeArtifact, handleArtifactIssue } = require('../../lib/agents/artifact-finalizer');
const { ArtifactValidationError } = require('../../lib/agents/errors');

describe('artifact-finalizer', () => {
  it('stores valid artifacts by path', () => {
    const artifacts = {};
    const warnings = [];

    const accepted = finalizeArtifact({
      kind: 'file',
      path: '/tmp/report.md',
      requiredSection: /^## Summary/m
    }, '## Summary\nok', artifacts, warnings);

    expect(accepted).toBe(true);
    expect(artifacts).toEqual({ '/tmp/report.md': '## Summary\nok' });
    expect(warnings).toEqual([]);
  });

  it('stores valid artifacts by explicit key', () => {
    const artifacts = {};
    const warnings = [];

    finalizeArtifact({ kind: 'stdout', path: 'stdout' }, 'hello', artifacts, warnings, 'stdout');

    expect(artifacts).toEqual({ stdout: 'hello' });
  });

  it('throws validation errors in throw mode', () => {
    expect(() => finalizeArtifact({
      kind: 'file',
      path: '/tmp/report.md',
      requiredSection: /^## Missing/m
    }, 'content', {}, [])).toThrow(ArtifactValidationError);
  });

  it('records validation warnings in warn mode without storing artifact', () => {
    const artifacts = {};
    const warnings = [];

    const accepted = finalizeArtifact({
      kind: 'file',
      path: '/tmp/report.md',
      requiredSection: /^## Missing/m,
      failureMode: 'warn'
    }, 'content', artifacts, warnings);

    expect(accepted).toBe(false);
    expect(artifacts).toEqual({});
    expect(warnings[0]).toContain('Missing required section');
  });

  it('handles missing artifact warnings in warn mode', () => {
    const warnings = [];

    const accepted = handleArtifactIssue({
      kind: 'file',
      path: '/tmp/report.md',
      failureMode: 'warn'
    }, 'Expected artifact missing: /tmp/report.md', warnings);

    expect(accepted).toBe(false);
    expect(warnings).toEqual(['Expected artifact missing: /tmp/report.md']);
  });
});
