#!/usr/bin/env node
/**
 * Git History Analyzer - MCP Server (SKILLS_ENHANCEMENT_PLAN §C1 / §5)
 *
 * Two read-only tools that let the Phase 1 research agent query the local
 * git history without spending a tool call per `git log` invocation:
 *
 *   - analyze_file_history({ repoPath, filePath, limit?, includeBody? })
 *       → recent commits that touched a specific file, parsed into structured
 *         records (sha / author / date / subject / [body]).
 *
 *   - find_related_changes({ repoPath, pathPattern?, messagePattern?, limit? })
 *       → recent commits matching a pathspec OR a message regex, with the
 *         per-commit list of files actually touched. At least one of
 *         pathPattern / messagePattern must be provided.
 *
 * Hard input contract (per plan §C1 + §B-MVP rubber-duck v5 — same shape):
 *   - repoPath: required, string, must be an existing directory that is the
 *     working tree of a git repository (verified via `git rev-parse
 *     --git-dir`). Anything else → INVALID_INPUT.
 *   - filePath / pathPattern / messagePattern: validated as non-empty
 *     strings, no NUL bytes (defends against accidental corruption of our
 *     NUL/RS-delimited parse output, not against shell injection — execFile
 *     with an args array already handles that).
 *   - limit: clamped to [1, MAX] (50 for analyze_file_history, 100 for
 *     find_related_changes); out-of-range silently clamped, not rejected,
 *     so an LLM passing limit=999 still gets a useful result.
 *
 * Output context budget (per SKILLS_ENHANCEMENT_PLAN §upper bounds):
 *   - subject: full
 *   - body: truncated to 200 chars + ellipsis when includeBody=true; omitted
 *     when includeBody is falsy (default)
 *   - files (find_related_changes only): full list (commits with >100
 *     files are truncated to first 100 + total count)
 *
 * Implementation:
 *   - Uses child_process.execFile with an explicit args array (no shell) so
 *     pathPattern / messagePattern cannot inject git options.
 *   - All git invocations go through `runGit()` which resolves to
 *     `{stdout, stderr}`; this lets jest.mock('child_process') drive a
 *     trivial callback-based mock without depending on util.promisify's
 *     [util.promisify.custom] semantics (which jest does not preserve).
 *   - Output is parsed by a custom NUL/RS-delimited format so commit subjects
 *     containing newlines / quotes / pipes do not corrupt the parse.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const MAX_FILE_HISTORY = 50;
const DEFAULT_FILE_HISTORY = 10;
const MAX_RELATED_CHANGES = 100;
const DEFAULT_RELATED_CHANGES = 20;
const BODY_TRUNCATE_CHARS = 200;
const MAX_FILES_PER_COMMIT = 100;
const GIT_MAX_BUFFER = 10 * 1024 * 1024;

const FIELD_SEP = '\x1f'; // ASCII unit separator
const RECORD_SEP = '\x1e'; // ASCII record separator

// Format used by analyze_file_history (no --name-only):
//   %H sha, %aI iso date, %aN author, %s subject, %b body, RECORD_SEP terminator
// RS-as-terminator works here because nothing follows the body before the next
// commit. Body may contain arbitrary text (including newlines) — it is bounded
// by the trailing RECORD_SEP.
const COMMIT_FORMAT = `%H${FIELD_SEP}%aI${FIELD_SEP}%aN${FIELD_SEP}%s${FIELD_SEP}%b${RECORD_SEP}`;

// Format used by find_related_changes (uses --name-only, which interleaves
// file paths between commits). RECORD_SEP appears at the START so each
// split-block is `<header>\n<file>\n<file>\n` — header on the first line,
// files on subsequent lines. Body is intentionally omitted: with --name-only
// there's no way to distinguish body lines from file lines.
const COMMIT_FORMAT_HEADER_ONLY = `${RECORD_SEP}%H${FIELD_SEP}%aI${FIELD_SEP}%aN${FIELD_SEP}%s`;

/**
 * Promise-wrapped execFile so jest.mock('child_process') with a callback-style
 * mock works without needing to special-case util.promisify.custom.
 */
function runGit(repoPath, args) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd: repoPath, maxBuffer: GIT_MAX_BUFFER },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = stderr;
          err.stdout = stdout;
          return reject(err);
        }
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    );
  });
}

function ensureNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`INVALID_INPUT: ${name} required (non-empty string)`);
  }
  if (value.includes('\x00')) {
    throw new Error(`INVALID_INPUT: ${name} must not contain NUL bytes`);
  }
}

function clampLimit(value, fallback, max) {
  if (value === undefined || value === null) return fallback;
  const n = Number(value);
  if (Number.isNaN(n) || n <= 0) return fallback;
  if (!Number.isFinite(n)) return max;
  return Math.min(Math.floor(n), max);
}

async function ensureGitRepo(repoPath) {
  if (typeof repoPath !== 'string' || !repoPath) {
    throw new Error('INVALID_INPUT: repoPath required (string)');
  }
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) {
    throw new Error(
      `INVALID_INPUT: repoPath does not exist or is not a directory: ${repoPath}`
    );
  }
  try {
    await runGit(repoPath, ['rev-parse', '--git-dir']);
  } catch (err) {
    throw new Error(
      `INVALID_INPUT: repoPath is not a git working tree: ${repoPath}`
    );
  }
}

