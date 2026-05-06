/**
 * Tests for lib/rubber-duck.js
 *
 * Covers all 24 scenarios from docs/RUBBER_DUCK_CRITIQUE_PROPOSAL.md §6.1:
 *   - 1-3   short-circuit (issueType / HEAD)
 *   - 4-11  critique parsing + READ-ONLY invariant enforcement
 *   - 12-21 fix transactional safety (stash, reset --hard, soft-reset on
 *           Copilot self-commit, reportPath exclusion, shell-metachar safety)
 *   - 22-23 summary contract + caller-driven print
 *   - 24    behavioral "no-backdoor" assertion (no flag/config/env disables it)
 */

const fs = require('fs');
const path = require('path');

jest.mock('fs');
jest.mock('child_process', () => ({
  execSync: jest.fn(),
  execFileSync: jest.fn()
}));
const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());
jest.mock('../lib/copilot', () => ({
  runCopilot: jest.fn()
}));
jest.mock('../lib/git-utils', () => ({
  runGit: jest.fn(),
  runGitArgs: jest.fn()
}));
jest.mock('../lib/utils', () => ({
  ...jest.requireActual('../lib/utils'),
  waitForFile: jest.fn(() => Promise.resolve(true))
}));
jest.mock('../lib/prompt-loader', () => ({
  loadPrompt: jest.fn((name) => `[stub-prompt:${name}]`)
}));

const { runGit, runGitArgs } = require('../lib/git-utils');
const { runCopilot } = require('../lib/copilot');
const { waitForFile } = require('../lib/utils');
const { warning, info } = require('../lib/logger');

const {
  shouldRunRubberDuck,
  runPostPhase2RubberDuck,
  printRubberDuckSummary,
  parseFindingsJsonBlock,
  parseStatusZ,
  isUnderReportPath,
  pickTopFinding,
  renderFindingList
} = require('../lib/rubber-duck');

// ────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────

const makeConfig = (overrides = {}) => ({
  repoPath: '/repo',
  reportPath: '/reports',
  model: 'claude-sonnet-4.6',
  logLevel: 'info',
  ...overrides
});

/** Build a valid finding for use in mock report content. */
const makeFinding = (overrides = {}) => ({
  id: 'f1',
  severity: 'high',
  category: 'reuse',
  file: 'src/foo.go',
  line: 88,
  title: 'Re-implements isServerless inline',
  evidence: { file: 'src/helpers.go', line: 42, snippet: 'func isServerless()' },
  suggestedFix: 'Call isServerless()',
  ...overrides
});

/** Build a critique report Markdown that contains the JSON fenced block. */
const makeReportContent = (findings, dropped = []) => {
  const json = JSON.stringify({ schemaVersion: 1, findings, dropped }, null, 2);
  return `# Issue — Rubber-Duck Critique

\`\`\`json rubber-duck-findings
${json}
\`\`\`

## Findings (human-readable)
...
`;
};

/**
 * Configure default git behaviour so rubber-duck can complete an auto-fix path:
 * - HEAD readable
 * - critique was READ-ONLY (no working-tree drift)
 * - no pre-existing dirty
 * - fix Copilot did not self-commit
 * - fix produced one modified file
 *
 * Individual tests override specific commands as needed via the same mock.
 */
