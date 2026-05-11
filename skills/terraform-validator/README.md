# Terraform Validator

MCP server providing pre-commit static checks for
[hashicorp/terraform-provider-azurerm](https://github.com/hashicorp/terraform-provider-azurerm)
style Go changes. Designed to be called from Phase 2 (and the rubber-duck
critique pass) before committing.

> **B-MVP scope**: field-naming consistency only (`d.Set/Get("key")` ↔
> Schema declarations). Schema-rule checks (Optional+Computed,
> `Get`-vs-`GetOk`) and Read-function nil-safety land in **B-Extend** as a
> follow-up PR.

## Tool

### `validate_terraform_changes`

| Param | Type | Required | Description |
|---|---|---|---|
| `repoPath` | string | yes | Absolute path to repo root |
| `files` | string[] | yes | Non-empty list of modified file paths (relative to `repoPath` or absolute under it) |

Returns:

```json
{
  "findings": [
    {
      "rule": "field-naming-undeclared",
      "file": "azurerm/internal/services/foo/foo_resource.go",
      "line": 124,
      "severity": "high",
      "message": "d.Set(\"runtime_env\", ...) references a key not declared in any top-level Schema in this file."
    }
  ],
  "summary": "Validated 1 terraform file(s); found 1 finding(s) (high=1, medium=0)."
}
```

### Self-skip behavior

If `files[]` contains no `*_resource.go` / `*_resource_gen.go` /
`*_data_source.go` entries, the validator returns:

```json
{ "findings": [], "summary": "no terraform provider files in scope, validator skipped" }
```

This makes it safe to call the tool from PHASE2 conditionally without
poisoning non-Terraform projects.

## Findings

| Rule | Severity | Trigger |
|---|---|---|
| `field-naming-undeclared` | **high** | `d.Set/Get/GetOk/GetOkExists("key")` where `"key"` is not declared in any top-level Schema in the file. Indicates a typo or missing Schema entry — must be fixed before commit. |
| `field-naming-case` | **medium** | Same call but the snake↔camel counterpart is declared (e.g. Schema has `runtime_environment`, accessor uses `runtimeEnvironment`). Align the accessor with the schema spelling. |

## How it works

1. Find every `Schema: map[string]*pluginsdk.Schema {...}` literal in the
   file. Use a brace-balanced parser that skips Go string literals
   (double-quoted with escapes, raw backtick strings) and both line/block
   comments — pure regex is insufficient because schemas commonly nest
   via `Elem: &pluginsdk.Resource{Schema: ...}`.
2. Determine top-level vs nested via byte-range containment.
3. Collect direct-child keys at depth 1 of each top-level Schema.
4. Find all parameter names declared as `*schema.ResourceData` or
   `*pluginsdk.ResourceData` (varname doesn't have to be `d`; `rd`,
   `data`, `resourceData` all work).
5. Cross-check every `<varname>.(Set|Get|GetOk|GetOkExists)("key")` call
   against the top-level key set; emit findings.

## Hard input contract

| Violation | Result |
|---|---|
| Missing `repoPath` | MCP error `INVALID_INPUT: repoPath required (string)` |
| `repoPath` does not exist or isn't a directory | MCP error `INVALID_INPUT: repoPath does not exist or is not a directory: ...` |
| Missing or empty `files[]` | MCP error `INVALID_INPUT: files[] required (non-empty array of modified file paths)` |
| File path resolves outside `repoPath` (`../escape`) | MCP error `INVALID_INPUT: file "..." resolves outside repoPath` |

This is deliberate — the validator must NOT do whole-repo scans and must
NOT read files outside the repo. The agent is responsible for passing the
modified file list (typically derived from `git diff --name-only`).

## Known B-MVP limitations

- **Dot-navigation skipped**: `d.Get("network_rule_set.0.bypass")` is
  intentionally not validated. Nested-resource accessor validation is
  deferred (regex-only approach has too many false-positive shapes).
- **Multiple `*ResourceData` parameters**: Functions taking more than one
  `*ResourceData` arg are handled by aggregating all matching varnames
  globally — the rare case where the same varname refers to a non-RD
  variable in another function may produce a false positive. azurerm
  convention is `d` everywhere so this is acceptable.
- **Cross-SDK validation out of scope**: Whether a schema field name
  matches an external SDK struct field is the LLM's job (use
  `grep_search` against the upstream SDK source).
- **Per-function scoping**: ResourceData varname identification is
  file-scoped, not function-scoped. Functions in the same file that reuse
  a varname for an unrelated purpose may produce false positives.

## Installation

```bash
cd skills/terraform-validator
npm install
```

## Manual smoke

```bash
node -e '
  const v = require("./index.js");
  v.validateTerraformChanges({
    repoPath: "/path/to/terraform-provider-azurerm",
    files: ["internal/services/foo/foo_resource.go"]
  }).then(r => console.log(JSON.stringify(r, null, 2)));
'
```
