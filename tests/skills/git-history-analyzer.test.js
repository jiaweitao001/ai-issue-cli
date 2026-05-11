// @ts-check
/**
 * Tests for git-history-analyzer MCP skill (SKILLS_ENHANCEMENT_PLAN §C1).
 *
 * Mocks child_process.execFile with a callback-style stub so we exercise the
 * skill's runGit() Promise wrapper without depending on git or a real repo
 * (except for the input-contract tests, which need a real git working tree
 * to validate the `git rev-parse --git-dir` probe behaves correctly).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

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

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return {
    ...actual,
    execFile: jest.fn(),
  };
});
const { execFile, execSync } = require('child_process');

const SKILL = require('../../skills/git-history-analyzer/index.js');
const { analyzeFileHistory, findRelatedChanges, handleToolRequest, __internal } = SKILL;
const { clampLimit, parseCommitRecords, parseCommitRecordsWithFiles, constants } = __internal;
const { FIELD_SEP, RECORD_SEP, MAX_FILE_HISTORY, MAX_RELATED_CHANGES, MAX_FILES_PER_COMMIT, BODY_TRUNCATE_CHARS } = constants;

// -- helpers ----------------------------------------------------------------

let realRepoPath;
let nonRepoPath;

beforeAll(() => {
  realRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-history-skill-repo-'));
  execSync(
    'git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -q -m init',
    { cwd: realRepoPath, shell: '/bin/bash' }
  );
  nonRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'git-history-skill-nonrepo-'));
});

afterAll(() => {
  fs.rmSync(realRepoPath, { recursive: true, force: true });
  fs.rmSync(nonRepoPath, { recursive: true, force: true });
});

beforeEach(() => {
  execFile.mockReset();
});

/** Make execFile resolve with the given stdout for any call. */
function mockGitStdout(stdout, stderr = '') {
  execFile.mockImplementation((cmd, args, opts, cb) => {
    cb(null, stdout, stderr);
  });
}

/**
 * Make execFile resolve with `revParseOk` for the git-dir probe and
 * `mainStdout` for everything else.
 */
function mockGitRepoAndStdout(mainStdout, mainStderr = '') {
  execFile.mockImplementation((cmd, args, opts, cb) => {
    if (Array.isArray(args) && args[0] === 'rev-parse' && args[1] === '--git-dir') {
      return cb(null, '.git\n', '');
    }
    cb(null, mainStdout, mainStderr);
  });
}

function buildCommitRecord({ sha, date, author, subject, body = '' }) {
  return `${sha}${FIELD_SEP}${date}${FIELD_SEP}${author}${FIELD_SEP}${subject}${FIELD_SEP}${body}${RECORD_SEP}`;
}

function buildCommitRecordWithFiles({ sha, date, author, subject, files }) {
  // Mirrors COMMIT_FORMAT_HEADER_ONLY: leading RS, header, then files.
  return (
    `${RECORD_SEP}${sha}${FIELD_SEP}${date}${FIELD_SEP}${author}${FIELD_SEP}${subject}` +
    `\n${files.join('\n')}${files.length ? '\n' : ''}`
  );
}

// -- input contract ---------------------------------------------------------

