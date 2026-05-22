/**
 * Tests for lib/sibling-pr-diffs.js
 */

const {
  buildSiblingPrDiffsSection,
  parseSimilarIssues,
  parseIssueCell,
  extractSection,
  renderSection
} = require('../lib/sibling-pr-diffs');

const SAMPLE_REPORT = `# Issue #30340 Research Report

## Problem Classification

**Type**: 🔧 CODE_CHANGE

## Similar Historical Issues

| Score | Issue | State | Applicable? |
|-------|-------|-------|---------|
| 0.87 | [#28765 - Storage table entity 404 not handled](https://github.com/hashicorp/terraform-provider-azurerm/issues/28765) | closed | Yes — same pattern |
| 0.81 | [#28925 - Read function missing nil check](https://github.com/hashicorp/terraform-provider-azurerm/issues/28925) | closed | Yes |
| 0.42 | [#10001 - Unrelated typo](https://github.com/hashicorp/terraform-provider-azurerm/issues/10001) | closed | No |

**Extracted Solutions**: Use response.WasNotFound

## Code Location

- Main file: \`internal/services/storage/foo.go\`
`;

describe('extractSection', () => {
  it('returns section body up to next ## header', () => {
    const body = extractSection(SAMPLE_REPORT, '## Similar Historical Issues');
    expect(body).toBeTruthy();
    expect(body).toContain('| Score | Issue');
    expect(body).not.toContain('## Code Location');
  });

  it('returns null when header not present', () => {
    expect(extractSection(SAMPLE_REPORT, '## Nonexistent')).toBeNull();
  });

  it('handles empty input', () => {
    expect(extractSection('', '## X')).toBeNull();
  });
});

describe('parseIssueCell', () => {
  it('parses a standard issue Markdown link', () => {
    const cell = '[#28765 - title here](https://github.com/foo/bar/issues/28765)';
    const out = parseIssueCell(cell);
    expect(out).toEqual({
      repo: 'foo/bar',
      issueNumber: 28765,
      url: 'https://github.com/foo/bar/issues/28765',
      title: 'title here'
    });
  });

  it('parses pull/<n> URL too', () => {
    const cell = '[#3 - x](https://github.com/foo/bar/pull/3)';
    expect(parseIssueCell(cell).issueNumber).toBe(3);
  });

  it('returns null for cells without a link', () => {
    expect(parseIssueCell('just plain text')).toBeNull();
  });

  it('returns null for URLs that are not github.com/.../issues/N', () => {
    expect(parseIssueCell('[x](https://gitlab.com/foo/bar/issues/1)')).toBeNull();
  });

  it('returns null for missing input', () => {
    expect(parseIssueCell('')).toBeNull();
    expect(parseIssueCell(undefined)).toBeNull();
  });
});

describe('parseSimilarIssues', () => {
  it('extracts ordered refs from a real-shape report', () => {
    const refs = parseSimilarIssues(SAMPLE_REPORT);
    expect(refs).toHaveLength(3);
    expect(refs[0].score).toBeCloseTo(0.87);
    expect(refs[0].issueNumber).toBe(28765);
    expect(refs[1].issueNumber).toBe(28925);
    expect(refs[2].score).toBeCloseTo(0.42);
  });

  it('skips header / separator rows', () => {
    const report = `## Similar Historical Issues

| Score | Issue | State | Applicable? |
|-------|-------|-------|---------|
| 0.9 | [#1 - x](https://github.com/a/b/issues/1) | open | Yes |
`;
    expect(parseSimilarIssues(report)).toHaveLength(1);
  });

  it('returns empty array when section absent', () => {
    expect(parseSimilarIssues('# something else')).toEqual([]);
  });

  it('returns empty array for non-string input', () => {
    // @ts-ignore deliberately wrong type
    expect(parseSimilarIssues(null)).toEqual([]);
    // @ts-ignore deliberately wrong type
    expect(parseSimilarIssues(42)).toEqual([]);
  });

  it('tolerates extra columns / whitespace', () => {
    const report = `## Similar Historical Issues

|   Score   |   Issue   |   State   |   Applicable?   |
|---|---|---|---|
|   0.95   |   [#7 - x](https://github.com/a/b/issues/7)   |   closed   |   Yes — same   |
`;
    const refs = parseSimilarIssues(report);
    expect(refs).toHaveLength(1);
    expect(refs[0].score).toBeCloseTo(0.95);
  });
});

