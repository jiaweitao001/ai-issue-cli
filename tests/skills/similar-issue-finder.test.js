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
  const originalServiceUrl = process.env.AI_ISSUE_SERVICE_URL;
  const originalKbPath = process.env.AI_ISSUE_KB_PATH;
  const originalFetch = global.fetch;

  beforeEach(() => {
    jest.resetModules();
    mockSetRequestHandler.mockClear();
    mockConnect.mockClear();
    delete process.env.AI_ISSUE_SERVICE_URL;
    delete process.env.AI_ISSUE_KB_PATH;
    global.fetch = jest.fn();
  });

  afterEach(() => {
    if (originalServiceUrl === undefined) delete process.env.AI_ISSUE_SERVICE_URL;
    else process.env.AI_ISSUE_SERVICE_URL = originalServiceUrl;
    if (originalKbPath === undefined) delete process.env.AI_ISSUE_KB_PATH;
    else process.env.AI_ISSUE_KB_PATH = originalKbPath;
    global.fetch = originalFetch;
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
