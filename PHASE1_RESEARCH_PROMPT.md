# Phase 1: Deep Research

## Core Task

Conduct **comprehensive technical research** on the Issue to provide a solid foundation for Phase 2.

⚠️ **No solutions should be proposed in this phase** - only information gathering and analysis.

## Available Skills (Use These First)

You have access to specialized tools to accelerate research:

### `get_issue_context` - Fetch Issue Details
```json
{
  "repo": "hashicorp/terraform-provider-azurerm",
  "number": 30340,
  "include": ["comments", "timeline", "linked_prs"]
}
```
Use this FIRST to get structured issue data including comments and linked PRs.

### `find_similar_implementations` - Find Similar Code
```json
{
  "file_path": "/path/to/target_resource.go",
  "scope": "service",
  "limit": 5
}
```
Use this to automatically find similar resource implementations instead of manual `ls` and `grep`.

### `find_similar_issues` - Find Similar Historical Issues
```json
{
  "repo": "hashicorp/terraform-provider-azurerm",
  "issue_number": 30340,
  "title": "<ISSUE_TITLE>",
  "body": "<ISSUE_BODY>",
  "include_solutions": true
}
```
Use this to search for historically similar issues and extract solutions from their comments.
**Important**: Always include `title` and `body` — the backend needs them to compute similarity when the issue has no pre-computed embedding.

### `check_existing_research` - Check Existing Team Research
```json
{
  "repo": "hashicorp/terraform-provider-azurerm",
  "issue_number": 30340
}
```
Use this FIRST to check if teammates have already researched this or a similar issue. Avoid duplicating work.

---

## Key Principles

⚠️ **Stack trace ≠ Root cause** - Don't just look at the function pointed to by the error stack, must comprehensively check all related functions (CRUD) and call chains

⚠️ **Precise targeting** - Focus your research on the exact file/line number the Issue points to, don't diverge to "related" files

⚠️ **No assumptions** - Don't assume the issue has been fixed by another PR, don't infer root cause from error log surface symptoms

---

## Mandatory Research Checklist

### -1. Check Existing Team Research ⭐⭐⭐ (VERY FIRST — Before Everything)

Use `check_existing_research` to see if your teammates have already researched this or a similar issue:
```json
{
  "repo": "hashicorp/terraform-provider-azurerm",
  "issue_number": <ISSUE_NUMBER>
}
```

**If relevant research is found**:
- Read the report summary and key findings
- Use it as your starting point — DON'T redo analysis that's already been done
- Focus your research on verifying whether findings still apply and filling gaps
- Reference the previous research in your report

**If no research is found**:
- Proceed with the standard research checklist below

### 0. Check Similar Historical Issues ⭐⭐⭐ (FIRST — Before Code Research)

Use `find_similar_issues` to check if this problem has been reported and solved before:
```json
{
  "repo": "hashicorp/terraform-provider-azurerm",
  "issue_number": <ISSUE_NUMBER>,
  "title": "<ISSUE_TITLE>",
  "body": "<ISSUE_BODY>",
  "include_solutions": true
}
```

**Must document in report**:
- Similar issues found (score, title, URL, state)
- Whether solutions from similar issues are applicable
- If a previously-fixed issue reappeared → note as potential regression
- If no similar issues found → note "No historical matches"

**How to use the results**:
- If a similar issue was fixed by a PR → examine that PR's approach as a strong reference
- If solutions were extracted → validate them against the current codebase state
- Cross-reference with the code research you do in subsequent steps

### 1. Find Similar Implementations ⭐⭐⭐ (Most Critical)

**Preferred**: Use `find_similar_implementations` tool with scope "service" or "directory"

**Alternative** (if tool unavailable):
```bash
# Find similar resources in the same directory
ls -la path/to/resource/directory/

# Example: pim_eligible → find pim_active
# Compare differences between them, understand why other resources don't have this issue
```

**Must document**:
- Similar resource file paths
- Key implementation differences
- Why it doesn't have the problem
- **Exact field naming** (check SDK struct, note `_id`/`_name`/`_type` suffixes)

### 2. Search SDK Tools ⭐⭐