describe('input contract', () => {
  it('analyze_file_history rejects missing repoPath', async () => {
    await expect(analyzeFileHistory({ filePath: 'x' })).rejects.toThrow(/INVALID_INPUT.*repoPath/);
  });

  it('analyze_file_history rejects missing filePath', async () => {
    mockGitRepoAndStdout('');
    await expect(analyzeFileHistory({ repoPath: realRepoPath })).rejects.toThrow(/INVALID_INPUT.*filePath/);
  });

  it('analyze_file_history rejects empty filePath', async () => {
    mockGitRepoAndStdout('');
    await expect(analyzeFileHistory({ repoPath: realRepoPath, filePath: '' })).rejects.toThrow(/INVALID_INPUT.*filePath/);
  });

  it('analyze_file_history rejects filePath containing NUL byte', async () => {
    mockGitRepoAndStdout('');
    await expect(analyzeFileHistory({ repoPath: realRepoPath, filePath: 'a\x00b' })).rejects.toThrow(/NUL bytes/);
  });

  it('analyze_file_history rejects relative filePath that escapes repoPath via ..', async () => {
    mockGitRepoAndStdout('');
    await expect(
      analyzeFileHistory({ repoPath: realRepoPath, filePath: '../../etc/passwd' })
    ).rejects.toThrow(/resolves outside repoPath/);
  });

  it('analyze_file_history rejects absolute filePath outside repoPath', async () => {
    mockGitRepoAndStdout('');
    await expect(
      analyzeFileHistory({ repoPath: realRepoPath, filePath: '/tmp/somewhere/else/foo.js' })
    ).rejects.toThrow(/resolves outside repoPath/);
  });

  it('analyze_file_history rejects non-existent repoPath', async () => {
    await expect(
      analyzeFileHistory({ repoPath: '/this/does/not/exist/at/all', filePath: 'x' })
    ).rejects.toThrow(/INVALID_INPUT.*repoPath does not exist/);
  });

  it('analyze_file_history rejects non-git directory', async () => {
    // Real dir, but `git rev-parse --git-dir` will fail. Don't mock execFile
    // here — let the real git binary report failure, which matches what
    // happens in production.
    execFile.mockImplementation((cmd, args, opts, cb) => {
      const err = new Error('not a git repository');
      err.stderr = 'fatal: not a git repository';
      cb(err, '', err.stderr);
    });
    await expect(
      analyzeFileHistory({ repoPath: nonRepoPath, filePath: 'x' })
    ).rejects.toThrow(/INVALID_INPUT.*not a git working tree/);
  });

  it('find_related_changes rejects when neither pattern provided', async () => {
    mockGitRepoAndStdout('');
    await expect(findRelatedChanges({ repoPath: realRepoPath })).rejects.toThrow(
      /at least one of pathPattern or messagePattern/
    );
  });

  it('find_related_changes rejects empty pathPattern', async () => {
    mockGitRepoAndStdout('');
    await expect(
      findRelatedChanges({ repoPath: realRepoPath, pathPattern: '' })
    ).rejects.toThrow(/at least one of pathPattern or messagePattern/);
  });
});

// -- clampLimit -------------------------------------------------------------

describe('clampLimit', () => {
  it('returns fallback for undefined / null / NaN / negative / zero', () => {
    expect(clampLimit(undefined, 10, 50)).toBe(10);
    expect(clampLimit(null, 10, 50)).toBe(10);
    expect(clampLimit('abc', 10, 50)).toBe(10);
    expect(clampLimit(-5, 10, 50)).toBe(10);
    expect(clampLimit(0, 10, 50)).toBe(10);
    expect(clampLimit(Infinity, 10, 50)).toBe(50);
  });

  it('clamps to max', () => {
    expect(clampLimit(999, 10, 50)).toBe(50);
    expect(clampLimit(1000, 10, MAX_RELATED_CHANGES)).toBe(MAX_RELATED_CHANGES);
  });

  it('passes through valid in-range values', () => {
    expect(clampLimit(5, 10, 50)).toBe(5);
    expect(clampLimit('25', 10, 50)).toBe(25);
    expect(clampLimit(7.9, 10, 50)).toBe(7); // floors
  });
});

// -- parseCommitRecords -----------------------------------------------------

