# Report Validator

MCP server that validates Phase 1 (research) and Phase 2 (solution) report
structure against the canonical ai-issue-cli templates.

## Why

The agent self-writes a markdown report at the end of each phase. If the
report omits required sections (e.g. `## Code Location`) or includes
forbidden sections (e.g. `## Solution Summary`), the downstream `ai-issue
validate` command fails. This MCP server lets the agent **catch and fix
those structural issues before writing the report to disk**, eliminating a
round-trip.

## Tools

### `validate_phase1_report`

| Param | Type | Required | Description |
|---|---|---|---|
| `content` | string | yes | Full markdown content of the Phase 1 report |

Returns:

```json
{
  "valid": true,
  "missing_sections": [],
  "forbidden_sections": []
}
```

Phase 1 sections are matched as literal `## Section Name` headers (no
leading number).

### `validate_phase2_report`

Same input/output schema as Phase 1. Phase 2 section headers are expected
to be **numbered** (e.g. `## 1. Problem Analysis`); the matcher accepts
any leading integer.

## Single Source of Truth

The list of required / forbidden sections lives in
`data/report-sections.json` at the repo root. Both this skill and
`lib/report-validator.js` read from that file — keep them in lockstep with
the prompt templates under `prompts/`.

## Installation

```bash
cd skills/report-validator
npm install
```

## Manual Testing

Pipe a report through:

```bash
cat path/to/issue-123-research.md | node -e '
  const { validatePhase1Report } = require("./index.js");
  let s = ""; process.stdin.on("data", d => s += d).on("end", () => {
    console.log(JSON.stringify(validatePhase1Report(s), null, 2));
  });
'
```