```bash
# Search for validation functions
grep -r "Validate.*ID\|Parse.*ID" vendor/

# Check already imported SDK packages
```

**Must document**:
- Found SDK function names and paths
- Whether applicable to current scenario

### 3. Check Code History ⭐

```bash
# Find recent changes
git log --oneline -20 -- path/to/file.go

# Search specific field changes
git log -p -S "field_name" -- path/to/file.go
```

**Must document**:
- Relevant commits from last 3 months
- When the issue was likely introduced

### 4. Identify Global Impact

```bash
# Search all usage locations of the field
grep -r "field_name" internal/services/
```

**Must document**:
- Create/Update/Read/Delete function locations
- Related resources (nested configurations, etc.)
- Locations that need synchronized modifications

### 5. Official Documentation

- Check Azure/AWS documentation for recommended practices
- Confirm expected API behavior

---

## Output Requirements

⚠️ **Only create `issue-[number]-research.md` - delete all other temporary files before finishing**

⚠️ **COPY the template below EXACTLY and ONLY fill in the `[...]` placeholders. Do NOT add, remove, or rename any sections.**

### Forbidden Sections (DO NOT ADD)

- ❌ `## Summary`
- ❌ `## Conclusion`
- ❌ `## Recommendations`
- ❌ `## Additional Notes`
- ❌ Any section not in the template below

---

### ===== MANDATORY TEMPLATE START =====

```markdown
# Issue #[NUMBER] Research Report

## Problem Classification

**Type**: [🔧 CODE_CHANGE / 📖 GUIDANCE]

**Justification**: [One sentence explaining why this classification]

### Classification Criteria Reference
- 🔧 CODE_CHANGE: Bug fixes, missing features (already GA), validation issues, SDK not mapped, etc.
- 📖 GUIDANCE: User error, by design, needs upgrade, feature in preview, workaround sufficient, insufficient info

## Problem Overview

[2-3 sentences: what is the problem, affected resources, error messages]

## Initial Hypotheses

1. [Hypothesis A] - To be verified
2. [Hypothesis B] - To be verified

## Similar Historical Issues

| Score | Issue | State | Applicable? |
|-------|-------|-------|---------|
| [0.XX] | [#NNNNN - Title](URL) | [open/closed] | [Yes/No - reason] |

**Extracted Solutions**: [Summary of solutions from similar issues, or "No applicable solutions found"]

**Regression Check**: [Is this a regression of a previously fixed issue? Yes/No]

## Code Location

- Main file: `[path/to/file.go]`
- Key function: `[FunctionName]` (line [N])

## Similar Implementation Comparison

- Similar resource: `[path/to/similar_resource.go]`
- Key difference: [What it does differently]
- Why no problem: [Explanation]

## SDK Tools

- Function: `[package.FunctionName]`
- Path: `[vendor/path/to/package]`
- Applicability: [Yes/No] - [Reason]

## History Analysis

- Commit `[hash]`: [Description]
- Issue likely introduced: [Date or version estimate]

## Global Impact

- [ ] Create function: `[path:line]`
- [ ] Update function: `[path:line]`
- [ ] Read function: `[path:line]`
- [ ] Delete function: `[path:line]`
- [ ] Related resources: `[resource_name]`

## Key Findings

1. [Most important finding]
2. [Second most important finding]
3. [Third most important finding]

## Next Steps

- [ ] Verify hypothesis: [Which one]
- [ ] Reference implementation: `[file path]`
- [ ] Use SDK function: `[function name]`
- [ ] Modify locations: [List]
```

### ===== MANDATORY TEMPLATE END =====

---

## Quality Check

Confirm before completion:
- [ ] Found at least 1 similar implementation
- [ ] Searched for SDK utility functions
- [ ] Reviewed git history
- [ ] Identified specific location (file/line number) pointed to by Issue
- [ ] Read official documentation
- [ ] **Did not assume the issue has been fixed by another PR**
- [ ] **Research scope is consistent with Issue description, no divergence**
- [ ] **Confirmed exact field naming** (SDK struct field name → Terraform field name)
- [ ] **Reviewed test patterns for similar fields**