function setupHappyGit({ findings, fileChanged = 'src/foo.go' } = {}) {
  // Default: report contains the findings JSON
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(makeReportContent(findings || []));

  // Track HEAD movement: starts as 'head1' (currentHead before critique).
  // After fix, no self-commit unless the test overrides.
  const headSeq = ['head1'];
  let statusPorcelainCount = 0;

  runGit.mockImplementation((repoPath, cmd) => {
    if (cmd === 'git rev-parse HEAD') return headSeq[headSeq.length - 1];
    if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
    if (cmd === 'git status --porcelain') {
      // 1st call: pre-critique snapshot (used to compare drift)
      // 2nd call: post-critique (must equal pre to pass invariant)
      // 3rd call: pre-fix dirty (empty -> no stash needed)
      statusPorcelainCount += 1;
      return '';
    }
    if (cmd.startsWith('git checkout ')) return '';
    if (cmd.startsWith('git reset ')) return '';
    if (cmd.startsWith('git stash')) return '';
    if (cmd.startsWith('git clean')) return '';
    return '';
  });

  // runGitArgs is used for: status --porcelain=v1 -z (post-fix), git add, git commit
  let argsCount = 0;
  runGitArgs.mockImplementation((_repoPath, argv) => {
    argsCount += 1;
    if (argv[0] === 'status') {
      // post-fix changed paths via -z (NUL-separated) — return one modified file
      return ` M ${fileChanged}\0`;
    }
    if (argv[0] === 'add') return '';
    if (argv[0] === 'commit') return '';
    return '';
  });

  runCopilot.mockResolvedValue(undefined);
  waitForFile.mockResolvedValue(true);
}

// ────────────────────────────────────────────────────────────────────────
// 1. Pure helpers
// ────────────────────────────────────────────────────────────────────────

describe('shouldRunRubberDuck', () => {
  it('returns false for GUIDANCE issues', () => {
    expect(shouldRunRubberDuck('GUIDANCE', 'a', 'b')).toBe(false);
  });
  it('returns false when prePhase2Head is empty', () => {
    expect(shouldRunRubberDuck('CODE_CHANGE', '', 'b')).toBe(false);
  });
  it('returns false when currentHead is empty', () => {
    expect(shouldRunRubberDuck('CODE_CHANGE', 'a', '')).toBe(false);
  });
  it('returns false when Phase 2 produced no commit (HEAD unchanged)', () => {
    expect(shouldRunRubberDuck('CODE_CHANGE', 'samehead', 'samehead')).toBe(false);
  });
  it('returns true for CODE_CHANGE with HEAD movement', () => {
    expect(shouldRunRubberDuck('CODE_CHANGE', 'old', 'new')).toBe(true);
  });
});

describe('parseFindingsJsonBlock', () => {
  beforeEach(() => jest.clearAllMocks());

  it('parses a valid JSON block', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
    const r = parseFindingsJsonBlock('/r.md');
    expect(r.parseError).toBeUndefined();
    expect(r.findings).toHaveLength(1);
    expect(r.droppedCount).toBe(0);
  });

  it('returns parseError when report file missing', () => {
    fs.existsSync.mockReturnValue(false);
    expect(parseFindingsJsonBlock('/missing.md').parseError).toMatch(/not found/);
  });

  it('returns parseError when JSON block missing', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue('# report with no JSON block at all');
    expect(parseFindingsJsonBlock('/r.md').parseError).toMatch(/JSON block.*not found/);
  });

  it('returns parseError on invalid JSON syntax', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      '```json rubber-duck-findings\n{not valid json}\n```'
    );
    expect(parseFindingsJsonBlock('/r.md').parseError).toMatch(/not valid JSON/);
  });

  it('drops findings with invalid severity', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      makeReportContent([makeFinding({ severity: 'critical' }), makeFinding({ id: 'f2' })])
    );
    const r = parseFindingsJsonBlock('/r.md');
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].id).toBe('f2');
    expect(r.droppedCount).toBe(1);
  });

  it('drops findings missing evidence.file or evidence.line', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      makeReportContent([
        makeFinding({ evidence: { file: '', line: 1 } }),
        makeFinding({ id: 'f2', evidence: { file: 'src/x.go' } })
      ])
    );
    const r = parseFindingsJsonBlock('/r.md');
    expect(r.findings).toHaveLength(0);
    expect(r.droppedCount).toBe(2);
  });

  it('counts entries in dropped[] toward droppedCount', () => {
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(
      makeReportContent([makeFinding()], [{ reason: 'no concrete evidence', note: 'x' }])
    );
    expect(parseFindingsJsonBlock('/r.md').droppedCount).toBe(1);
  });

  it('returns parseError when the report contains MULTIPLE findings JSON blocks', () => {
    // Regression test for I8: Copilot occasionally emits a malformed first
    // block followed by a corrected second; preferring either is surprising.
    fs.existsSync.mockReturnValue(true);
    const block = makeReportContent([makeFinding()]);
    // Append a second valid block — the parser must reject this.
    fs.readFileSync.mockReturnValue(block + '\n\n' + block);
    const r = parseFindingsJsonBlock('/r.md');
    expect(r.parseError).toBeDefined();
    expect(r.parseError).toMatch(/expected exactly one/);
  });
});