/**
 * Parse the NUL/RS-delimited stdout produced by `git log --format=COMMIT_FORMAT`.
 * Returns an array of { sha, date, author, subject, body } records; empty
 * records (trailing RS) are skipped.
 */
function parseCommitRecords(stdout, { includeBody = false } = {}) {
  const records = [];
  if (!stdout) return records;
  const chunks = stdout.split(RECORD_SEP);
  for (const chunk of chunks) {
    const trimmed = chunk.replace(/^\n+/, '');
    if (!trimmed) continue;
    const fields = trimmed.split(FIELD_SEP);
    if (fields.length < 5) continue;
    const [sha, date, author, subject, body] = fields;
    if (!sha) continue;
    const record = { sha, date, author, subject };
    if (includeBody) {
      const cleaned = (body || '').trim();
      record.body = cleaned.length > BODY_TRUNCATE_CHARS
        ? cleaned.slice(0, BODY_TRUNCATE_CHARS) + '…'
        : cleaned;
    }
    records.push(record);
  }
  return records;
}

/**
 * `git log --name-only` (with COMMIT_FORMAT_HEADER_ONLY) emits commits
 * separated by RS, where each block is `<header>\n<file>\n<file>\n`. Files
 * are everything from the first newline up to the next RS.
 */
function parseCommitRecordsWithFiles(stdout) {
  const commits = [];
  if (!stdout) return commits;
  const blocks = stdout.split(RECORD_SEP);
  for (const rawBlock of blocks) {
    if (!rawBlock) continue;
    // Strip any leading whitespace/newlines (defensive — not expected since
    // RECORD_SEP leads the format).
    const block = rawBlock.replace(/^\s+/, '');
    if (!block) continue;
    const newlineIdx = block.indexOf('\n');
    let header;
    let filesText;
    if (newlineIdx === -1) {
      header = block;
      filesText = '';
    } else {
      header = block.slice(0, newlineIdx);
      filesText = block.slice(newlineIdx + 1);
    }
    const fields = header.split(FIELD_SEP);
    if (fields.length < 4) continue;
    const [sha, date, author, subject] = fields;
    if (!sha) continue;
    const allFiles = filesText
      .split('\n')
      .map(l => l.trim())
      .filter(l => l.length > 0);
    const truncated = allFiles.length > MAX_FILES_PER_COMMIT;
    const files = truncated ? allFiles.slice(0, MAX_FILES_PER_COMMIT) : allFiles;
    const record = { sha, date, author, subject, files };
    if (truncated) record.filesTruncated = allFiles.length;
    commits.push(record);
  }
  return commits;
}

async function analyzeFileHistory(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('INVALID_INPUT: arguments object required');
  }
  const { repoPath, filePath, includeBody } = args;
  await ensureGitRepo(repoPath);
  ensureNonEmptyString(filePath, 'filePath');
  // Resolve filePath under repoPath (handles both absolute filePaths under
  // repoPath and relative filePaths that may try to escape via `..`).
  const repoReal = path.resolve(repoPath);
  const candidateAbs = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(repoReal, filePath);
  const rel = path.relative(repoReal, candidateAbs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(
      `INVALID_INPUT: filePath "${filePath}" resolves outside repoPath`
    );
  }
  const limit = clampLimit(args.limit, DEFAULT_FILE_HISTORY, MAX_FILE_HISTORY);

  // `--` disambiguates path from rev; `--follow` traces renames so that file
  // moves don't truncate the history at the rename commit.
  const gitArgs = [
    'log',
    `--max-count=${limit}`,
    `--format=${COMMIT_FORMAT}`,
    '--follow',
    '--',
    filePath,
  ];
  let stdout;
  try {
    ({ stdout } = await runGit(repoPath, gitArgs));
  } catch (err) {
    throw new Error(
      `GIT_ERROR: git log for "${filePath}" failed: ${err.message}` +
        (err.stderr ? ` | stderr: ${String(err.stderr).trim()}` : '')
    );
  }
  const commits = parseCommitRecords(stdout, { includeBody: !!includeBody });
  return {
    filePath,
    limit,
    returned: commits.length,
    commits,
  };
}

