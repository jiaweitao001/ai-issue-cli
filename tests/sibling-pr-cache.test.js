/**
 * Tests for lib/sibling-pr-cache.js (BS-07 PR-C).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  cacheKey,
  readCache,
  appendEntries,
  lookup,
  removeCacheFile
} = require('../lib/sibling-pr-cache');

function mktmp() {
  return path.join(os.tmpdir(), `sibling-pr-cache-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

describe('cacheKey', () => {
  it('normalizes repo case', () => {
    expect(cacheKey('Foo/Bar', 100)).toBe('foo/bar#100');
  });
  it('accepts string-form numbers', () => {
    expect(cacheKey('x/y', '42')).toBe('x/y#42');
  });
  it('rejects invalid inputs', () => {
    expect(cacheKey('', 100)).toBeNull();
    expect(cacheKey('x/y', 0)).toBeNull();
    expect(cacheKey('x/y', -1)).toBeNull();
    expect(cacheKey('x/y', 'not-a-number')).toBeNull();
    expect(cacheKey(null, 1)).toBeNull();
  });
});

describe('readCache', () => {
  it('returns empty object on missing file', () => {
    const p = mktmp();
    expect(readCache(p)).toEqual({});
  });
  it('returns empty object on null/undefined/empty path', () => {
    expect(readCache(null)).toEqual({});
    expect(readCache(undefined)).toEqual({});
    expect(readCache('')).toEqual({});
  });
  it('returns empty object on parse error', () => {
    const p = mktmp();
    fs.writeFileSync(p, 'not json');
    try {
      expect(readCache(p)).toEqual({});
    } finally {
      fs.unlinkSync(p);
    }
  });
  it('returns empty object on non-object root (array)', () => {
    const p = mktmp();
    fs.writeFileSync(p, '[1,2,3]');
    try {
      expect(readCache(p)).toEqual({});
    } finally {
      fs.unlinkSync(p);
    }
  });
  it('reads back a previously written object', () => {
    const p = mktmp();
    const payload = { 'x/y#1': { pr_number: 2, diff_hunks: [{ file: 'a', hunk: '@@' }] } };
    fs.writeFileSync(p, JSON.stringify(payload));
    try {
      expect(readCache(p)).toEqual(payload);
    } finally {
      fs.unlinkSync(p);
    }
  });
});

describe('appendEntries', () => {
  it('writes a fresh file', () => {
    const p = mktmp();
    try {
      const n = appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: {
          pr_number: 200,
          pr_url: 'https://x/y/200',
          files_changed: ['a.go'],
          diff_hunks: [{ file: 'a.go', hunk: '@@..@@' }],
          diff_truncated: false
        }
      }]);
      expect(n).toBe(1);
      const cache = readCache(p);
      expect(cache['x/y#100']).toEqual({
        pr_number: 200,
        pr_url: 'https://x/y/200',
        files_changed: ['a.go'],
        diff_hunks: [{ file: 'a.go', hunk: '@@..@@' }],
        diff_truncated: false
      });
    } finally {
      removeCacheFile(p);
    }
  });

  it('merges with existing entries (different keys preserved)', () => {
    const p = mktmp();
    try {
      fs.writeFileSync(p, JSON.stringify({
        'x/y#1': { pr_number: 2, diff_hunks: [{ file: 'a', hunk: '@@' }] }
      }));
      appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: { pr_number: 200, diff_hunks: [{ file: 'b', hunk: '@@' }] }
      }]);
      const cache = readCache(p);
      expect(Object.keys(cache).sort()).toEqual(['x/y#1', 'x/y#100']);
    } finally {
      removeCacheFile(p);
    }
  });

  it('newer entry replaces existing key', () => {
    const p = mktmp();
    try {
      appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: { pr_number: 200, diff_hunks: [{ file: 'a', hunk: '@@\n+old' }] }
      }]);
      appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: { pr_number: 200, diff_hunks: [{ file: 'a', hunk: '@@\n+new' }] }
      }]);
      const cache = readCache(p);
      expect(cache['x/y#100'].diff_hunks[0].hunk).toBe('@@\n+new');
    } finally {
      removeCacheFile(p);
    }
  });

  it('skips items missing linked_pr', () => {
    const p = mktmp();
    try {
      const n = appendEntries(p, 'x/y', [
        { issue: 1 },
        { issue: 2, linked_pr: null },
        { issue: 3, linked_pr: {} }
      ]);
      expect(n).toBe(0);
      expect(fs.existsSync(p)).toBe(false);
    } finally {
      removeCacheFile(p);
    }
  });

  it('skips items with empty diff_hunks', () => {
    const p = mktmp();
    try {
      const n = appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: { pr_number: 200, diff_hunks: [] }
      }]);
      expect(n).toBe(0);
    } finally {
      removeCacheFile(p);
    }
  });

  it('drops malformed hunks but keeps valid siblings', () => {
    const p = mktmp();
    try {
      appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: {
          pr_number: 200,
          diff_hunks: [
            { file: 'a.go', hunk: '@@' },
            null,
            { file: 123 },
            { hunk: '@@' },
            { file: 'b.go', hunk: '@@' }
          ]
        }
      }]);
      const cache = readCache(p);
      expect(cache['x/y#100'].diff_hunks).toEqual([
        { file: 'a.go', hunk: '@@' },
        { file: 'b.go', hunk: '@@' }
      ]);
    } finally {
      removeCacheFile(p);
    }
  });

  it('accepts both pr_number / number and pr_url / url aliases', () => {
    const p = mktmp();
    try {
      appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: {
          number: 200,
          url: 'https://x/y/200',
          diff_hunks: [{ file: 'a', hunk: '@@' }]
        }
      }]);
      const cache = readCache(p);
      expect(cache['x/y#100'].pr_number).toBe(200);
      expect(cache['x/y#100'].pr_url).toBe('https://x/y/200');
    } finally {
      removeCacheFile(p);
    }
  });

  it('returns 0 and is a no-op when path is empty / null', () => {
    expect(appendEntries('', 'x/y', [{ issue: 1, linked_pr: {} }])).toBe(0);
    expect(appendEntries(null, 'x/y', [])).toBe(0);
  });

  it('returns 0 when items list is empty', () => {
    const p = mktmp();
    expect(appendEntries(p, 'x/y', [])).toBe(0);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('creates parent directory when missing', () => {
    const dir = path.join(os.tmpdir(), `spc-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    const p = path.join(dir, 'nested', 'cache.json');
    try {
      const n = appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: { pr_number: 200, diff_hunks: [{ file: 'a', hunk: '@@' }] }
      }]);
      expect(n).toBe(1);
      expect(fs.existsSync(p)).toBe(true);
    } finally {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_e) { /* */ }
    }
  });

  it('does not leave .tmp siblings when the rename succeeds', () => {
    const p = mktmp();
    try {
      appendEntries(p, 'x/y', [{
        issue: 100,
        linked_pr: { pr_number: 200, diff_hunks: [{ file: 'a', hunk: '@@' }] }
      }]);
      const dir = path.dirname(p);
      const base = path.basename(p);
      const leftover = fs.readdirSync(dir).filter(f => f.startsWith(base) && f.endsWith('.tmp'));
      expect(leftover).toEqual([]);
    } finally {
      removeCacheFile(p);
    }
  });
});