describe('parseStatusZ', () => {
  it('parses simple modified entries', () => {
    expect(parseStatusZ(' M src/a.go\0 M src/b.go\0')).toEqual(['src/a.go', 'src/b.go']);
  });
  it('parses untracked entries (??)', () => {
    expect(parseStatusZ('?? new.go\0')).toEqual(['new.go']);
  });
  it('handles renames by taking the new path and skipping the source record', () => {
    // Rename uses two NUL-terminated records: NEW path then OLD path
    expect(parseStatusZ('R  new.go\0old.go\0 M other.go\0')).toEqual(['new.go', 'other.go']);
  });
  it('skips ignored (!!) entries defensively', () => {
    expect(parseStatusZ('!! ignored.txt\0 M kept.go\0')).toEqual(['kept.go']);
  });
  it('returns [] for empty input', () => {
    expect(parseStatusZ('')).toEqual([]);
  });
});

describe('isUnderReportPath', () => {
  it('returns true for files inside reportPath', () => {
    // reportPath inside repoPath → exclusion must catch
    expect(isUnderReportPath('/repo', '/repo/.reports', '.reports/issue-1.md')).toBe(true);
  });
  it('returns false for files outside reportPath', () => {
    expect(isUnderReportPath('/repo', '/repo/.reports', 'src/foo.go')).toBe(false);
  });
  it('returns false when reportPath is unrelated to repo', () => {
    // path.relative will produce ../.. style → not under
    expect(isUnderReportPath('/repo', '/elsewhere/reports', 'src/foo.go')).toBe(false);
  });
});

describe('pickTopFinding', () => {
  it('returns null with no high finding', () => {
    expect(pickTopFinding([makeFinding({ severity: 'medium' })])).toBeNull();
  });
  it('picks the first high finding', () => {
    const top = pickTopFinding([
      makeFinding({ severity: 'medium' }),
      makeFinding({ id: 'f2', severity: 'high', file: 'src/x.go', line: 10 })
    ]);
    expect(top.evidenceFile).toBe('src/helpers.go');
    expect(top.file).toBe('src/x.go');
  });
});

