/**
 * End-to-end contract test for scripts/export-knowledge-base.js.
 *
 * Locks the cross-repo data contract with ai-issue-service Phase 5C
 * endpoints (/knowledge/export and /resources/index) by:
 *
 *   1. Mocking the HTTP module the script uses to return a fixture that
 *      mirrors the actual production response shape (bare resource_pattern
 *      with literal `*` glob, empty solution_summary, etc.).
 *   2. Running the export pipeline end-to-end into a temp dir.
 *   3. Loading the resulting kb.jsonl through LocalKnowledgeBase and
 *      asserting that getResourceInfo + findSimilarIssues actually
 *      surface the data — proves the strip-prefix + glob reconciliation
 *      logic in lib/local-knowledge-base.js stays in sync with the
 *      service's resource_pattern emission format.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mock https.get BEFORE the script under test is required (it captures the
// reference at top-level).
const mockHttpsGet = jest.fn();
jest.mock('https', () => ({ get: (...args) => mockHttpsGet(...args) }));
jest.mock('http', () => ({ get: jest.fn() }));

const exportScript = require('../../scripts/export-knowledge-base');
const { LocalKnowledgeBase } = require('../../lib/local-knowledge-base');

const SOURCE_REPO = 'hashicorp/terraform-provider-azurerm';
const SERVICE_URL = 'https://service.example';
const MANAGER_KEY = 'test-manager-key';

// Real production-style data (per migration 004): resource_pattern is bare,
// often with literal `*` wildcards. Service Phase 5C emits these as
// resource_type unchanged.
const FIXTURE_KNOWLEDGE = {
  entries: [
    {
      type: 'resolved_issue',
      issue_number: 28901,
      title: 'azurerm_key_vault crash on read',
      body_summary: 'Nil pointer when reading deleted key vault.',
      solution_summary: '',
      keywords: [],
      labels: ['bug', 'service/keyvault'],
      resource_type: '',
      service: '',
      pr_number: 28950,
      pr_url: 'https://github.com/hashicorp/terraform-provider-azurerm/pull/28950',
      changed_files: ['internal/services/keyvault/key_vault_resource.go'],
      closed_at: '2025-01-01T12:00:00+00:00',
      confidence: 0.9
    },
    {
      type: 'resolved_issue',
      issue_number: 28902,
      title: 'azurerm_cognitive_account network rules update fails',
      body_summary: 'Network rules update returns conflict on cognitive account.',
      solution_summary: '',
      keywords: [],
      labels: ['bug', 'service/cognitive'],
      resource_type: '',
      service: '',
      pr_number: 28951,
      pr_url: 'https://github.com/hashicorp/terraform-provider-azurerm/pull/28951',
      changed_files: ['internal/services/cognitive/cognitive_account_resource.go'],
      closed_at: '2025-01-02T12:00:00+00:00',
      confidence: 0.85
    }
  ],
  count: 2,
  repo: SOURCE_REPO,
  confidence_min: 0.8
};

const FIXTURE_RESOURCES = {
  entries: [
    {
      type: 'resource_index',
      resource_type: 'key_vault*',
      owners: ['alice'],
      source_files: [],
      test_files: [],
      common_issues: []
    },
    {
      type: 'resource_index',
      resource_type: 'cognitive_*',
      owners: ['bob', 'carol'],
      source_files: [],
      test_files: [],
      common_issues: []
    }
  ],
  count: 2,
  repo: SOURCE_REPO
};

function fakeResponse(body) {
  // Build a mock IncomingMessage that calls the data/end handlers and
  // matches the script's `res.setEncoding('utf8')` + chunked-read pattern.
  const handlers = {};
  const res = {
    statusCode: 200,
    setEncoding: jest.fn(),
    on(event, fn) { handlers[event] = fn; return res; }
  };
  const req = {
    on: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    destroy: jest.fn()
  };
  setImmediate(() => {
    if (handlers.data) handlers.data(JSON.stringify(body));
    if (handlers.end) handlers.end();
  });
  return { req, res };
}

describe('scripts/export-knowledge-base contract with ai-issue-service Phase 5C', () => {
  let tmpRoot;

  beforeEach(() => {
    mockHttpsGet.mockReset();
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'export-kb-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  describe('fetchExport URL builder', () => {
    test('throws when sourceRepo missing', async () => {
      await expect(
        exportScript.fetchExport(SERVICE_URL, MANAGER_KEY, 0.8, undefined)
      ).rejects.toThrow(/sourceRepo is required/);
    });

    test('builds URL with ?repo= AND confidence_min, URL-encoded', async () => {
      mockHttpsGet.mockImplementation((url, opts, cb) => {
        const { req, res } = fakeResponse({ entries: [] });
        cb(res);
        return req;
      });
      await exportScript.fetchExport(SERVICE_URL, MANAGER_KEY, 0.85, SOURCE_REPO);
      const calledUrl = mockHttpsGet.mock.calls[0][0];
      expect(calledUrl).toBe(
        `${SERVICE_URL}/knowledge/export?repo=${encodeURIComponent(SOURCE_REPO)}&confidence_min=${encodeURIComponent(0.85)}`
      );
      // Manager key must be sent as X-Api-Key header
      const opts = mockHttpsGet.mock.calls[0][1];
      expect(opts.headers['X-Api-Key']).toBe(MANAGER_KEY);
    });
  });

  describe('fetchResources URL builder', () => {
    test('throws when sourceRepo missing', async () => {
      await expect(
        exportScript.fetchResources(SERVICE_URL, MANAGER_KEY, undefined)
      ).rejects.toThrow(/sourceRepo is required/);
    });

    test('builds URL with ?repo= URL-encoded', async () => {
      mockHttpsGet.mockImplementation((url, opts, cb) => {
        const { req, res } = fakeResponse({ entries: [] });
        cb(res);
        return req;
      });
      await exportScript.fetchResources(SERVICE_URL, MANAGER_KEY, SOURCE_REPO);
      const calledUrl = mockHttpsGet.mock.calls[0][0];
      expect(calledUrl).toBe(
        `${SERVICE_URL}/resources/index?repo=${encodeURIComponent(SOURCE_REPO)}`
      );
    });
  });

  describe('main pipeline end-to-end', () => {
    function setupTwoCallMock() {
      let call = 0;
      mockHttpsGet.mockImplementation((url, opts, cb) => {
        const body = call === 0 ? FIXTURE_KNOWLEDGE : FIXTURE_RESOURCES;
        call += 1;
        const { req, res } = fakeResponse(body);
        cb(res);
        return req;
      });
    }

    test('writes kb.jsonl, manifest.json, kb-df.json, LICENSE.txt', async () => {
      setupTwoCallMock();
      const outputDir = path.join(tmpRoot, 'kb');
      const result = await exportScript.main({
        serviceUrl: SERVICE_URL,
        serviceApiKey: MANAGER_KEY,
        output: outputDir,
        sourceRepo: SOURCE_REPO,
        minConfidence: 0.8,
        version: '2026.05.09',
        dryRun: false
      });
      expect(fs.existsSync(path.join(outputDir, 'kb.jsonl'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'manifest.json'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'kb-df.json'))).toBe(true);
      expect(fs.existsSync(path.join(outputDir, 'LICENSE.txt'))).toBe(true);
      // 2 resolved_issue + 2 resource_index = 4
      expect(result.entries).toHaveLength(4);
    });

    test('produced kb.jsonl is consumable by LocalKnowledgeBase end-to-end', async () => {
      setupTwoCallMock();
      const outputDir = path.join(tmpRoot, 'kb');
      await exportScript.main({
        serviceUrl: SERVICE_URL,
        serviceApiKey: MANAGER_KEY,
        output: outputDir,
        sourceRepo: SOURCE_REPO,
        minConfidence: 0.8,
        version: '2026.05.09'
      });
      // Force qualityGate=passed so shouldPreferLocal logic matches prod
      const manifestPath = path.join(outputDir, 'manifest.json');
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      manifest.qualityGate = 'passed';
      manifest.kbSha256 = require('crypto').createHash('sha256')
        .update(fs.readFileSync(path.join(outputDir, 'kb.jsonl')))
        .digest('hex');
      fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

      const kb = new LocalKnowledgeBase(outputDir);
      await kb.load();
      expect(kb.entries).toHaveLength(4);

      // Locks the strip-prefix + glob reconciliation contract
      // (lib/local-knowledge-base.js getResourceInfo).
      // Service emits resource_type='key_vault*'; CLI gets called with
      // 'azurerm_key_vault'; must strip prefix + glob match.
      const keyVaultInfo = await kb.getResourceInfo('azurerm_key_vault');
      expect(keyVaultInfo).not.toBeNull();
      expect(keyVaultInfo.resource_type).toBe('key_vault*');

      // Service emits resource_type='cognitive_*'; CLI gets
      // 'azurerm_cognitive_account'; must strip + glob.
      const cogInfo = await kb.getResourceInfo('azurerm_cognitive_account');
      expect(cogInfo).not.toBeNull();
      expect(cogInfo.resource_type).toBe('cognitive_*');

      // Locks the empty-as-wildcard filter
      // (lib/local-knowledge-base.js findSimilarIssues filter).
      // Service emits resource_type='' for every resolved_issue (Phase 5C Q3
      // does not derive it server-side). CLI must NOT exclude these when a
      // resourceType filter is passed, otherwise every CLI lookup misses.
      const similar = await kb.findSimilarIssues('crash on read key vault', {
        resourceType: 'azurerm_key_vault',
        limit: 5
      });
      expect(similar.length).toBeGreaterThan(0);
      expect(similar[0].issue_number).toBe(28901);
    });
  });
});
