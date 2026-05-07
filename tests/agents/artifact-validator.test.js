const { validateArtifact } = require('../../lib/agents/artifact-validator');
const { ArtifactValidationError } = require('../../lib/agents/errors');

describe('artifact-validator', () => {
  it('returns null when requiredSection and validate pass', () => {
    const result = validateArtifact({
      kind: 'file',
      path: '/tmp/report.md',
      requiredSection: /^## Summary/m,
      validate: content => content.includes('ok')
    }, '## Summary\n\nok');

    expect(result).toBeNull();
  });

  it('returns ArtifactValidationError when requiredSection is missing', () => {
    const result = validateArtifact({
      kind: 'file',
      path: '/tmp/report.md',
      requiredSection: /^## Summary/m
    }, '# Different');

    expect(result).toBeInstanceOf(ArtifactValidationError);
    expect(result.message).toContain('Missing required section');
  });

  it('returns ArtifactValidationError when custom validate returns false', () => {
    const result = validateArtifact({
      kind: 'file',
      path: '/tmp/report.md',
      validate: () => false
    }, 'content');

    expect(result).toBeInstanceOf(ArtifactValidationError);
    expect(result.message).toContain('Validator returned false');
  });
});