describe('parseCommitRecords', () => {
  it('parses an empty stdout to an empty array', () => {
    expect(parseCommitRecords('')).toEqual([]);
    expect(parseCommitRecords(undefined)).toEqual([]);
  });

  it('parses multiple commits and skips the trailing empty record', () => {
    const stdout =
      buildCommitRecord({ sha: 'aaa', date: '2026-01-01T00:00:00Z', author: 'A', subject: 'first' }) +
      buildCommitRecord({ sha: 'bbb', date: '2026-01-02T00:00:00Z', author: 'B', subject: 'second' });
    const out = parseCommitRecords(stdout);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ sha: 'aaa', date: '2026-01-01T00:00:00Z', author: 'A', subject: 'first' });
    expect(out[1].sha).toBe('bbb');
    expect(out[0]).not.toHaveProperty('body');
  });

  it('truncates body to 200 chars when includeBody=true', () => {
    const longBody = 'x'.repeat(500);
    const stdout = buildCommitRecord({
      sha: 'aaa',
      date: '2026-01-01T00:00:00Z',
      author: 'A',
      subject: 'long',
      body: longBody,
    });
    const out = parseCommitRecords(stdout, { includeBody: true });
    expect(out[0].body.length).toBe(BODY_TRUNCATE_CHARS + 1); // +1 for ellipsis
    expect(out[0].body.endsWith('…')).toBe(true);
  });

  it('handles subjects containing pipes/quotes/newlines (NUL/RS-delimited safety)', () => {
    const stdout = buildCommitRecord({
      sha: 'aaa',
      date: '2026-01-01T00:00:00Z',
      author: 'A',
      subject: 'feat: add | "quoted" and\nnewlined subject',
    });
    const out = parseCommitRecords(stdout);
    expect(out[0].subject).toBe('feat: add | "quoted" and\nnewlined subject');
  });
});

// -- parseCommitRecordsWithFiles --------------------------------------------

describe('parseCommitRecordsWithFiles', () => {
  it('parses commit + file list correctly', () => {
    const stdout = buildCommitRecordWithFiles({
      sha: 'aaa',
      date: '2026-01-01T00:00:00Z',
      author: 'A',
      subject: 'hello',
      files: ['lib/a.js', 'lib/b.js'],
    });
    const out = parseCommitRecordsWithFiles(stdout);
    expect(out).toHaveLength(1);
    expect(out[0].sha).toBe('aaa');
    expect(out[0].files).toEqual(['lib/a.js', 'lib/b.js']);
    expect(out[0]).not.toHaveProperty('filesTruncated');
  });

  it('handles commit with no files (e.g. merge commit emitted without --name-only output)', () => {
    const stdout =
      `${RECORD_SEP}aaa${FIELD_SEP}2026-01-01T00:00:00Z${FIELD_SEP}A${FIELD_SEP}empty`;
    const out = parseCommitRecordsWithFiles(stdout);
    expect(out).toHaveLength(1);
    expect(out[0].files).toEqual([]);
  });

  it('truncates files list at MAX_FILES_PER_COMMIT and reports true count', () => {
    const big = Array.from({ length: 250 }, (_, i) => `file${i}.js`);
    const stdout = buildCommitRecordWithFiles({
      sha: 'aaa',
      date: '2026-01-01T00:00:00Z',
      author: 'A',
      subject: 'big',
      files: big,
    });
    const out = parseCommitRecordsWithFiles(stdout);
    expect(out[0].files).toHaveLength(MAX_FILES_PER_COMMIT);
    expect(out[0].filesTruncated).toBe(250);
  });
});

// -- analyzeFileHistory integration -----------------------------------------