describe('renderFindingList', () => {
  it('lists only high+medium findings, one per line', () => {
    const out = renderFindingList([
      makeFinding({ severity: 'low', title: 't-low' }),
      makeFinding({ id: 'f2', severity: 'medium', title: 't-med' }),
      makeFinding({ id: 'f3', severity: 'high', title: 't-high' })
    ]);
    const lines = out.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines.every(l => /^- \[/.test(l))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────
// 2. runPostPhase2RubberDuck — orchestration
// ────────────────────────────────────────────────────────────────────────

describe('runPostPhase2RubberDuck', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_ISSUE_RUBBER_DUCK_DISABLE;
  });

  // ── Critique outcomes ─────────────────────────────────────────────────
  describe('short-circuit (no rubber-duck pass)', () => {
    it('returns null when prePhase2Head is empty (no pre-image)', async () => {
      const r = await runPostPhase2RubberDuck('42', makeConfig(), '');
      expect(r).toBeNull();
      expect(runCopilot).not.toHaveBeenCalled();
    });

    it('returns null when current HEAD equals prePhase2Head (no Phase 2 commit)', async () => {
      runGit.mockImplementation((_, cmd) => (cmd === 'git rev-parse HEAD' ? 'samehead' : ''));
      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'samehead');
      expect(r).toBeNull();
      expect(runCopilot).not.toHaveBeenCalled();
    });

    it('returns null when git rev-parse HEAD throws', async () => {
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') throw new Error('not a git repo');
        return '';
      });
      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r).toBeNull();
      expect(runCopilot).not.toHaveBeenCalled();
    });
  });

  describe('critique parsing', () => {
    it('returns skipped-parse-error when JSON block is missing', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('# no json block');
      runGit.mockReturnValue('head');
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('skipped-parse-error');
      expect(r.warnings.some(w => w.includes('JSON parse failed'))).toBe(true);
      expect(runCopilot).toHaveBeenCalledTimes(1); // only critique, NOT fix
    });

    it('returns skipped-parse-error when JSON syntax is broken', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(
        '```json rubber-duck-findings\n{bad json}\n```'
      );
      runGit.mockReturnValue('head');
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('skipped-parse-error');
      expect(runCopilot).toHaveBeenCalledTimes(1);
    });

    it('skips fix when only low findings present', async () => {
      setupHappyGit({ findings: [makeFinding({ severity: 'low' })] });
      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('skipped-no-findings');
      expect(r.counts.low).toBe(1);
      expect(runCopilot).toHaveBeenCalledTimes(1); // critique only
    });

    it('drops malformed findings while keeping valid ones', async () => {
      setupHappyGit({
        findings: [
          makeFinding({ severity: 'critical' }),  // invalid → dropped
          makeFinding({ id: 'f2', severity: 'high' })
        ]
      });
      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.counts.dropped).toBe(1);
      expect(r.counts.high).toBe(1);
    });

    it('reports critique-skipped autoFixStatus when critique Copilot throws', async () => {
      runGit.mockReturnValue('head');
      runCopilot.mockRejectedValueOnce(new Error('copilot crash'));
      // Even after thrown error, code still tries to read report
      fs.existsSync.mockReturnValue(false);
      waitForFile.mockResolvedValue(false);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('critique-skipped');
      expect(r.warnings.some(w => w.includes('Critique step failed'))).toBe(true);
      expect(r.warnings.some(w => w.includes('not generated'))).toBe(true);
    });

    it('warns when critique report file is never produced', async () => {
      runGit.mockReturnValue('head');
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(false);
      fs.existsSync.mockReturnValue(false);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('critique-skipped');
      expect(r.warnings.some(w => w.includes('not generated'))).toBe(true);
    });
  });

  // ── Critique READ-ONLY invariant ──────────────────────────────────────
  describe('critique READ-ONLY enforcement', () => {
    it('detects critique-induced working-tree drift and discards it', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding({ severity: 'low' })]));
      let statusZCalls = 0;
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return ''; // pre-fix dirty (only call) = clean
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') {
          statusZCalls += 1;
          // 1st call: pre-critique snapshot (clean)
          // 2nd call: post-critique snapshot (Copilot drifted) → ' M src/touched.go'
          // 3rd+ call (if any): post-fix
          if (statusZCalls === 1) return '';
          if (statusZCalls === 2) return ' M src/touched.go\0';
          return '';
        }
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.warnings.some(w => w.includes('outside reportPath; discarding'))).toBe(true);
      // Surgical pathspec-scoped stash + drop discards ONLY the drifted path
      const stashPushCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'stash' && c[1][1] === 'push' && c[1].includes('src/touched.go')
      );
      expect(stashPushCall).toBeDefined();
      expect(runGit).toHaveBeenCalledWith('/repo', 'git stash drop');
    });

    it('does NOT flag critique report writes (under reportPath inside repo) as drift', async () => {
      // Regression test for B1: critique writing the report file inside the repo
      // would otherwise be misdetected as drift and trigger broad cleanup that
      // deletes the report. The path-set diff must exclude reportPath.
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding({ severity: 'low' })]));
      let statusZCalls = 0;
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') {
          statusZCalls += 1;
          if (statusZCalls === 1) return ''; // pre-critique clean
          // post-critique: ONLY the report file appeared (legitimate critique output)
          if (statusZCalls === 2) return '?? .reports/issue-42-rubber-duck-critique.md\0';
          return '';
        }
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const cfg = makeConfig({ reportPath: '/repo/.reports' });
      const r = await runPostPhase2RubberDuck('42', cfg, 'old');
      // No drift warning (only the report appeared in status)
      expect(r.warnings.find(w => w.includes('outside reportPath; discarding'))).toBeUndefined();
      // No stash drop call (no drift to discard)
      expect(runGit).not.toHaveBeenCalledWith('/repo', 'git stash drop');
    });

    it('preserves pre-existing dirty paths when only NEW paths are unauthorized drift', async () => {
      // Regression test for B2: with pre-existing dirty file `src/preexisting.go`
      // and critique-induced new file `src/touched.go`, ONLY the new file should
      // be discarded — the pre-existing dirty must be untouched.
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding({ severity: 'low' })]));
      let statusZCalls = 0;
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') {
          statusZCalls += 1;
          // 1st call: pre-critique snapshot — pre-existing dirty file present
          if (statusZCalls === 1) return ' M src/preexisting.go\0';
          // 2nd call: post-critique — pre-existing dirty STILL there + new drift
          if (statusZCalls === 2) return ' M src/preexisting.go\0 M src/touched.go\0';
          return '';
        }
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      // Surgical stash includes ONLY src/touched.go, NOT src/preexisting.go
      const stashPushCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'stash' && c[1][1] === 'push'
      );
      expect(stashPushCall).toBeDefined();
      expect(stashPushCall[1]).toContain('src/touched.go');
      expect(stashPushCall[1]).not.toContain('src/preexisting.go');
    });

    it('detects critique-induced HEAD/branch drift and restores it', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding({ severity: 'low' })]));
      let headCalls = 0;
      let branchCalls = 0;
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') {
          headCalls += 1;
          // 1st: pre-critique = head1; 2nd: post-critique = head2 (Copilot committed)
          return headCalls === 1 ? 'head1' : 'head2';
        }
        if (cmd === 'git rev-parse --abbrev-ref HEAD') {
          branchCalls += 1;
          // 1st: pre = main; 2nd: post = otherbranch (Copilot switched)
          return branchCalls === 1 ? 'main' : 'otherbranch';
        }
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ''; // both pre + post critique clean
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.warnings.some(w => w.includes('READ-ONLY'))).toBe(true);
      // Restore is now via runGitArgs (shell-safe)
      const checkoutCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'checkout' && c[1][1] === 'main'
      );
      expect(checkoutCall).toBeDefined();
      const resetCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'reset' && c[1][1] === '--hard' && c[1][2] === 'head1'
      );
      expect(resetCall).toBeDefined();
    });
  });

  // ── Fix transactional safety ──────────────────────────────────────────
  describe('fix step', () => {
    it('applies fix and commits using execFileSync with mandated message', async () => {
      setupHappyGit({ findings: [makeFinding()] });
      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('applied');
      // Verify the commit was created via runGitArgs (no shell interpolation)
      const commitCall = runGitArgs.mock.calls.find(c => c[1][0] === 'commit');
      expect(commitCall).toBeDefined();
      const argv = commitCall[1];
      expect(argv).toContain('-m');
      expect(argv).toContain('Apply rubber-duck critique fixes for #42');
      // Trailer present
      expect(argv.some(a => typeof a === 'string' && a.includes('Co-authored-by: Copilot'))).toBe(true);
    });

    it('reports ran-no-changes when fix produces no working-tree changes', async () => {
      // setupHappyGit returns one modified file by default; override.
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ''; // no changes after fix
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('ran-no-changes');
      // No commit created
      expect(runGitArgs.mock.calls.find(c => c[1][0] === 'commit')).toBeUndefined();
    });

    it('cleans up working tree via cleanupFixAttempt when fix throws', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ''; // critique drift check returns clean
        return '';
      });
      runCopilot
        .mockResolvedValueOnce(undefined)              // critique OK
        .mockRejectedValueOnce(new Error('crash'));    // fix fails
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('failed');
      // cleanupFixAttempt resets to fixStartHead via runGitArgs (NOT shell-string)
      const resetCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'reset' && c[1][1] === '--hard' && c[1][2] === 'head1'
      );
      expect(resetCall).toBeDefined();
      expect(runGit).toHaveBeenCalledWith('/repo', 'git clean -fd');
      expect(r.warnings.some(w => w.includes('Fix step failed'))).toBe(true);
    });

    it('detects Copilot self-commit and resets so CLI commits with mandated message', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      let headCallCount = 0;
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') {
          headCallCount += 1;
          // 1: critique-pre → head1
          // 2: critique-post (verify) → head1 (no drift)
          // 3: pre-fix snapshot → head1
          // 4: post-fix → head2 (Copilot committed!)
          // 5: read commitHash after CLI commit → head3
          if (headCallCount <= 3) return 'head1';
          if (headCallCount === 4) return 'head2';
          return 'head3';
        }
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ' M src/foo.go\0';
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('applied');
      // Reset to fixStartHead via runGitArgs (--mixed unifies the staging path)
      const resetCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'reset' && c[1][1] === '--mixed' && c[1][2] === 'head1'
      );
      expect(resetCall).toBeDefined();
      // CLI commit still ran with mandated message
      const commitCall = runGitArgs.mock.calls.find(c => c[1][0] === 'commit');
      expect(commitCall[1]).toContain('Apply rubber-duck critique fixes for #42');
    });

    it('aborts with autoFixStatus=failed when fix step switches branches', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      let branchCallCount = 0;
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') {
          branchCallCount += 1;
          // 1: critique-pre = main
          // 2: critique-post (verify) = main (no drift)
          // 3: pre-fix = main
          // 4: post-fix = otherbranch (Copilot switched!)
          if (branchCallCount <= 3) return 'main';
          return 'otherbranch';
        }
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('failed');
      // Branch restored via cleanupFixAttempt → runGitArgs(['checkout', 'main'])
      const checkoutCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'checkout' && c[1][1] === 'main'
      );
      expect(checkoutCall).toBeDefined();
      expect(runGitArgs.mock.calls.find(c => c[1][0] === 'commit')).toBeUndefined();
    });

    it('stashes pre-existing dirty state and restores it after commit', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      // After refactor, only ONE call to runGit('git status --porcelain') exists
      // — the pre-fix dirty check (pre-/post-critique now use runGitArgs).
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return ' M unrelated.go';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ' M src/foo.go\0';
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('applied');
      // Stash created with the ai-issue tag
      expect(runGit).toHaveBeenCalledWith('/repo', expect.stringContaining('git stash push -u -m "ai-issue: pre-rubber-duck stash"'));
      // Stash popped after commit
      expect(runGit).toHaveBeenCalledWith('/repo', 'git stash pop');
      // Commit must NOT include the unrelated dirty path — only filesToStage from runGitArgs status output
      const addCall = runGitArgs.mock.calls.find(c => c[1][0] === 'add');
      expect(addCall[1]).toContain('src/foo.go');
      expect(addCall[1]).not.toContain('unrelated.go');
    });

    it('warns when stash pop conflicts but still resolves (non-blocking)', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return ' M unrelated.go';
        if (cmd === 'git stash pop') {
          throw new Error('CONFLICT (content): merge conflict in src/foo.go');
        }
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ' M src/foo.go\0';
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('applied'); // still applied, not failed
      expect(r.warnings.some(w => w.includes('stash pop'))).toBe(true);
    });

    it('excludes critique report from the rubber-duck commit when reportPath is inside repo', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      // reportPath is INSIDE repoPath
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') {
          // Two changed paths: one src file + one inside the report dir
          return ' M src/foo.go\0 M .reports/issue-42-rubber-duck-critique.md\0';
        }
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const cfg = makeConfig({ reportPath: '/repo/.reports' });
      const r = await runPostPhase2RubberDuck('42', cfg, 'old');
      expect(r.autoFixStatus).toBe('applied');
      const addCall = runGitArgs.mock.calls.find(c => c[1][0] === 'add');
      expect(addCall[1]).toContain('src/foo.go');
      expect(addCall[1]).not.toContain('.reports/issue-42-rubber-duck-critique.md');
    });

    it('reports ran-no-changes when fix only touched files inside reportPath', async () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ' M .reports/notes.md\0';
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const cfg = makeConfig({ reportPath: '/repo/.reports' });
      const r = await runPostPhase2RubberDuck('42', cfg, 'old');
      expect(r.autoFixStatus).toBe('ran-no-changes');
      expect(runGitArgs.mock.calls.find(c => c[1][0] === 'commit')).toBeUndefined();
    });

    it('passes shell metacharacters in finding text safely via execFileSync argv', async () => {
      const evilFinding = makeFinding({
        title: 'Body with `backticks` and $(rm -rf /) and "quotes"'
      });
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([evilFinding]));
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ' M src/foo.go\0';
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      const commitCall = runGitArgs.mock.calls.find(c => c[1][0] === 'commit');
      // The dangerous body string must appear verbatim in argv (NOT shell-interpreted)
      const bodyArg = commitCall[1].find(a => typeof a === 'string' && a.includes('$(rm'));
      expect(bodyArg).toBeDefined();
      expect(bodyArg).toContain('`backticks`');
      expect(bodyArg).toContain('$(rm -rf /)');
      expect(bodyArg).toContain('"quotes"');
    });

    it('runs cleanupFixAttempt on git-commit failure (post-fix transactional invariant)', async () => {
      // Regression test for B4: if `git commit` fails AFTER fix Copilot ran,
      // partial fix edits must be wiped before the function returns so they
      // don't leak into runPostPhase2AutoReview's diff downstream.
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue(makeReportContent([makeFinding()]));
      runGit.mockImplementation((_, cmd) => {
        if (cmd === 'git rev-parse HEAD') return 'head1';
        if (cmd === 'git rev-parse --abbrev-ref HEAD') return 'main';
        if (cmd === 'git status --porcelain') return '';
        return '';
      });
      runGitArgs.mockImplementation((_, argv) => {
        if (argv[0] === 'status') return ' M src/foo.go\0';
        if (argv[0] === 'commit') {
          throw new Error('hook rejected commit');
        }
        return '';
      });
      runCopilot.mockResolvedValue(undefined);
      waitForFile.mockResolvedValue(true);

      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r.autoFixStatus).toBe('failed');
      expect(r.warnings.some(w => w.includes('git commit failed'))).toBe(true);
      // cleanupFixAttempt MUST run: reset --hard to fixStartHead + git clean -fd
      const resetHardCall = runGitArgs.mock.calls.find(
        c => c[1][0] === 'reset' && c[1][1] === '--hard' && c[1][2] === 'head1'
      );
      expect(resetHardCall).toBeDefined();
      expect(runGit).toHaveBeenCalledWith('/repo', 'git clean -fd');
    });
  });

  // ── Function contract ────────────────────────────────────────────────
  describe('return value contract', () => {
    it('returns structured result with all expected keys', async () => {
      setupHappyGit({ findings: [makeFinding()] });
      const r = await runPostPhase2RubberDuck('42', makeConfig(), 'old');
      expect(r).toMatchObject({
        counts: expect.any(Object),
        reportPath: expect.stringContaining('issue-42-rubber-duck-critique.md'),
        autoFixStatus: expect.any(String),
        commitHash: expect.any(String),
        topFinding: expect.any(Object),
        warnings: expect.any(Array)
      });
      expect(r.counts).toEqual(expect.objectContaining({
        high: expect.any(Number),
        medium: expect.any(Number),
        low: expect.any(Number),
        dropped: expect.any(Number)
      }));
    });
  });

  // ── No-backdoor (behavioral assertion) ────────────────────────────────
  describe('no-backdoor guarantees', () => {
    it('runPostPhase2RubberDuck signature accepts only (issueNumber, config, prePhase2Head)', () => {
      // length excludes default-valued and rest params
      expect(runPostPhase2RubberDuck.length).toBe(3);
    });

    it('shouldRunRubberDuck signature accepts only (issueType, prePhase2Head, currentHead)', () => {
      expect(shouldRunRubberDuck.length).toBe(3);
    });

    it('still runs critique when caller-style "disable" inputs are present', async () => {
      // (a) config has a rubberDuck.enabled=false field — code must ignore it
      // (b) env var set — code must ignore it
      // (c) extra args passed — code must ignore them
      process.env.AI_ISSUE_RUBBER_DUCK_DISABLE = '1';
      const cfg = makeConfig({ rubberDuck: { enabled: false } });
      setupHappyGit({ findings: [makeFinding({ severity: 'low' })] });

      // Pass spurious extra argument (must be ignored, function only declares 3 params)
      // eslint-disable-next-line no-extra-args
      const r = await runPostPhase2RubberDuck('42', cfg, 'old', { rubberDuck: false });
      expect(runCopilot).toHaveBeenCalled();
      expect(r.autoFixStatus).not.toBe('critique-skipped');

      delete process.env.AI_ISSUE_RUBBER_DUCK_DISABLE;
    });

    it('does NOT export any disable/skip/setEnabled function', () => {
      const mod = require('../lib/rubber-duck');
      const exportedNames = Object.keys(mod).join(',');
      expect(exportedNames).not.toMatch(/disable|setEnabled|skip/i);
    });
  });
});

