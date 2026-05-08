const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  collectArtifacts,
  decodeAttribute,
  extractArtifactBlock
} = require('../../lib/agents/artifact-collector');
const { UnsupportedArtifactKind } = require('../../lib/agents/errors');

describe('artifact-collector', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-artifacts-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('decodes escaped artifact path attributes', () => {
    expect(decodeAttribute('/tmp/&quot;a&quot;&amp;b.md')).toBe('/tmp/"a"&b.md');
  });

  it('extracts a matching artifact block', () => {
    const stdout = 'text\n<artifact path="/tmp/a.md">content</artifact>\nmore';

    expect(extractArtifactBlock(stdout, '/tmp/a.md')).toBe('content');
    expect(extractArtifactBlock(stdout, '/tmp/b.md')).toBeNull();
  });

  it('uses an existing file before stdout blocks', () => {
    const filePath = path.join(tempDir, 'report.md');
    fs.writeFileSync(filePath, 'file content');

    const result = collectArtifacts([
      { kind: 'file', path: filePath }
    ], {
      stdout: `<artifact path="${filePath}">stdout content</artifact>`,
      repoPath: tempDir
    });

    expect(result.artifacts[filePath]).toBe('file content');
    expect(result.warnings).toEqual([]);
  });

  it('writes and returns an artifact extracted from stdout', () => {
    const filePath = path.join(tempDir, 'nested', 'report.md');

    const result = collectArtifacts([
      { kind: 'file', path: filePath }
    ], {
      stdout: `<artifact path="${filePath}">stdout content</artifact>`,
      repoPath: tempDir
    });

    expect(fs.readFileSync(filePath, 'utf8')).toBe('stdout content');
    expect(result.artifacts[filePath]).toBe('stdout content');
  });

  it('uses full stdout as degraded fallback when no artifact block exists', () => {
    const filePath = path.join(tempDir, 'report.md');

    const result = collectArtifacts([
      { kind: 'file', path: filePath }
    ], {
      stdout: 'full stdout',
      repoPath: tempDir
    });

    expect(fs.readFileSync(filePath, 'utf8')).toBe('full stdout');
    expect(result.artifacts[filePath]).toBe('full stdout');
    expect(result.warnings[0]).toContain('degraded fallback');
  });

  it('honors warn-mode validation failures in degraded fallback', () => {
    const filePath = path.join(tempDir, 'report.md');

    const result = collectArtifacts([
      { kind: 'file', path: filePath, requiredSection: /^## Missing/m, failureMode: 'warn' }
    ], {
      stdout: 'full stdout',
      repoPath: tempDir
    });

    expect(result.artifacts).toEqual({});
    expect(result.warnings.join('\n')).toContain('degraded fallback');
    expect(result.warnings.join('\n')).toContain('Missing required section');
  });

  it('collects stdout artifacts', () => {
    const result = collectArtifacts([
      { kind: 'stdout', path: 'stdout' }
    ], {
      stdout: 'plain output',
      repoPath: tempDir
    });

    expect(result.artifacts).toEqual({ stdout: 'plain output' });
  });

  it('throws for unsupported artifact kinds', () => {
    expect(() => collectArtifacts([
      { kind: 'image', path: '/tmp/image.png' }
    ], {
      stdout: '',
      repoPath: tempDir
    })).toThrow(UnsupportedArtifactKind);
  });
});
