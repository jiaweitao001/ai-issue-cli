const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { LocalKnowledgeBase, _internal } = require('../lib/local-knowledge-base');
const { kbErrors } = require('../lib/kb-resolver');
const {
  writeKbFixture,
  createScratchRoot,
  cleanupScratchRoot
} = require('./helpers/kb-fixture');

async function expectLoadError(kbDir, code) {
  await expect(new LocalKnowledgeBase(kbDir).load()).rejects.toThrow(expect.objectContaining({ code }));
}

describe('LocalKnowledgeBase', () => {
  let scratchRoot;
  let sampleKbDir;

  beforeEach(() => {
    scratchRoot = createScratchRoot('local-kb');
    sampleKbDir = path.join(scratchRoot, 'sample');
    writeKbFixture(sampleKbDir);
  });

  afterEach(() => {
    cleanupScratchRoot(scratchRoot);
  });

  describe('load', () => {
    it('loads manifest, entries, document frequency, and search index', async () => {
      const kb = new LocalKnowledgeBase(sampleKbDir);
      await kb.load();
      expect(kb.manifest.schemaVersion).toBe(LocalKnowledgeBase.SCHEMA_VERSION);
      expect(kb.entries).toHaveLength(4);
      expect(kb.df.timeout).toBe(1);
      expect(kb.searchIndex).toBeTruthy();
    });

    it('loads df from manifest indexes when provided', async () => {
      const kbDir = path.join(scratchRoot, 'with-df');
      writeKbFixture(kbDir, { indexes: { df: 'kb-df.json' } });
      fs.writeFileSync(path.join(kbDir, 'kb-df.json'), JSON.stringify({ custom: 3 }));
      const kb = new LocalKnowledgeBase(kbDir);
      await kb.load();
      expect(kb.df).toEqual({ custom: 3 });
    });
  });

  describe('checkSchemaCompat', () => {
    it('throws KB_SCHEMA_TOO_NEW', async () => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, 'too-new'), {
        schemaVersion: LocalKnowledgeBase.SCHEMA_VERSION + 1
      });
      await expectLoadError(kbDir, kbErrors.KB_SCHEMA_TOO_NEW);
    });

    it('throws KB_SCHEMA_TOO_OLD', async () => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, 'too-old'), { schemaVersion: 0 });
      await expectLoadError(kbDir, kbErrors.KB_SCHEMA_TOO_OLD);
    });

    it('throws CLI_TOO_OLD', async () => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, 'cli-too-old'), { minCliVersion: '99.0.0' });
      await expectLoadError(kbDir, kbErrors.CLI_TOO_OLD);
    });

    it('throws KB_CORRUPTED when minCliVersion is missing', async () => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, 'missing-min-cli'), { minCliVersion: undefined });
      await expectLoadError(kbDir, kbErrors.KB_CORRUPTED);
    });
  });

  describe('checkSha256', () => {
    it('throws KB_SHA256_MISMATCH with expected, actual, and path', async () => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, 'sha-mismatch'), { kbSha256: '0'.repeat(64) });
      await expect(new LocalKnowledgeBase(kbDir).load()).rejects.toThrow(expect.objectContaining({
        code: kbErrors.KB_SHA256_MISMATCH,
        expected: '0'.repeat(64),
        actual: expect.stringMatching(/^[0-9a-f]{64}$/),
        path: path.join(kbDir, 'kb.jsonl')
      }));
    });

    it('throws KB_CORRUPTED when kbSha256 is not 64 hex characters', async () => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, 'bad-sha'), { kbSha256: 'not-a-sha' });
      await expectLoadError(kbDir, kbErrors.KB_CORRUPTED);
    });

    it('accepts uppercase manifest kbSha256 (normalized lowercase comparison)', async () => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, 'uppercase-sha'));
      const manifestPath = path.join(kbDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.kbSha256 = manifest.kbSha256.toUpperCase();
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      await expect(new LocalKnowledgeBase(kbDir).load()).resolves.toBeInstanceOf(LocalKnowledgeBase);
    });
  });

  it('memoizes the in-flight load() promise across concurrent callers', async () => {
    const { kbDir } = writeKbFixture(path.join(scratchRoot, 'concurrent-load'));
    const kb = new LocalKnowledgeBase(kbDir);
    const spy = jest.spyOn(kb, '_loadInternal');
    const [r1, r2, r3] = await Promise.all([kb.load(), kb.load(), kb.load()]);
    expect(r1).toBe(kb);
    expect(r2).toBe(kb);
    expect(r3).toBe(kb);
    // _loadInternal must run exactly once even with three concurrent callers.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(kb.entries.length).toBeGreaterThan(0);

    // After completion, a follow-up load() short-circuits on cached entries/index.
    await kb.load();
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it('clears _loadPromise on failure so subsequent load() can retry', async () => {
    const { kbDir } = writeKbFixture(path.join(scratchRoot, 'retry-after-fail'), { kbSha256: '0'.repeat(64) });
    const kb = new LocalKnowledgeBase(kbDir);
    await expect(kb.load()).rejects.toThrow(expect.objectContaining({ code: kbErrors.KB_SHA256_MISMATCH }));
    // _loadPromise must be cleared so a fresh attempt isn't blocked by the previous failure.
    await expect(kb.load()).rejects.toThrow(expect.objectContaining({ code: kbErrors.KB_SHA256_MISMATCH }));
  });

  it('throws KB_CORRUPTED with line number for bad JSONL', async () => {
    const { kbDir } = writeKbFixture(path.join(scratchRoot, 'bad-jsonl'));
    const content = fs.readFileSync(path.join(kbDir, 'kb.jsonl'), 'utf8');
    const badContent = `${content}{bad json}\n`;
    fs.writeFileSync(path.join(kbDir, 'kb.jsonl'), badContent);
    const manifestPath = path.join(kbDir, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.kbSha256 = crypto.createHash('sha256').update(badContent).digest('hex');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    await expect(new LocalKnowledgeBase(kbDir).load()).rejects.toThrow(expect.objectContaining({
      code: kbErrors.KB_CORRUPTED,
      path: path.join(kbDir, 'kb.jsonl'),
      lineNumber: 5
    }));
  });

  describe('shouldPreferLocal', () => {
    it.each([
      ['passed quality with env unset', { qualityGate: 'passed' }, {}, true],
      ['failed quality with env unset', { qualityGate: 'failed' }, {}, false],
      ['missing quality with env unset', { qualityGate: undefined }, {}, false],
      ['env true overrides failed quality', { qualityGate: 'failed' }, { AI_ISSUE_KB_PREFER_LOCAL: 'true' }, true],
      ['env false overrides passed quality', { qualityGate: 'passed' }, { AI_ISSUE_KB_PREFER_LOCAL: 'false' }, false]
    ])('%s', async (_name, manifestOverrides, env, expected) => {
      const { kbDir } = writeKbFixture(path.join(scratchRoot, `prefer-${_name.replace(/\W+/g, '-')}`), manifestOverrides);
      const kb = new LocalKnowledgeBase(kbDir, { env });
      await kb.load();
      expect(kb.shouldPreferLocal()).toBe(expected);
    });
  });

  describe('findSimilarIssues', () => {
    it('filters by resourceType', async () => {
      const results = await new LocalKnowledgeBase(sampleKbDir).findSimilarIssues('storage network rules crash', {
        resourceType: 'azurerm_key_vault_certificate'
      });
      expect(results).toEqual([]);
    });

    it('filters by service', async () => {
      const results = await new LocalKnowledgeBase(sampleKbDir).findSimilarIssues('certificate polling timeout', {
        service: 'storage'
      });
      expect(results).toEqual([]);
    });

    it('returns matching issues with expected shape', async () => {
      const results = await new LocalKnowledgeBase(sampleKbDir).findSimilarIssues('certificate polling timeout keyvault', {
        resourceType: 'azurerm_key_vault_certificate',
        service: 'keyvault'
      });
      expect(results[0]).toMatchObject({
        issue_number: 101,
        title: expect.stringContaining('certificate'),
        pr_number: 1101,
        pr_url: expect.stringContaining('/1101'),
        solution_summary: expect.stringContaining('poller'),
        resource_type: 'azurerm_key_vault_certificate',
        service: 'keyvault'
      });
      expect(results[0].score).toBeGreaterThan(0.5);
    });

    it('handles multi-language queries', async () => {
      const results = await new LocalKnowledgeBase(sampleKbDir).findSimilarIssues('证书 certificate timeout 创建失败', { limit: 2 });
      expect(Array.isArray(results)).toBe(true);
      expect(results[0].issue_number).toBe(101);
    });

    it('strips stack trace noise so pure noise produces no results', async () => {
      expect(_internal.stripStackTraceNoise('runtime.goexit internal/services/foo.go:123 hcl:diag')).toBe('');
      const results = await new LocalKnowledgeBase(sampleKbDir).findSimilarIssues('runtime.goexit internal/services/foo.go:123 hcl:diag');
      expect(results).toEqual([]);
    });

    it('treats empty entry.resource_type as wildcard (server emits "" for now)', async () => {
      // Production /knowledge/export emits resource_type: "" for every entry
      // (Phase 5C Q3: not derived server-side). Filter must NOT exclude these,
      // otherwise every CLI lookup with a resourceType filter returns [].
      const kbDir = path.join(scratchRoot, 'empty-resource-type');
      writeKbFixture(kbDir, {}, [{
        type: 'resolved_issue',
        issue_number: 999,
        title: 'storage account crash on update',
        body_summary: 'crash',
        labels: [],
        resource_type: '',
        service: '',
        pr_number: 9999,
        pr_url: 'https://example/pr/9999',
        changed_files: [],
        solution_summary: 'fix the crash by guarding nil',
        keywords: ['storage', 'crash']
      }]);
      const results = await new LocalKnowledgeBase(kbDir).findSimilarIssues('storage crash on update', {
        resourceType: 'azurerm_storage_account',
        service: 'storage'
      });
      expect(results).toHaveLength(1);
      expect(results[0].issue_number).toBe(999);
    });
  });

  describe('checkExistingResearch', () => {
    it('delegates to findSimilarIssues with title and body', async () => {
      const results = await new LocalKnowledgeBase(sampleKbDir).checkExistingResearch('certificate timeout', 'polling keyvault');
      expect(results[0].issue_number).toBe(101);
      expect(results.length).toBeLessThanOrEqual(3);
    });
  });

  describe('getResourceInfo', () => {
    it('returns matching resource_index entry via strip-prefix exact match', async () => {
      // fixture entry has resource_type: 'key_vault_certificate' (bare, no azurerm_ prefix)
      // input has 'azurerm_' prefix; should strip and exact-match
      const info = await new LocalKnowledgeBase(sampleKbDir).getResourceInfo('azurerm_key_vault_certificate');
      expect(info).toMatchObject({
        type: 'resource_index',
        resource_type: 'key_vault_certificate',
        service: 'keyvault',
        common_issues: ['timeout', 'polling', 'certificate']
      });
    });

    it('returns matching resource_index entry via glob match', async () => {
      // fixture has resource_type: 'cognitive_*'; input azurerm_cognitive_account
      // should strip prefix and glob-match against the * pattern
      const info = await new LocalKnowledgeBase(sampleKbDir).getResourceInfo('azurerm_cognitive_account');
      expect(info).toMatchObject({
        type: 'resource_index',
        resource_type: 'cognitive_*'
      });
    });

    it('returns null for unknown resource type', async () => {
      await expect(new LocalKnowledgeBase(sampleKbDir).getResourceInfo('azurerm_unknown_resource')).resolves.toBeNull();
    });

    it('returns null for empty input', async () => {
      await expect(new LocalKnowledgeBase(sampleKbDir).getResourceInfo('')).resolves.toBeNull();
      await expect(new LocalKnowledgeBase(sampleKbDir).getResourceInfo(undefined)).resolves.toBeNull();
    });

    it('handles input without azurerm_ prefix (passes through unchanged)', async () => {
      // bare input "key_vault_certificate" should still match the bare fixture entry
      const info = await new LocalKnowledgeBase(sampleKbDir).getResourceInfo('key_vault_certificate');
      expect(info).toMatchObject({ resource_type: 'key_vault_certificate' });
    });
  });
});
