const path = require('path');

// Mock MCP SDK so requiring the skill module does not blow up.
jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: jest.fn(() => ({
    setRequestHandler: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
  })),
}), { virtual: true });
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: jest.fn(),
}), { virtual: true });
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
  CallToolRequestSchema: 'CallToolRequestSchema',
  ListToolsRequestSchema: 'ListToolsRequestSchema',
}), { virtual: true });

const SKILL_PATH = path.resolve(__dirname, '../../skills/github-issue-fetcher/index.js');

describe('github-issue-fetcher: applyCommentTruncation (A1.1)', () => {
  let applyCommentTruncation;
  let __constants;

  beforeAll(() => {
    ({ applyCommentTruncation, __constants } = require(SKILL_PATH));
  });

  function makeComment(association, createdAt) {
    return { author_association: association, body: 'x', created_at: createdAt };
  }

  it('caps elevated to 15 + fills 5 from others when both abundant (30 OWNER + 10 NONE)', () => {
    const owners = Array.from({ length: 30 }, (_, i) =>
      makeComment('OWNER', new Date(2024, 0, 1, 0, i).toISOString())
    );
    const others = Array.from({ length: 10 }, (_, i) =>
      makeComment('NONE', new Date(2024, 1, 1, 0, i).toISOString())
    );
    const result = applyCommentTruncation([...owners, ...others]);
    expect(result.kept.length).toBe(20);
    expect(result.total).toBe(40);
    expect(result.truncated).toBe(20);
    expect(result.included_associations.OWNER).toBe(15);
    expect(result.included_associations.NONE).toBe(5);
  });

  it('lets non-elevated take surplus when elevated is short (5 OWNER + 35 NONE)', () => {
    const owners = Array.from({ length: 5 }, (_, i) =>
      makeComment('OWNER', new Date(2024, 0, 1, 0, i).toISOString())
    );
    const others = Array.from({ length: 35 }, (_, i) =>
      makeComment('NONE', new Date(2024, 1, 1, 0, i).toISOString())
    );
    const result = applyCommentTruncation([...owners, ...others]);
    expect(result.kept.length).toBe(20);
    expect(result.included_associations.OWNER).toBe(5);
    expect(result.included_associations.NONE).toBe(15);
  });

  it('returns all comments when total ≤ cap', () => {
    const small = Array.from({ length: 7 }, (_, i) =>
      makeComment('CONTRIBUTOR', new Date(2024, 0, 1, 0, i).toISOString())
    );
    const result = applyCommentTruncation(small);
    expect(result.kept.length).toBe(7);
    expect(result.total).toBe(7);
    expect(result.truncated).toBe(0);
  });

  it('counts MEMBER and COLLABORATOR as elevated', () => {
    const comments = [
      makeComment('MEMBER', '2024-01-01T00:00:00Z'),
      makeComment('COLLABORATOR', '2024-01-02T00:00:00Z'),
      ...Array.from({ length: 25 }, (_, i) =>
        makeComment('NONE', new Date(2024, 2, 1, 0, i).toISOString())
      ),
    ];
    const result = applyCommentTruncation(comments);
    expect(result.kept.length).toBe(20);
    expect(result.included_associations.MEMBER).toBe(1);
    expect(result.included_associations.COLLABORATOR).toBe(1);
    expect(result.included_associations.NONE).toBe(18);
  });

  it('exposes COMMENT_CAP_TOTAL=20 / ELEVATED=15 constants', () => {
    expect(__constants.COMMENT_CAP_TOTAL).toBe(20);
    expect(__constants.COMMENT_CAP_ELEVATED).toBe(15);
  });
});

describe('github-issue-fetcher: parseNextPageUrl (A1.3)', () => {
  let parseNextPageUrl;
  beforeAll(() => {
    ({ parseNextPageUrl } = require(SKILL_PATH));
  });

  it('returns null when header missing', () => {
    expect(parseNextPageUrl(null)).toBeNull();
    expect(parseNextPageUrl('')).toBeNull();
  });

  it('extracts the rel="next" URL', () => {
    const header =
      '<https://api.github.com/repositories/1/issues/2/comments?page=2>; rel="next", ' +
      '<https://api.github.com/repositories/1/issues/2/comments?page=5>; rel="last"';
    expect(parseNextPageUrl(header)).toBe(
      'https://api.github.com/repositories/1/issues/2/comments?page=2'
    );
  });

  it('returns null when only rel="last" is present (last page)', () => {
    const header =
      '<https://api.github.com/repositories/1/issues/2/comments?page=1>; rel="prev", ' +
      '<https://api.github.com/repositories/1/issues/2/comments?page=1>; rel="first"';
    expect(parseNextPageUrl(header)).toBeNull();
  });
});