describe('renderSection', () => {
  it('returns empty string when no packed PRs', () => {
    expect(renderSection([], 0)).toBe('');
  });

  it('renders a PR block with hunks and score', () => {
    const packed = [{
      ref: { repo: 'a/b', issueNumber: 1, url: '', score: 0.9, title: 'foo' },
      prNumber: 10,
      hunks: [{ file: 'x.go', hunk: '@@ -1,1 +1,2 @@\n+line' }],
      omittedHunks: 0
    }];
    const out = renderSection(packed, 0);
    expect(out).toContain('## Sibling PR Diffs');
    expect(out).toContain('PR #10');
    expect(out).toContain('Score 0.90');
    expect(out).toContain('Issue #1');
    expect(out).toContain('// x.go');
    expect(out).toContain('+line');
  });

  it('adds the per-PR omitted warning when hunks were dropped', () => {
    const packed = [{
      ref: { repo: 'a/b', issueNumber: 1, url: '', score: 0.9, title: '' },
      prNumber: 10,
      hunks: [{ file: 'x.go', hunk: '@@\n+line' }],
      omittedHunks: 3
    }];
    expect(renderSection(packed, 3)).toMatch(/3 hunks omitted from this PR/);
  });
});

describe('buildSiblingPrDiffsSection', () => {
  function mkOpts(over = {}) {
    return {
      researchContent: SAMPLE_REPORT,
      config: { githubToken: 't' },
      issueNumber: 30340,
      resolvePrForIssueImpl: jest.fn(async (_repo, n) => n + 100),
      fetchPrDiffImpl: jest.fn(async (_repo, prN) => ({
        number: prN,
        files_changed: ['internal/services/storage/foo.go'],
        hunks: [{
          file: 'internal/services/storage/foo.go',
          hunk: '@@ -120,5 +120,8 @@\n+if response.WasNotFound(...) { d.SetId(""); return nil }'
        }]
      })),
      ...over
    };
  }

  it('returns null on missing / invalid input', async () => {
    expect(await buildSiblingPrDiffsSection(null)).toBeNull();
    expect(await buildSiblingPrDiffsSection({})).toBeNull();
    expect(await buildSiblingPrDiffsSection({ researchContent: 123 })).toBeNull();
  });

  it('returns null when no similar issues parsed', async () => {
    const out = await buildSiblingPrDiffsSection(mkOpts({
      researchContent: '# nothing here'
    }));
    expect(out).toBeNull();
  });

  it('filters by score threshold', async () => {
    const out = await buildSiblingPrDiffsSection(mkOpts({
      scoreThreshold: 0.95
    }));
    expect(out).toBeNull();
  });

  it('caps PRs by maxPrs', async () => {
    const out = await buildSiblingPrDiffsSection(mkOpts({ maxPrs: 1 }));
    expect(out).not.toBeNull();
    const prCount = (out.match(/^### PR #/gm) || []).length;
    expect(prCount).toBe(1);
  });

  it('skips PRs that fail to resolve', async () => {
    const resolvePrForIssueImpl = jest.fn(async (_r, n) => (n === 28765 ? 28800 : null));
    const out = await buildSiblingPrDiffsSection(mkOpts({ resolvePrForIssueImpl }));
    expect(out).not.toBeNull();
    expect((out.match(/^### PR #/gm) || []).length).toBe(1);
    expect(out).toContain('PR #28800');
  });

  it('skips PRs whose diff fetch returns null', async () => {
    const fetchPrDiffImpl = jest.fn(async () => null);
    const out = await buildSiblingPrDiffsSection(mkOpts({ fetchPrDiffImpl }));
    expect(out).toBeNull();
  });

  it('does not throw when resolvePrForIssue throws', async () => {
    const resolvePrForIssueImpl = jest.fn(async () => { throw new Error('boom'); });
    const out = await buildSiblingPrDiffsSection(mkOpts({ resolvePrForIssueImpl }));
    expect(out).toBeNull();
  });

  it('returns null when packing drops every PR (no orphan headers)', async () => {
    const fetchPrDiffImpl = jest.fn(async (_r, prN) => ({
      number: prN,
      files_changed: ['vendor/x.go'],
      hunks: [{ file: 'vendor/x.go', hunk: '@@\n+x' }]
    }));
    const out = await buildSiblingPrDiffsSection(mkOpts({ fetchPrDiffImpl }));
    expect(out).toBeNull();
  });

  it('passes githubToken through to fetcher', async () => {
    const resolvePrForIssueImpl = jest.fn(async () => 100);
    const fetchPrDiffImpl = jest.fn(async () => ({
      number: 100,
      files_changed: ['x.go'],
      hunks: [{ file: 'x.go', hunk: '@@\n+x' }]
    }));
    await buildSiblingPrDiffsSection(mkOpts({
      resolvePrForIssueImpl,
      fetchPrDiffImpl,
      config: { githubToken: 'shh' }
    }));
    expect(fetchPrDiffImpl).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Number),
      expect.objectContaining({ githubToken: 'shh' })
    );
  });
});

describe('buildSiblingPrDiffsSection — cache integration (BS-07 PR-C)', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');

  function mkOpts(over = {}) {
    return {
      researchContent: SAMPLE_REPORT,
      config: { githubToken: 't' },
      issueNumber: 30340,
      resolvePrForIssueImpl: jest.fn(async (_repo, n) => n + 100),
      fetchPrDiffImpl: jest.fn(async (_repo, prN) => ({
        number: prN,
        files_changed: ['internal/services/storage/foo.go'],
        hunks: [{
          file: 'internal/services/storage/foo.go',
          hunk: '@@ -120,5 +120,8 @@\n+if response.WasNotFound(...) { d.SetId(""); return nil }'
        }]
      })),
      ...over
    };
  }

  function mktmpCache(payload) {
    const p = path.join(os.tmpdir(), `sibling-pr-diffs-cache-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(p, JSON.stringify(payload));
    return p;
  }

  afterEach(() => {
    delete process.env.AI_ISSUE_SIBLING_PR_CACHE_PATH;
  });

  it('uses cached PR data and skips GitHub fetchers entirely on full hit', async () => {
    const cachePath = mktmpCache({
      'hashicorp/terraform-provider-azurerm#28765': {
        pr_number: 28800,
        pr_url: 'https://github.com/hashicorp/terraform-provider-azurerm/pull/28800',
        files_changed: ['internal/services/storage/foo.go'],
        diff_hunks: [{
          file: 'internal/services/storage/foo.go',
          hunk: '@@ -1,3 +1,4 @@\n+from cache'
        }],
        diff_truncated: false
      },
      'hashicorp/terraform-provider-azurerm#28925': {
        pr_number: 28950,
        pr_url: 'https://github.com/hashicorp/terraform-provider-azurerm/pull/28950',
        files_changed: ['internal/services/storage/bar.go'],
        diff_hunks: [{
          file: 'internal/services/storage/bar.go',
          hunk: '@@ -1,3 +1,4 @@\n+also from cache'
        }],
        diff_truncated: false
      }
    });
    try {
      const opts = mkOpts({ cachePath });
      const out = await buildSiblingPrDiffsSection(opts);
      expect(out).not.toBeNull();
      expect(out).toContain('from cache');
      expect(out).toContain('PR #28800');
      expect(out).toContain('PR #28950');
      expect(opts.resolvePrForIssueImpl).not.toHaveBeenCalled();
      expect(opts.fetchPrDiffImpl).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(cachePath);
    }
  });

  it('falls through to GitHub for cache misses, hybrid path', async () => {
    const cachePath = mktmpCache({
      'hashicorp/terraform-provider-azurerm#28765': {
        pr_number: 28800,
        pr_url: '',
        files_changed: ['internal/services/storage/foo.go'],
        diff_hunks: [{
          file: 'internal/services/storage/foo.go',
          hunk: '@@\n+cached one'
        }],
        diff_truncated: false
      }
      // #28925 is intentionally NOT cached → forced to GitHub fallback
    });
    try {
      const opts = mkOpts({ cachePath });
      const out = await buildSiblingPrDiffsSection(opts);
      expect(out).not.toBeNull();
      // The cache provided #28765 → PR #28800; the resolver should only
      // have been called for the un-cached #28925.
      expect(opts.resolvePrForIssueImpl).toHaveBeenCalledTimes(1);
      expect(opts.resolvePrForIssueImpl).toHaveBeenCalledWith(
        'hashicorp/terraform-provider-azurerm',
        28925,
        expect.anything()
      );
      // PR #28800 came from cache (not via resolver math), so the section
      // mentions both PR numbers.
      expect(out).toContain('PR #28800');
      expect(out).toContain('cached one');
    } finally {
      fs.unlinkSync(cachePath);
    }
  });

  it('handles a corrupt cache file by falling back to GitHub for all refs', async () => {
    const cachePath = path.join(os.tmpdir(), `bad-cache-${process.pid}-${Date.now()}.json`);
    fs.writeFileSync(cachePath, 'not json at all');
    try {
      const opts = mkOpts({ cachePath });
      const out = await buildSiblingPrDiffsSection(opts);
      expect(out).not.toBeNull();
      // Bad cache → cache lookups return null → GitHub fallback for both
      // qualifying refs.
      expect(opts.resolvePrForIssueImpl).toHaveBeenCalledTimes(2);
      expect(opts.fetchPrDiffImpl).toHaveBeenCalledTimes(2);
    } finally {
      fs.unlinkSync(cachePath);
    }
  });

  it('honors AI_ISSUE_SIBLING_PR_CACHE_PATH env var when opts.cachePath is unset', async () => {
    const cachePath = mktmpCache({
      'hashicorp/terraform-provider-azurerm#28765': {
        pr_number: 28800,
        pr_url: '',
        files_changed: ['x.go'],
        diff_hunks: [{ file: 'x.go', hunk: '@@\n+envvar-cached' }],
        diff_truncated: false
      },
      'hashicorp/terraform-provider-azurerm#28925': {
        pr_number: 28950,
        pr_url: '',
        files_changed: ['y.go'],
        diff_hunks: [{ file: 'y.go', hunk: '@@\n+envvar-cached2' }],
        diff_truncated: false
      }
    });
    process.env.AI_ISSUE_SIBLING_PR_CACHE_PATH = cachePath;
    try {
      const opts = mkOpts(); // no cachePath
      const out = await buildSiblingPrDiffsSection(opts);
      expect(out).not.toBeNull();
      expect(out).toContain('envvar-cached');
      expect(opts.resolvePrForIssueImpl).not.toHaveBeenCalled();
    } finally {
      fs.unlinkSync(cachePath);
    }
  });

  it('is a no-op (uses GitHub) when env var points at a non-existent file', async () => {
    const cachePath = path.join(os.tmpdir(), `non-existent-${process.pid}-${Date.now()}.json`);
    const opts = mkOpts({ cachePath });
    const out = await buildSiblingPrDiffsSection(opts);
    expect(out).not.toBeNull();
    expect(opts.resolvePrForIssueImpl).toHaveBeenCalledTimes(2);
  });

  it('ignores cache entries with empty diff_hunks (treats as miss)', async () => {
    const cachePath = mktmpCache({
      'hashicorp/terraform-provider-azurerm#28765': {
        pr_number: 28800,
        pr_url: '',
        files_changed: ['x.go'],
        diff_hunks: [], // empty → lookup returns null
        diff_truncated: true
      }
    });
    try {
      const opts = mkOpts({ cachePath });
      const out = await buildSiblingPrDiffsSection(opts);
      expect(out).not.toBeNull();
      // #28765 missed (empty hunks) → goes to GitHub; #28925 also un-cached.
      expect(opts.resolvePrForIssueImpl).toHaveBeenCalledTimes(2);
    } finally {
      fs.unlinkSync(cachePath);
    }
  });
});