// ────────────────────────────────────────────────────────────────────────
// 3. printRubberDuckSummary — caller-driven terminal print
// ────────────────────────────────────────────────────────────────────────

describe('printRubberDuckSummary', () => {
  beforeEach(() => jest.clearAllMocks());

  const baseResult = () => ({
    counts: { high: 2, medium: 3, low: 1, dropped: 1 },
    reportPath: '/reports/issue-42-rubber-duck-critique.md',
    autoFixStatus: 'applied',
    commitHash: 'abcdef1234567890',
    topFinding: {
      severity: 'high',
      category: 'reuse',
      file: 'src/foo.go',
      line: 88,
      title: 'Re-implements isServerless inline',
      evidenceFile: 'src/helpers.go',
      evidenceLine: 42
    },
    warnings: []
  });

  it('renders applied status with sha7 + fixed count', () => {
    const { log } = require('../lib/logger');
    printRubberDuckSummary(baseResult());
    const calls = log.mock.calls.map(c => c[0]).join('\n');
    expect(calls).toContain('Findings: 2 high, 3 medium, 1 low (1 dropped)');
    expect(calls).toContain('applied (5 high+medium findings)');
    expect(calls).toContain('abcdef1');
    expect(calls).toContain('[high reuse] src/foo.go:88');
  });

  it.each([
    ['skipped-no-findings', 'skipped (no high/medium findings)'],
    ['skipped-parse-error', 'skipped (findings JSON malformed'],
    ['ran-no-changes', 'ran but produced no changes'],
    ['failed', 'failed — see warnings above'],
    ['critique-skipped', '(critique itself failed']
  ])('renders %s status with the expected line', (status, expectText) => {
    const { log } = require('../lib/logger');
    const result = { ...baseResult(), autoFixStatus: status, commitHash: null, topFinding: null };
    printRubberDuckSummary(result);
    const calls = log.mock.calls.map(c => c[0]).join('\n');
    expect(calls).toContain(expectText);
  });

  it('forwards warnings to logger.warning', () => {
    const r = { ...baseResult(), warnings: ['warning A', 'warning B'] };
    printRubberDuckSummary(r);
    expect(warning).toHaveBeenCalledWith('warning A');
    expect(warning).toHaveBeenCalledWith('warning B');
  });

  it('omits topFinding section when result.topFinding is null', () => {
    const { log } = require('../lib/logger');
    const r = { ...baseResult(), topFinding: null };
    printRubberDuckSummary(r);
    const calls = log.mock.calls.map(c => c[0]).join('\n');
    expect(calls).not.toContain('Top finding:');
  });

  it('handles missing result safely (no throw)', () => {
    expect(() => printRubberDuckSummary(null)).not.toThrow();
  });
});
