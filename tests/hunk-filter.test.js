/**
 * Tests for lib/hunk-filter.js — pure-function packing algorithm.
 */

const {
  packPrs,
  estimateTokens,
  isGeneratedPath,
  truncateHunkLines,
  sortHunksByRelevance
} = require('../lib/hunk-filter');

function makeHunk(file, lines = 5) {
  const body = Array.from({ length: lines }, (_, i) => `+ line ${i + 1}`).join('\n');
  return { file, hunk: `@@ -1,${lines} +1,${lines} @@\n${body}` };
}

function makePr(number, score, hunks) {
  return { number, score, title: `PR #${number}`, hunks };
}

describe('hunk-filter', () => {
  describe('estimateTokens', () => {
    it('returns 0 for empty / null', () => {
      expect(estimateTokens('')).toBe(0);
      // @ts-ignore intentional null
      expect(estimateTokens(null)).toBe(0);
    });

    it('estimates roughly chars / 4', () => {
      expect(estimateTokens('a'.repeat(40))).toBe(10);
      expect(estimateTokens('a'.repeat(41))).toBe(11);
    });
  });

  describe('isGeneratedPath', () => {
    it('detects vendor/, *_gen.go, *.pb.go, node_modules/, .terraform/', () => {
      expect(isGeneratedPath('vendor/foo/bar.go')).toBe(true);
      expect(isGeneratedPath('internal/services/foo/vendor/x.go')).toBe(true);
      expect(isGeneratedPath('internal/foo_gen.go')).toBe(true);
      expect(isGeneratedPath('proto/x.pb.go')).toBe(true);
      expect(isGeneratedPath('node_modules/x.js')).toBe(true);
      expect(isGeneratedPath('.terraform/providers/x')).toBe(true);
    });

    it('does NOT flag normal paths', () => {
      expect(isGeneratedPath('internal/services/foo/foo_resource.go')).toBe(false);
      expect(isGeneratedPath('internal/services/foo/foo_resource_test.go')).toBe(false);
      expect(isGeneratedPath('lib/utils.js')).toBe(false);
    });

    it('handles empty / missing input gracefully', () => {
      expect(isGeneratedPath('')).toBe(false);
      // @ts-ignore
      expect(isGeneratedPath(undefined)).toBe(false);
    });
  });

  describe('truncateHunkLines', () => {
    it('returns input unchanged when within budget', () => {
      const body = ['a', 'b', 'c'].join('\n');
      expect(truncateHunkLines(body, 40)).toBe(body);
    });

    it('truncates and appends marker when over budget', () => {
      const body = Array.from({ length: 50 }, (_, i) => `line ${i}`).join('\n');
      const out = truncateHunkLines(body, 40);
      const lines = out.split('\n');
      expect(lines).toHaveLength(41);
      expect(lines[40]).toMatch(/10 more lines omitted/);
    });

    it('handles empty / null body', () => {
      expect(truncateHunkLines('', 10)).toBe('');
      // @ts-ignore
      expect(truncateHunkLines(null, 10)).toBe('');
    });
  });

  describe('sortHunksByRelevance', () => {
    it('returns input unchanged when no currentIssueFiles', () => {
      const hunks = [makeHunk('a.go'), makeHunk('b.go')];
      expect(sortHunksByRelevance(hunks, [])).toEqual(hunks);
    });

    it('puts matched files first, preserves relative order for ties', () => {
      const hunks = [makeHunk('a.go'), makeHunk('b.go'), makeHunk('c.go'), makeHunk('d.go')];
      const sorted = sortHunksByRelevance(hunks, ['b.go', 'd.go']);
      expect(sorted.map(h => h.file)).toEqual(['b.go', 'd.go', 'a.go', 'c.go']);
    });

    it('matches by trailing-path suffix', () => {
      const hunks = [makeHunk('internal/services/foo/x.go'), makeHunk('z.go')];
      const sorted = sortHunksByRelevance(hunks, ['x.go']);
      expect(sorted[0].file).toBe('internal/services/foo/x.go');
    });
  });

  describe('packPrs', () => {
    it('returns empty result for empty input', () => {
      const r = packPrs([]);
      expect(r.packed).toEqual([]);
      expect(r.totalUsedTokens).toBe(0);
      expect(r.totalOmittedHunks).toBe(0);
      expect(r.droppedPrs).toBe(0);
    });

    it('drops PRs below score threshold', () => {
      const prs = [makePr(1, 0.9, [makeHunk('a.go')]), makePr(2, 0.5, [makeHunk('b.go')])];
      const r = packPrs(prs);
      expect(r.packed).toHaveLength(1);
      expect(r.packed[0].pr.number).toBe(1);
    });

    it('honours custom scoreThreshold', () => {
      const prs = [makePr(1, 0.65, [makeHunk('a.go')])];
      const lo = packPrs(prs, { scoreThreshold: 0.5 });
      const hi = packPrs(prs, { scoreThreshold: 0.7 });
      expect(lo.packed).toHaveLength(1);
      expect(hi.packed).toHaveLength(0);
    });

    it('caps hunks per PR', () => {
      const hunks = Array.from({ length: 10 }, (_, i) => makeHunk(`f${i}.go`));
      const r = packPrs([makePr(1, 0.9, hunks)], { maxHunksPerPr: 3 });
      expect(r.packed[0].hunks).toHaveLength(3);
      expect(r.packed[0].omittedHunks).toBe(7);
    });

    it('drops a PR when no hunks fit (no orphan headers)', () => {
      const huge = { file: 'huge.go', hunk: 'x'.repeat(99999) };
      const r = packPrs([makePr(1, 0.9, [huge]), makePr(2, 0.85, [makeHunk('b.go')])], {
        maxTotalTokens: 50,
        maxLinesPerHunk: 99999
      });
      expect(r.packed.find(p => p.pr.number === 1)).toBeUndefined();
      expect(r.droppedPrs).toBeGreaterThanOrEqual(1);
    });

    it('stops processing more PRs after soft-stop (0.9 * cap) reached', () => {
      const bigHunks = Array.from({ length: 6 }, (_, i) =>
        ({ file: `f${i}.go`, hunk: 'x'.repeat(600) })
      );
      const r = packPrs([
        makePr(1, 0.95, bigHunks),
        makePr(2, 0.94, [makeHunk('y.go')])
      ], { maxTotalTokens: 1000, maxHunksPerPr: 10 });
      expect(r.totalUsedTokens).toBeGreaterThan(900);
      expect(r.totalUsedTokens).toBeLessThanOrEqual(1000);
      expect(r.packed.find(p => p.pr.number === 2)).toBeUndefined();
    });

    it('respects skipGeneratedPaths by default', () => {
      const prs = [makePr(1, 0.9, [makeHunk('vendor/x.go'), makeHunk('foo.go')])];
      const r = packPrs(prs);
      expect(r.packed[0].hunks).toHaveLength(1);
      expect(r.packed[0].hunks[0].file).toBe('foo.go');
    });

    it('can opt out of skipGeneratedPaths', () => {
      const prs = [makePr(1, 0.9, [makeHunk('vendor/x.go'), makeHunk('foo.go')])];
      const r = packPrs(prs, { skipGeneratedPaths: false });
      expect(r.packed[0].hunks).toHaveLength(2);
    });

    it('prioritises hunks matching currentIssueFiles', () => {
      const prs = [makePr(1, 0.9, [
        makeHunk('unrelated.go'),
        makeHunk('important.go'),
        makeHunk('also-unrelated.go')
      ])];
      const r = packPrs(prs, { currentIssueFiles: ['important.go'], maxHunksPerPr: 2 });
      const files = r.packed[0].hunks.map(h => h.file);
      expect(files[0]).toBe('important.go');
    });

    it('handles malformed PR entries without throwing', () => {
      // @ts-ignore deliberately malformed
      const r = packPrs([null, { score: 0.9 }, makePr(1, 0.9, [makeHunk('a.go')])]);
      expect(r.packed).toHaveLength(1);
    });

    it('truncates hunks longer than maxLinesPerHunk', () => {
      const longHunk = {
        file: 'x.go',
        hunk: Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
      };
      const r = packPrs([makePr(1, 0.9, [longHunk])], { maxLinesPerHunk: 10 });
      const accepted = r.packed[0].hunks[0].hunk;
      expect(accepted.split('\n')).toHaveLength(11);
      expect(accepted).toMatch(/90 more lines omitted/);
    });
  });
});
