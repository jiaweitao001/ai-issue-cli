# Phase 1: Deep Research

## Core Task

Conduct **comprehensive technical research** on the Issue to provide a solid foundation for Phase 2.

⚠️ **No solutions should be proposed in this phase** - only information gathering and analysis.

## Independent Thinking Requirements

- ❌ Do not look at the PR code that fixes this Issue (if it exists)
- ❌ Do not look at solutions directly given in Issue comments
- ✅ Can review discussions in the Issue that analyze the problem
- ✅ Can review maintainer replies to understand technical constraints

## Key Principles

⚠️ **Stack trace ≠ Root cause** - Don't just look at the function pointed to by the error stack, must comprehensively check all related functions (CRUD) and call chains

⚠️ **Precise targeting** - Focus your research on the exact file/line number the Issue points to, don't diverge to "related" files

⚠️ **No assumptions** - Don't assume the issue has been fixed by another PR, don't infer root cause from error log surface symptoms

---

## Mandatory Research Checklist

### 1. Find Similar Implementations ⭐⭐⭐ (Most Critical)

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

Create `issue-[number]-research.md`, containing:

```markdown
# Issue #[number] Research Report

## Problem Overview
[Brief description of the problem, affected resources, error messages]

## Initial Hypotheses
1. Hypothesis A - To be verified
2. Hypothesis B - To be verified

## Code Location
- Main file: [path]
- Key function: [name] (line number)

## Similar Implementation Comparison ⭐
- Similar resource: [file path]
- Key difference: [It uses X, current uses Y]
- Why no problem: [reason]

## SDK Tools ⭐
- Function: `XXX.ValidateYYY` 
- Path: [package path]
- Applicability: Yes/No, [reason]

## History Analysis
- Commit [hash]: [description]
- Issue introduction time: [estimate]

## Global Impact
- [ ] Create function (path:line)
- [ ] Update function (path:line)
- [ ] Read function (path:line)
- [ ] Delete function (path:line)
- [ ] Related resources: [name]

## Key Findings ⭐
1. [Most important finding]
2. [Second most important]
3. [Third most important]

## Next Steps Recommendations
- [ ] Prioritize verifying hypothesis [X]
- [ ] Reference [similar implementation]
- [ ] Use SDK function [name]
- [ ] Modify all [location list]
```

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
