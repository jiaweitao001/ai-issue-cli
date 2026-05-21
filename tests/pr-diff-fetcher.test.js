/**
 * Tests for lib/pr-diff-fetcher.js
 */

const {
  fetchPrDiff,
  resolvePrForIssue,
  splitPatchIntoHunks,
  LruCache
} = require('../lib/pr-diff-fetcher');

function makeResponse({ ok = true, body }) {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

describe('LruCache', () => {
  it('returns undefined on miss', () => {
    const c = new LruCache(2);
    expect(c.get('a')).toBeUndefined();
  });

  it('stores and retrieves values', () => {
    const c = new LruCache(2);
    // @ts-ignore -- LruCache value type is FetchedDiff but we use anys in tests
    c.set('a', 'A');
    expect(c.get('a')).toBe('A');
  });

  it('evicts oldest entry when capacity exceeded', () => {
    const c = new LruCache(2);
    // @ts-ignore
    c.set('a', 1); c.set('b', 2); c.set('c', 3);
    expect(c.get('a')).toBeUndefined();
    expect(c.get('b')).toBe(2);
    expect(c.get('c')).toBe(3);
  });

  it('promotes recently-read entry to most-recent', () => {
    const c = new LruCache(2);
    // @ts-ignore
    c.set('a', 1); c.set('b', 2);
    c.get('a');
    // @ts-ignore
    c.set('c', 3);
    expect(c.get('a')).toBe(1);
    expect(c.get('b')).toBeUndefined();
  });

  it('caches null values (negative caching)', () => {
    const c = new LruCache(2);
    // @ts-ignore
    c.set('a', null);
    expect(c.get('a')).toBeNull();
  });
});

describe('splitPatchIntoHunks', () => {
  it('returns empty array for empty input', () => {
    expect(splitPatchIntoHunks('')).toEqual([]);
    expect(splitPatchIntoHunks(undefined)).toEqual([]);
  });

  it('splits a single-hunk patch', () => {
    const patch = '@@ -1,3 +1,4 @@\n line1\n+line2\n line3';
    const hunks = splitPatchIntoHunks(patch);
    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toContain('@@ -1,3 +1,4 @@');
  });

  it('splits a multi-hunk patch', () => {
    const patch = [
      '@@ -1,2 +1,3 @@',
      ' a',
      '+b',
      '@@ -10,2 +11,3 @@',
      ' x',
      '+y'
    ].join('\n');
    const hunks = splitPatchIntoHunks(patch);
    expect(hunks).toHaveLength(2);
    expect(hunks[0]).toMatch(/^@@ -1,2/);
    expect(hunks[1]).toMatch(/^@@ -10,2/);
  });

  it('ignores leading non-hunk lines', () => {
    const patch = 'noise\nmore noise\n@@ -1,1 +1,1 @@\n line';
    const hunks = splitPatchIntoHunks(patch);
    expect(hunks).toHaveLength(1);
  });
});

describe('fetchPrDiff', () => {
  it('returns null for invalid inputs', async () => {
    expect(await fetchPrDiff('', 1)).toBeNull();
    expect(await fetchPrDiff('a/b', 0)).toBeNull();
    expect(await fetchPrDiff('a/b', -1)).toBeNull();
    expect(await fetchPrDiff('a/b', 1.5)).toBeNull();
  });

  it('caches PR responses across calls with the same repo+PR', async () => {
    const cache = new LruCache(10);
    const fetchImpl = jest.fn(async () => makeResponse({
      body: [{ filename: 'a.go', patch: '@@ -1,1 +1,2 @@\n+line' }]
    }));
    const r1 = await fetchPrDiff('a/b', 7, { cache, fetchImpl });
    const r2 = await fetchPrDiff('a/b', 7, { cache, fetchImpl });
    expect(r1).toEqual(r2);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null and caches negative result on non-OK response', async () => {
    const cache = new LruCache(10);
    const fetchImpl = jest.fn(async () => makeResponse({ ok: false, body: {} }));
    const r = await fetchPrDiff('a/b', 7, { cache, fetchImpl });
    expect(r).toBeNull();
    await fetchPrDiff('a/b', 7, { cache, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null on fetch throw, caches negative result', async () => {
    const cache = new LruCache(10);
    const fetchImpl = jest.fn(async () => { throw new Error('net down'); });
    const r = await fetchPrDiff('a/b', 7, { cache, fetchImpl });
    expect(r).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('returns null when files array is empty', async () => {
    const cache = new LruCache(10);
    const fetchImpl = jest.fn(async () => makeResponse({ body: [] }));
    expect(await fetchPrDiff('a/b', 7, { cache, fetchImpl })).toBeNull();
  });

  it('handles entries without patch (binary files etc.)', async () => {
    const cache = new LruCache(10);
    const fetchImpl = jest.fn(async () => makeResponse({
      body: [
        { filename: 'bin.png' },
        { filename: 'a.go', patch: '@@ -1,1 +1,2 @@\n+line' }
      ]
    }));
    const r = await fetchPrDiff('a/b', 7, { cache, fetchImpl });
    expect(r).not.toBeNull();
    // @ts-ignore narrow
    expect(r.files_changed).toEqual(['bin.png', 'a.go']);
    // @ts-ignore narrow
    expect(r.hunks).toHaveLength(1);
    // @ts-ignore narrow
    expect(r.hunks[0].file).toBe('a.go');
  });

  it('sends Authorization header when token is provided', async () => {
    const cache = new LruCache(10);
    const fetchImpl = jest.fn(async () => makeResponse({
      body: [{ filename: 'a.go', patch: '@@ -1,1 +1,1 @@\n+x' }]
    }));
    await fetchPrDiff('a/b', 7, { cache, fetchImpl, githubToken: 'secret-token' });
    const calledHeaders = fetchImpl.mock.calls[0][1].headers;
    expect(calledHeaders['Authorization']).toBe('Bearer secret-token');
  });

  it('omits Authorization header when no token', async () => {
    const cache = new LruCache(10);
    const fetchImpl = jest.fn(async () => makeResponse({
      body: [{ filename: 'a.go', patch: '@@ -1,1 +1,1 @@\n+x' }]
    }));
    await fetchPrDiff('a/b', 7, { cache, fetchImpl });
    const calledHeaders = fetchImpl.mock.calls[0][1].headers;
    expect(calledHeaders['Authorization']).toBeUndefined();
  });
});

describe('resolvePrForIssue', () => {
  it('returns null for invalid inputs', async () => {
    expect(await resolvePrForIssue('', 1)).toBeNull();
    expect(await resolvePrForIssue('a/b', 0)).toBeNull();
  });

  it('returns the merged cross-referenced PR number', async () => {
    const fetchImpl = jest.fn(async () => makeResponse({
      body: [
        { event: 'labeled' },
        {
          event: 'cross-referenced',
          source: { issue: { number: 99, pull_request: { merged_at: '2024-01-02T00:00:00Z' } } }
        }
      ]
    }));
    expect(await resolvePrForIssue('a/b', 7, { fetchImpl })).toBe(99);
  });

  it('returns the most recent merged PR when multiple exist', async () => {
    const fetchImpl = jest.fn(async () => makeResponse({
      body: [
        {
          event: 'cross-referenced',
          source: { issue: { number: 1, pull_request: { merged_at: '2024-01-01T00:00:00Z' } } }
        },
        {
          event: 'cross-referenced',
          source: { issue: { number: 2, pull_request: { merged_at: '2024-06-01T00:00:00Z' } } }
        },
        {
          event: 'cross-referenced',
          source: { issue: { number: 3, pull_request: { merged_at: '2024-03-01T00:00:00Z' } } }
        }
      ]
    }));
    expect(await resolvePrForIssue('a/b', 7, { fetchImpl })).toBe(2);
  });

  it('skips unmerged cross-references', async () => {
    const fetchImpl = jest.fn(async () => makeResponse({
      body: [
        {
          event: 'cross-referenced',
          source: { issue: { number: 1, pull_request: { merged_at: null } } }
        }
      ]
    }));
    expect(await resolvePrForIssue('a/b', 7, { fetchImpl })).toBeNull();
  });

  it('returns null on non-OK response', async () => {
    const fetchImpl = jest.fn(async () => makeResponse({ ok: false, body: {} }));
    expect(await resolvePrForIssue('a/b', 7, { fetchImpl })).toBeNull();
  });

  it('returns null on fetch throw', async () => {
    const fetchImpl = jest.fn(async () => { throw new Error('boom'); });
    expect(await resolvePrForIssue('a/b', 7, { fetchImpl })).toBeNull();
  });
});
