const fs = require('fs');
const path = require('path');
const {
  fixtureRoot,
  sampleEntries,
  writeKbFixture
} = require('../helpers/kb-fixture');

const mockSetRequestHandler = jest.fn();
const mockConnect = jest.fn();

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => ({
    setRequestHandler: mockSetRequestHandler,
    connect: mockConnect
  }))
}), { virtual: true });

jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn()
}), { virtual: true });

jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema'
}), { virtual: true });

describe('similar-issue-finder skill', () => {
  const scratchRoot = path.join(fixtureRoot, 'skill-dual-mode');
  const originalServiceUrl = process.env.AI_ISSUE_SERVICE_URL;
  const originalKbPath = process.env.AI_ISSUE_KB_PATH;
  const originalPreferLocal = process.env.AI_ISSUE_KB_PREFER_LOCAL;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    mockSetRequestHandler.mockClear();
    mockConnect.mockClear();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    fs.mkdirSync(scratchRoot, { recursive: true });
    delete process.env.AI_ISSUE_SERVICE_URL;
    delete process.env.AI_ISSUE_KB_PATH;
    delete process.env.AI_ISSUE_KB_PREFER_LOCAL;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    if (originalServiceUrl === undefined) delete process.env.AI_ISSUE_SERVICE_URL;
    else process.env.AI_ISSUE_SERVICE_URL = originalServiceUrl;
    if (originalKbPath === undefined) delete process.env.AI_ISSUE_KB_PATH;
    else process.env.AI_ISSUE_KB_PATH = originalKbPath;
    if (originalPreferLocal === undefined) delete process.env.AI_ISSUE_KB_PREFER_LOCAL;
    else process.env.AI_ISSUE_KB_PREFER_LOCAL = originalPreferLocal;
    fs.rmSync(scratchRoot, { recursive: true, force: true });
    global.fetch = originalFetch;
  });

  function mockCloudResponse(payload = { similar_issues: [], solutions: [] }) {
    global.fetch.mockResolvedValue({
      ok: true,
      json: async () => payload
    });
  }

  it('uses local KB when present and quality gate passed without calling fetch', async () => {
    const kbDir = path.join(scratchRoot, 'local-passed');
    writeKbFixture(kbDir, { qualityGate: 'passed' });
    process.env.AI_ISSUE_KB_PATH = kbDir;
    const skill = require('../../skills/similar-issue-finder');

    const result = await skill.handlers.findSimilarIssues({
      repo: 'hashicorp/terraform-provider-azurerm',
      title: 'azurerm_key_vault_certificate timeout',
      body: 'polling stalls'
    });

    expect(result.content[0].type).toBe('text');
    expect(result.content[0].text).toContain(sampleEntries[0].pr_url);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('uses cloud when local KB quality gate failed and service URL is set', async () => {
    const kbDir = path.join(scratchRoot, 'local-failed');
    writeKbFixture(kbDir, { qualityGate: 'failed' });
    process.env.AI_ISSUE_KB_PATH = kbDir;
    process.env.AI_ISSUE_SERVICE_URL = 'https://example.test';
    mockCloudResponse();
    const skill = require('../../skills/similar-issue-finder');

    await skill.handlers.findSimilarIssues({
      repo: 'hashicorp/terraform-provider-azurerm',
      title: 'azurerm_key_vault_certificate timeout',
      body: 'polling stalls'
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://example.test/search');
  });

  it('falls back to cloud when local KB load fails and service URL is set', async () => {
    const kbDir = path.join(scratchRoot, 'local-corrupt-data');
    writeKbFixture(kbDir, { qualityGate: 'passed' });
    fs.writeFileSync(path.join(kbDir, 'kb.jsonl'), `${JSON.stringify(sampleEntries[0])}\ncorrupt\n`);
    process.env.AI_ISSUE_KB_PATH = kbDir;
    process.env.AI_ISSUE_SERVICE_URL = 'https://example.test';
    mockCloudResponse();
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const skill = require('../../skills/similar-issue-finder');

    await skill.handlers.findSimilarIssues({
      repo: 'hashicorp/terraform-provider-azurerm',
      title: 'azurerm_key_vault_certificate timeout',
      body: 'polling stalls'
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://example.test/search');
    consoleErrorSpy.mockRestore();
  });

  it('uses cloud when KB path points to a non-existent directory and service URL is set', async () => {
    process.env.AI_ISSUE_KB_PATH = path.join(scratchRoot, `nonexistent-${Date.now()}`);
    process.env.AI_ISSUE_SERVICE_URL = 'https://example.test';
    mockCloudResponse();
    const skill = require('../../skills/similar-issue-finder');

    await expect(skill.handlers.findSimilarIssues({
      repo: 'hashicorp/terraform-provider-azurerm',
      title: 'issue'
    })).resolves.toEqual(expect.objectContaining({
      content: expect.any(Array)
    }));

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://example.test/search');
  });

  it('returns deterministic empty when corrupted manifest is configured without service URL', async () => {
    const kbDir = path.join(scratchRoot, 'corrupted-manifest');
    fs.mkdirSync(kbDir, { recursive: true });
    fs.writeFileSync(path.join(kbDir, 'manifest.json'), '{not json');
    process.env.AI_ISSUE_KB_PATH = kbDir;
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const skill = require('../../skills/similar-issue-finder');

    const result = await skill.handlers.findSimilarIssues({
      repo: 'hashicorp/terraform-provider-azurerm',
      title: 'issue'
    });

    expect(result.content[0].text).toBe('No knowledge base or service URL configured. Skipping similar-issue lookup.');
    expect(global.fetch).not.toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it('uses cloud when AI_ISSUE_KB_PREFER_LOCAL=false overrides passed quality gate', async () => {
    const kbDir = path.join(scratchRoot, 'prefer-cloud');
    writeKbFixture(kbDir, { qualityGate: 'passed' });
    process.env.AI_ISSUE_KB_PATH = kbDir;
    process.env.AI_ISSUE_KB_PREFER_LOCAL = 'false';
    process.env.AI_ISSUE_SERVICE_URL = 'https://example.test';
    mockCloudResponse();
    const skill = require('../../skills/similar-issue-finder');

    await skill.handlers.findSimilarIssues({
      repo: 'hashicorp/terraform-provider-azurerm',
      title: 'azurerm_key_vault_certificate timeout',
      body: 'polling stalls'
    });

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch.mock.calls[0][0]).toBe('https://example.test/search');
  });

  it('returns deterministic empty results without fetch when no service URL or KB is configured', async () => {
    const skill = require('../../skills/similar-issue-finder');

    const cases = [
      skill.handlers.findSimilarIssues({ repo: 'owner/repo', title: 'issue' }),
      skill.handlers.checkExistingResearch({ repo: 'owner/repo', title: 'issue' }),
      skill.handlers.handleToolRequest({ params: { name: 'find_similar_issues', arguments: { repo: 'owner/repo' } } }),
      skill.handlers.handleToolRequest({ params: { name: 'check_existing_research', arguments: { repo: 'owner/repo', title: 'issue' } } })
    ];

    const results = await Promise.all(cases);

    for (const result of results) {
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toEqual(expect.any(String));
      expect(result.content[0].text.length).toBeGreaterThan(0);
      expect(result.isError).not.toBe(true);
    }
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
