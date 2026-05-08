const { wrapPromptWithArtifactInstructions } = require('../../lib/agents/prompt-wrapper');

describe('prompt-wrapper', () => {
  it('returns the original prompt when no file artifacts are expected', () => {
    expect(wrapPromptWithArtifactInstructions('prompt', [])).toBe('prompt');
    expect(wrapPromptWithArtifactInstructions('prompt', [{ kind: 'stdout', path: 'stdout' }])).toBe('prompt');
  });

  it('adds artifact instructions for a file artifact', () => {
    const prompt = wrapPromptWithArtifactInstructions('prompt', [
      { kind: 'file', path: '/reports/result.md' }
    ]);

    expect(prompt).toContain('prompt');
    expect(prompt).toContain('ARTIFACT OUTPUT PROTOCOL');
    expect(prompt).toContain('<artifact path="/reports/result.md">');
    expect(prompt).toContain('</artifact>');
  });

  it('adds one block per file artifact', () => {
    const prompt = wrapPromptWithArtifactInstructions('prompt', [
      { kind: 'file', path: '/reports/a.md' },
      { kind: 'file', path: '/reports/b.md' }
    ]);

    expect(prompt.match(/<artifact path=/g)).toHaveLength(2);
    expect(prompt).toContain('/reports/a.md');
    expect(prompt).toContain('/reports/b.md');
  });

  it('escapes artifact paths in XML attributes', () => {
    const prompt = wrapPromptWithArtifactInstructions('prompt', [
      { kind: 'file', path: '/reports/"quoted"&file.md' }
    ]);

    expect(prompt).toContain('/reports/&quot;quoted&quot;&amp;file.md');
  });
});