describe('github-issue-fetcher: buildRateLimitError (A1.4)', () => {
  let buildRateLimitError;
  beforeAll(() => {
    ({ buildRateLimitError } = require(SKILL_PATH));
  });

  function fakeResponse(status, headers) {
    return {
      status,
      headers: {
        get: (k) => headers[k.toLowerCase()] ?? headers[k] ?? null,
      },
    };
  }

  it('returns null when not rate-limited (200)', () => {
    expect(buildRateLimitError(fakeResponse(200, {}), '')).toBeNull();
  });

  it('returns null on plain 403 with remaining > 0 (e.g. permission denied)', () => {
    const r = fakeResponse(403, { 'x-ratelimit-remaining': '4999' });
    expect(buildRateLimitError(r, 'forbidden')).toBeNull();
  });

  it('builds error on 403 with x-ratelimit-remaining=0', () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    const r = fakeResponse(403, {
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String(reset),
    });
    const err = buildRateLimitError(r, 'rate limited');
    expect(err).toBeInstanceOf(Error);
    expect(err.meta.rate_limited).toBe(true);
    expect(err.meta.status).toBe(403);
    expect(err.meta.reset_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    // Message should contain the ISO reset time so the LLM sees it directly
    expect(err.message).toMatch(/Reset at \d{4}-\d{2}-\d{2}T/);
    expect(err.message).toContain('Retry after');
  });

  it('builds error on 429 even without x-ratelimit-remaining=0', () => {
    const r = fakeResponse(429, { 'retry-after': '30' });
    const err = buildRateLimitError(r, 'too many');
    expect(err).toBeInstanceOf(Error);
    expect(err.meta.status).toBe(429);
    expect(err.meta.retry_after_seconds).toBe(30);
    expect(err.message).toContain('Retry after 30s');
  });
});

describe('github-issue-fetcher: fetchComments pagination (A1.3)', () => {
  let fetchComments;
  let originalFetch;

  beforeAll(() => {
    ({ fetchComments } = require(SKILL_PATH));
  });

  beforeEach(() => {
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function pageResponse(items, nextUrl) {
    const linkHeader = nextUrl ? `<${nextUrl}>; rel="next"` : '';
    return {
      ok: true,
      status: 200,
      headers: {
        get: (k) => (k.toLowerCase() === 'link' ? linkHeader : null),
      },
      json: async () => items,
      text: async () => '',
    };
  }

  function makeRaw(association, n, createdAtMillis) {
    return Array.from({ length: n }, (_, i) => ({
      user: { login: `${association.toLowerCase()}-${i}` },
      author_association: association,
      body: 'b',
      created_at: new Date(createdAtMillis + i * 1000).toISOString(),
    }));
  }

  it('follows Link rel="next" across pages and concatenates results', async () => {
    const page1 = makeRaw('NONE', 100, Date.UTC(2024, 0, 1));
    const page2 = makeRaw('OWNER', 5, Date.UTC(2024, 1, 1));
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(pageResponse(page1, 'https://api.github.com/repos/x/y/issues/1/comments?page=2'))
      .mockResolvedValueOnce(pageResponse(page2, null));

    const result = await fetchComments('x/y', 1, 'token');
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(result.total_comments).toBe(105);
    expect(result.page_limit_hit).toBe(false);
    expect(result.items.length).toBe(20);
    // 5 OWNER + 15 NONE per cap algorithm
    expect(result.included_associations.OWNER).toBe(5);
    expect(result.included_associations.NONE).toBe(15);
  });

  it('caps at 5 pages and marks page_limit_hit=true', async () => {
    const items = makeRaw('NONE', 100, Date.UTC(2024, 0, 1));
    global.fetch = jest.fn().mockImplementation(() =>
      Promise.resolve(
        pageResponse(items, 'https://api.github.com/repos/x/y/issues/1/comments?page=999')
      )
    );

    const result = await fetchComments('x/y', 1, 'token');
    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(result.page_limit_hit).toBe(true);
    expect(String(result.total_comments)).toMatch(/^>\d+$/);
    expect(result.items.length).toBe(20);
  });

  it('propagates rate-limit error from any page', async () => {
    const reset = Math.floor(Date.now() / 1000) + 60;
    global.fetch = jest.fn().mockResolvedValueOnce({
      ok: false,
      status: 403,
      headers: {
        get: (k) => {
          const v = {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(reset),
            link: '',
          };
          return v[k.toLowerCase()] ?? null;
        },
      },
      text: async () => 'rate limited',
      json: async () => ({}),
    });

    await expect(fetchComments('x/y', 1, 'token')).rejects.toThrow(/rate limit/i);
  });
});

describe('github-issue-fetcher: diff truncation constant (A1.2)', () => {
  let __constants;
  beforeAll(() => {
    ({ __constants } = require(SKILL_PATH));
  });

  it('caps PR diffs at 4000 chars (down from 10000)', () => {
    expect(__constants.DIFF_TRUNCATE_CHARS).toBe(4000);
  });
});