describe('lookup', () => {
  const goodCache = {
    'x/y#100': {
      pr_number: 200,
      diff_hunks: [{ file: 'a', hunk: '@@' }]
    },
    'x/y#101': {
      pr_number: 0, // invalid
      diff_hunks: [{ file: 'a', hunk: '@@' }]
    },
    'x/y#102': {
      pr_number: 200,
      diff_hunks: [] // empty
    }
  };

  it('finds a valid entry case-insensitively', () => {
    const r = lookup(goodCache, 'X/Y', 100);
    expect(r).not.toBeNull();
    expect(r.pr_number).toBe(200);
  });
  it('returns null on miss', () => {
    expect(lookup(goodCache, 'x/y', 999)).toBeNull();
  });
  it('returns null on invalid pr_number', () => {
    expect(lookup(goodCache, 'x/y', 101)).toBeNull();
  });
  it('returns null on empty diff_hunks', () => {
    expect(lookup(goodCache, 'x/y', 102)).toBeNull();
  });
  it('returns null on malformed cache', () => {
    expect(lookup(null, 'x/y', 100)).toBeNull();
    expect(lookup({ 'x/y#100': null }, 'x/y', 100)).toBeNull();
    expect(lookup({ 'x/y#100': 'string' }, 'x/y', 100)).toBeNull();
  });
});