async function findRelatedChanges(args) {
  if (!args || typeof args !== 'object') {
    throw new Error('INVALID_INPUT: arguments object required');
  }
  const { repoPath, pathPattern, messagePattern } = args;
  await ensureGitRepo(repoPath);
  if (!pathPattern && !messagePattern) {
    throw new Error(
      'INVALID_INPUT: at least one of pathPattern or messagePattern is required'
    );
  }
  if (pathPattern !== undefined) ensureNonEmptyString(pathPattern, 'pathPattern');
  if (messagePattern !== undefined) ensureNonEmptyString(messagePattern, 'messagePattern');
  const limit = clampLimit(args.limit, DEFAULT_RELATED_CHANGES, MAX_RELATED_CHANGES);

  const gitArgs = [
    'log',
    `--max-count=${limit}`,
    `--format=${COMMIT_FORMAT_HEADER_ONLY}`,
    '--name-only',
  ];
  if (messagePattern) {
    // -E for extended regex; -i keeps "OIDC" / "oidc" matches.
    gitArgs.push('-E', '-i', `--grep=${messagePattern}`);
  }
  if (pathPattern) {
    gitArgs.push('--', pathPattern);
  }

  let stdout;
  try {
    ({ stdout } = await runGit(repoPath, gitArgs));
  } catch (err) {
    throw new Error(
      `GIT_ERROR: git log search failed: ${err.message}` +
        (err.stderr ? ` | stderr: ${String(err.stderr).trim()}` : '')
    );
  }
  const commits = parseCommitRecordsWithFiles(stdout);
  return {
    limit,
    pathPattern: pathPattern || null,
    messagePattern: messagePattern || null,
    returned: commits.length,
    commits,
  };
}

const server = new Server(
  { name: 'git-history-analyzer', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'analyze_file_history',
      description: `Return the most recent N commits that touched a given file (with --follow so renames don't truncate). Use this in Phase 1 when you need the change history of a specific file (e.g. "who last touched lib/foo.js and why?") instead of spawning a shell to run \`git log\`. The skill returns structured records — sha, ISO date, author name, subject, and (optionally) a 200-char-truncated body. Limit is clamped to [1, ${MAX_FILE_HISTORY}].

Input:
  - repoPath (string, required): absolute path to the git working tree
  - filePath (string, required): file path relative to repoPath (or absolute under it)
  - limit (number, optional, default ${DEFAULT_FILE_HISTORY}, max ${MAX_FILE_HISTORY})
  - includeBody (boolean, optional, default false): include 200-char-truncated commit body

Output: { filePath, limit, returned, commits: [{sha, date, author, subject[, body]}] }`,
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Absolute path to git working tree' },
          filePath: { type: 'string', description: 'File path (relative to repoPath or absolute under it)' },
          limit: { type: 'number', description: `Max commits (default ${DEFAULT_FILE_HISTORY}, capped at ${MAX_FILE_HISTORY})` },
          includeBody: { type: 'boolean', description: 'Include 200-char-truncated body (default false)' },
        },
        required: ['repoPath', 'filePath'],
      },
    },
    {
      name: 'find_related_changes',
      description: `Find commits matching a path pattern (git pathspec) AND/OR a commit-message regex (case-insensitive extended POSIX). Use this in Phase 1 to discover prior work on a feature area or topic (e.g. pathPattern="lib/agents/**", messagePattern="rate.?limit"). Returns structured records including the file list each commit touched (truncated to ${MAX_FILES_PER_COMMIT} per commit). Limit is clamped to [1, ${MAX_RELATED_CHANGES}].

At least one of pathPattern or messagePattern is required.

Input:
  - repoPath (string, required): absolute path to the git working tree
  - pathPattern (string, optional): git pathspec (supports globs like "lib/**.js")
  - messagePattern (string, optional): extended POSIX regex matched against commit message (case-insensitive)
  - limit (number, optional, default ${DEFAULT_RELATED_CHANGES}, max ${MAX_RELATED_CHANGES})

Output: { limit, pathPattern, messagePattern, returned, commits: [{sha, date, author, subject, files[], filesTruncated?}] }`,
      inputSchema: {
        type: 'object',
        properties: {
          repoPath: { type: 'string', description: 'Absolute path to git working tree' },
          pathPattern: { type: 'string', description: 'git pathspec (glob ok)' },
          messagePattern: { type: 'string', description: 'Extended POSIX regex against commit message (case-insensitive)' },
          limit: { type: 'number', description: `Max commits (default ${DEFAULT_RELATED_CHANGES}, capped at ${MAX_RELATED_CHANGES})` },
        },
        required: ['repoPath'],
      },
    },
  ],
}));

async function handleToolRequest(request) {
  const { name, arguments: args } = request.params;
  try {
    let result;
    if (name === 'analyze_file_history') {
      result = await analyzeFileHistory(args);
    } else if (name === 'find_related_changes') {
      result = await findRelatedChanges(args);
    } else {
      return {
        content: [{ type: 'text', text: `Error: unknown tool ${name}` }],
        isError: true,
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Error from ${name}: ${err.message}` }],
      isError: true,
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, handleToolRequest);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Git History Analyzer MCP Server running on stdio');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  analyzeFileHistory,
  findRelatedChanges,
  handleToolRequest,
  __internal: {
    runGit,
    ensureGitRepo,
    ensureNonEmptyString,
    clampLimit,
    parseCommitRecords,
    parseCommitRecordsWithFiles,
    constants: {
      MAX_FILE_HISTORY,
      DEFAULT_FILE_HISTORY,
      MAX_RELATED_CHANGES,
      DEFAULT_RELATED_CHANGES,
      BODY_TRUNCATE_CHARS,
      MAX_FILES_PER_COMMIT,
      FIELD_SEP,
      RECORD_SEP,
      COMMIT_FORMAT,
      COMMIT_FORMAT_HEADER_ONLY,
    },
  },
};