describe('analyzeFileHistory', () => {
  it('passes --follow + correct format + limit to git', async () => {
    let captured;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      captured = args;
      cb(null, '', '');
    });
    await analyzeFileHistory({ repoPath: realRepoPath, filePath: 'lib/foo.js', limit: 5 });
    expect(captured[0]).toBe('log');
    expect(captured).toContain('--max-count=5');
    expect(captured).toContain('--follow');
    expect(captured).toContain('--');
    expect(captured[captured.length - 1]).toBe('lib/foo.js');
    expect(captured.some(a => a.startsWith('--format='))).toBe(true);
  });

  it('returns parsed commits with returned count', async () => {
    const stdout =
      buildCommitRecord({ sha: 'aaa', date: 'd1', author: 'A', subject: 's1' }) +
      buildCommitRecord({ sha: 'bbb', date: 'd2', author: 'B', subject: 's2' });
    mockGitRepoAndStdout(stdout);
    const out = await analyzeFileHistory({ repoPath: realRepoPath, filePath: 'lib/foo.js' });
    expect(out.filePath).toBe('lib/foo.js');
    expect(out.returned).toBe(2);
    expect(out.commits).toHaveLength(2);
    expect(out.commits[0].sha).toBe('aaa');
  });

  it('clamps limit silently to MAX_FILE_HISTORY for huge values', async () => {
    let captured;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      captured = args;
      cb(null, '', '');
    });
    const out = await analyzeFileHistory({ repoPath: realRepoPath, filePath: 'lib/foo.js', limit: 9999 });
    expect(out.limit).toBe(MAX_FILE_HISTORY);
    expect(captured).toContain(`--max-count=${MAX_FILE_HISTORY}`);
  });

  it('accepts relative filePath under repoPath', async () => {
    mockGitRepoAndStdout('');
    await expect(
      analyzeFileHistory({ repoPath: realRepoPath, filePath: 'subdir/foo.js' })
    ).resolves.toBeDefined();
  });

  it('accepts absolute filePath inside repoPath', async () => {
    mockGitRepoAndStdout('');
    const abs = path.join(realRepoPath, 'inside.js');
    await expect(
      analyzeFileHistory({ repoPath: realRepoPath, filePath: abs })
    ).resolves.toBeDefined();
  });

  it('wraps git failure in GIT_ERROR with stderr', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      const err = new Error('git crashed');
      err.stderr = 'fatal: bad path';
      cb(err, '', err.stderr);
    });
    await expect(
      analyzeFileHistory({ repoPath: realRepoPath, filePath: 'lib/foo.js' })
    ).rejects.toThrow(/GIT_ERROR.*git crashed.*fatal: bad path/);
  });

  it('omits body by default and includes truncated body when requested', async () => {
    const longBody = 'x'.repeat(300);
    const stdout = buildCommitRecord({
      sha: 'aaa', date: 'd', author: 'A', subject: 's', body: longBody,
    });
    mockGitRepoAndStdout(stdout);
    const out1 = await analyzeFileHistory({ repoPath: realRepoPath, filePath: 'foo.js' });
    expect(out1.commits[0]).not.toHaveProperty('body');
    mockGitRepoAndStdout(stdout);
    const out2 = await analyzeFileHistory({
      repoPath: realRepoPath, filePath: 'foo.js', includeBody: true,
    });
    expect(out2.commits[0].body).toMatch(/x{200}…$/);
  });
});

// -- findRelatedChanges integration -----------------------------------------

