# Git History Analyzer

MCP server exposing two read-only `git log` queries for the Phase 1 research
agent so it doesn't have to spawn a shell-per-question to investigate a file's
history or find prior work on a topic.

## Tools

### `analyze_file_history`

Return the most recent N commits that touched a given file. Uses
`git log --follow` so file renames don't silently truncate the history.

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | string | yes | Absolute path to the git working tree |
| `filePath` | string | yes | File path (relative to `repoPath` or absolute under it) |
| `limit` | number | no | Max commits (default 10, capped at 50) |
| `includeBody` | boolean | no | If true, return a 200-char-truncated body per commit (default false) |

Returns:

```json
{
  "filePath": "lib/agents/copilot-agent.js",
  "limit": 10,
  "returned": 3,
  "commits": [
    {
      "sha": "abc1234",
      "date": "2026-05-11T15:00:00+08:00",
      "author": "Jane Doe",
      "subject": "Fix race in agent shutdown",
      "body": "Closes #42…"
    }
  ]
}
```

### `find_related_changes`

Find commits matching a path pattern (git pathspec) AND/OR a commit-message
regex (case-insensitive extended POSIX). Returns the file list each commit
touched (capped at 100 files per commit; `filesTruncated` reports the true
count when capped).

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | string | yes | Absolute path to the git working tree |
| `pathPattern` | string | conditional | git pathspec (glob OK) |
| `messagePattern` | string | conditional | Extended POSIX regex against commit message (case-insensitive) |
| `limit` | number | no | Max commits (default 20, capped at 100) |

At least one of `pathPattern` / `messagePattern` is required.

Returns:

```json
{
  "limit": 20,
  "pathPattern": "lib/agents/**",
  "messagePattern": "rate.?limit",
  "returned": 2,
  "commits": [
    {
      "sha": "def5678",
      "date": "2026-05-10T12:00:00+08:00",
      "author": "Jane Doe",
      "subject": "Add rate-limit detection",
      "files": ["lib/agents/copilot-agent.js", "lib/agents/claude-code-agent.js"]
    }
  ]
}
```

## Hard input contract

| Violation | Result |
|---|---|
| Missing/non-string `repoPath` | `INVALID_INPUT: repoPath required (string)` |
| `repoPath` does not exist or isn't a directory | `INVALID_INPUT: repoPath does not exist or is not a directory: ...` |
| `repoPath` is not a git working tree | `INVALID_INPUT: repoPath is not a git working tree: ...` |
| Missing/empty `filePath` (analyze_file_history) | `INVALID_INPUT: filePath required (non-empty string)` |
| Absolute `filePath` escapes `repoPath` | `INVALID_INPUT: filePath "..." resolves outside repoPath` |
| Relative `filePath` escapes `repoPath` via `..` | `INVALID_INPUT: filePath "..." resolves outside repoPath` |
| Neither `pathPattern` nor `messagePattern` (find_related_changes) | `INVALID_INPUT: at least one of pathPattern or messagePattern is required` |
| String containing NUL bytes | `INVALID_INPUT: <field> must not contain NUL bytes` |

Out-of-range `limit` values (negative, zero, NaN, > max) are silently
clamped to a sensible default rather than rejected — the LLM may pass any
plausible number and still get useful output.

## Context budget

Per `SKILLS_ENHANCEMENT_PLAN.md` upper bounds:

- `subject` is returned in full
- `body` is **omitted by default**; with `includeBody: true` it is truncated
  to the first 200 chars + ellipsis
- `files` in `find_related_changes` is capped at 100 entries per commit
  (true count reported via `filesTruncated`)
- `limit` is clamped: 50 (file history) / 100 (related changes)
- `git log` stdout is read with a 10 MB `maxBuffer` so a runaway log on a
  long-lived file can't blow up node's heap

## Implementation notes

- Uses `child_process.execFile` with an explicit args array (no shell), so
  `pathPattern` / `messagePattern` cannot inject `git` options.
- Output uses non-printable separators (`\x1f` field, `\x1e` record) so
  commit subjects containing newlines, pipes, or quotes do not corrupt the
  parse.
- `runGit()` wraps `execFile` in a manual Promise so unit tests can mock
  `child_process` with a callback-style stub without depending on
  `util.promisify.custom`.
- `--follow` is used for `analyze_file_history` so file renames don't
  truncate the history. (git only supports `--follow` for a single
  pathspec, which is exactly our shape.)

## Installation

```bash
cd skills/git-history-analyzer
npm install
```

## Manual smoke

```bash
node -e '
  const a = require("./index.js");
  Promise.all([
    a.analyzeFileHistory({ repoPath: ".", filePath: "package.json", limit: 3 }),
    a.findRelatedChanges({ repoPath: ".", pathPattern: "lib/**", limit: 5 }),
  ]).then(([h, r]) => console.log(JSON.stringify({ history: h, related: r }, null, 2)));
'
```