describe('removeCacheFile', () => {
  it('deletes an existing file', () => {
    const p = mktmp();
    fs.writeFileSync(p, '{}');
    removeCacheFile(p);
    expect(fs.existsSync(p)).toBe(false);
  });
  it('is a no-op when file does not exist', () => {
    const p = mktmp();
    expect(() => removeCacheFile(p)).not.toThrow();
  });
  it('is a no-op on null/empty path', () => {
    expect(() => removeCacheFile(null)).not.toThrow();
    expect(() => removeCacheFile('')).not.toThrow();
    expect(() => removeCacheFile(undefined)).not.toThrow();
  });
  it('sweeps leftover .tmp siblings from a crashed mid-rename write', () => {
    const p = mktmp();
    const dir = path.dirname(p);
    const base = path.basename(p);
    const orphan1 = path.join(dir, `${base}.12345.1700000000000.tmp`);
    const orphan2 = path.join(dir, `${base}.99999.1700000099999.tmp`);
    // Unrelated file in the same dir that must NOT be deleted
    const unrelated = path.join(dir, `unrelated-${process.pid}-${Date.now()}.tmp`);
    fs.writeFileSync(p, '{}');
    fs.writeFileSync(orphan1, 'partial');
    fs.writeFileSync(orphan2, 'partial');
    fs.writeFileSync(unrelated, 'keep me');
    try {
      removeCacheFile(p);
      expect(fs.existsSync(p)).toBe(false);
      expect(fs.existsSync(orphan1)).toBe(false);
      expect(fs.existsSync(orphan2)).toBe(false);
      expect(fs.existsSync(unrelated)).toBe(true);
    } finally {
      try { fs.unlinkSync(unrelated); } catch (_e) { /* */ }
    }
  });
});

describe('concurrent / sequential merge correctness', () => {
  it('two appendEntries on same key keep the last-write content', () => {
    const p = mktmp();
    try {
      appendEntries(p, 'x/y', [{
        issue: 1,
        linked_pr: { pr_number: 100, diff_hunks: [{ file: 'a', hunk: '@@\n+v1' }] }
      }]);
      appendEntries(p, 'x/y', [{
        issue: 2,
        linked_pr: { pr_number: 101, diff_hunks: [{ file: 'b', hunk: '@@\n+v2' }] }
      }]);
      appendEntries(p, 'x/y', [{
        issue: 1,
        linked_pr: { pr_number: 100, diff_hunks: [{ file: 'a', hunk: '@@\n+v1prime' }] }
      }]);
      const cache = readCache(p);
      expect(Object.keys(cache).sort()).toEqual(['x/y#1', 'x/y#2']);
      expect(cache['x/y#1'].diff_hunks[0].hunk).toBe('@@\n+v1prime');
      expect(cache['x/y#2'].diff_hunks[0].hunk).toBe('@@\n+v2');
    } finally {
      removeCacheFile(p);
    }
  });
});