describe('findRelatedChanges', () => {
  it('builds args with messagePattern only', async () => {
    let captured;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      captured = args;
      cb(null, '', '');
    });
    await findRelatedChanges({ repoPath: realRepoPath, messagePattern: 'rate.?limit' });
    expect(captured).toContain('-E');
    expect(captured).toContain('-i');
    expect(captured).toContain('--grep=rate.?limit');
    expect(captured).toContain('--name-only');
    expect(captured).not.toContain('--');
  });

  it('builds args with pathPattern only (uses -- separator)', async () => {
    let captured;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      captured = args;
      cb(null, '', '');
    });
    await findRelatedChanges({ repoPath: realRepoPath, pathPattern: 'lib/agents/**' });
    expect(captured).toContain('--');
    expect(captured[captured.length - 1]).toBe('lib/agents/**');
    expect(captured).not.toContain('--grep=');
  });

  it('builds args with both pathPattern and messagePattern', async () => {
    let captured;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      captured = args;
      cb(null, '', '');
    });
    await findRelatedChanges({
      repoPath: realRepoPath,
      pathPattern: 'lib/**',
      messagePattern: 'fix',
    });
    expect(captured).toContain('--grep=fix');
    expect(captured.indexOf('--')).toBeGreaterThanOrEqual(0);
    expect(captured[captured.length - 1]).toBe('lib/**');
  });

  it('returns parsed commits with files', async () => {
    const stdout =
      buildCommitRecordWithFiles({
        sha: 'aaa', date: 'd1', author: 'A', subject: 's1',
        files: ['lib/a.js', 'lib/b.js'],
      }) +
      buildCommitRecordWithFiles({
        sha: 'bbb', date: 'd2', author: 'B', subject: 's2',
        files: ['lib/c.js'],
      });
    mockGitRepoAndStdout(stdout);
    const out = await findRelatedChanges({ repoPath: realRepoPath, pathPattern: 'lib/**' });
    expect(out.returned).toBe(2);
    expect(out.commits[0].files).toEqual(['lib/a.js', 'lib/b.js']);
    expect(out.commits[1].files).toEqual(['lib/c.js']);
    expect(out.pathPattern).toBe('lib/**');
    expect(out.messagePattern).toBeNull();
  });

  it('clamps limit silently to MAX_RELATED_CHANGES for huge values', async () => {
    let captured;
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      captured = args;
      cb(null, '', '');
    });
    const out = await findRelatedChanges({
      repoPath: realRepoPath, messagePattern: 'fix', limit: 9999,
    });
    expect(out.limit).toBe(MAX_RELATED_CHANGES);
    expect(captured).toContain(`--max-count=${MAX_RELATED_CHANGES}`);
  });

  it('wraps git failure in GIT_ERROR', async () => {
    execFile.mockImplementation((cmd, args, opts, cb) => {
      if (args[0] === 'rev-parse') return cb(null, '.git\n', '');
      const err = new Error('git crashed');
      err.stderr = 'fatal: bad pathspec';
      cb(err, '', err.stderr);
    });
    await expect(
      findRelatedChanges({ repoPath: realRepoPath, pathPattern: 'foo' })
    ).rejects.toThrow(/GIT_ERROR.*git crashed.*fatal: bad pathspec/);
  });

  it('rejects messagePattern containing NUL byte', async () => {
    mockGitRepoAndStdout('');
    await expect(
      findRelatedChanges({ repoPath: realRepoPath, messagePattern: 'foo\x00bar' })
    ).rejects.toThrow(/NUL bytes/);
  });
});

// -- MCP plumbing -----------------------------------------------------------

describe('handleToolRequest', () => {
  it('routes analyze_file_history call and returns text content', async () => {
    mockGitRepoAndStdout(buildCommitRecord({
      sha: 'aaa', date: 'd', author: 'A', subject: 's',
    }));
    const res = await handleToolRequest({
      params: { name: 'analyze_file_history', arguments: { repoPath: realRepoPath, filePath: 'x' } },
    });
    expect(res.isError).toBeFalsy();
    expect(res.content[0].type).toBe('text');
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.returned).toBe(1);
    expect(parsed.commits[0].sha).toBe('aaa');
  });

  it('routes find_related_changes call and returns text content', async () => {
    mockGitRepoAndStdout(buildCommitRecordWithFiles({
      sha: 'aaa', date: 'd', author: 'A', subject: 's', files: ['x.js'],
    }));
    const res = await handleToolRequest({
      params: { name: 'find_related_changes', arguments: { repoPath: realRepoPath, pathPattern: '*.js' } },
    });
    expect(res.isError).toBeFalsy();
    const parsed = JSON.parse(res.content[0].text);
    expect(parsed.returned).toBe(1);
    expect(parsed.commits[0].files).toEqual(['x.js']);
  });

  it('returns isError=true for unknown tool', async () => {
    const res = await handleToolRequest({ params: { name: 'unknown', arguments: {} } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/unknown tool/);
  });

  it('surfaces INVALID_INPUT errors in the response', async () => {
    const res = await handleToolRequest({
      params: { name: 'analyze_file_history', arguments: { repoPath: '/not/exist', filePath: 'x' } },
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/INVALID_INPUT/);
  });
});
