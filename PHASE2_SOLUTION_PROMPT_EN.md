# Phase 2: Solution Implementation

Based on Phase 1 research, design and implement a high-quality solution.

---

## ⚠️ Key Constraints (Most Important, Must Read)

### 1. Minimal Change Principle
- **Only fix the issue explicitly stated** - don't fix other issues "discovered along the way"
- If 1 line can fix it, don't change 3 lines; if existing patterns work, don't introduce new abstractions
- Additional improvements should be separate Issues/PRs, not mixed into current fix

### 2. Strictly Follow Issue Scope
- Fix **only where** the Issue points to (file/line number)
- Distinguish "what Issue requires" from "what I think should be improved" - only do the former
- Don't infer from error log symptoms, analyze root cause

### 3. Avoid Over-Engineering
- ❌ Don't add logs not requested by Issue
- ❌ Don't create new helper functions (unless existing code already has this pattern)
- ❌ Don't modify other files for "consistency"
- ❌ Don't assume all CRUD needs modification (unless Issue explicitly requires)
- ❌ Don't add tests the project doesn't need

### 4. Verify Assumptions
- Don't assume the issue "has been fixed by another PR"
- Reference historical PRs of similar Issues to understand project fix style
- If uncertain, adopt the **simplest** fix approach

> **Remember: Open source projects prefer minimal changes to reduce risk. "Doing more" ≠ "Doing better".**

### 5. High-Frequency Fatal Errors ⚠️

- **Field naming must be exact** - Check SDK struct to confirm, don't guess (e.g., `runtime_environment` vs `runtime_environment_name`)
- **New fields must have tests** - No matter how simple, acceptance tests cannot be omitted
- **Optional fields use `d.GetOk()`** - Don't use `d.Get()` directly, it will pass empty strings
- **Use `pointer.From()` in Read** - Safely handle nil values

---

## 📚 Reference Cases (Correct vs Wrong)

### Case 1: Issue #30849 (SKU Validation Missing)
- **Issue requires**: `HS_S_` SKU incorrectly rejected for setting `min_capacity`, CustomizeDiff only checked `GP_S_`
- **Standard fix**: Append `&& !strings.HasPrefix(..., "HS_S_")` after existing condition on line 120
- **Change amount**: 1 line
- **Common mistakes**: Creating `isServerlessSku()` helper function, modifying Create/Update functions (not requested by Issue)

### Case 2: Issue #31045 (Error After Resource Deletion)
- **Issue requires**: After manually deleting `storage_table_entity`, terraform plan errors, Read function lacks 404 handling
- **Standard fix**: Add `if response.WasNotFound(...) { d.SetId(""); return nil }` in Read function
- **Change amount**: 4 lines
- **Common mistakes**: Also handling 403, adding logs, modifying test files (not requested by Issue)

> **Learn from cases**: Standard fixes are **minimal changes**, only modify where Issue points to, don't expand scope.

---

## Core Principles

- 🎯 **Fix root cause, not symptoms** - Solve the root cause, don't work around the problem
- 🔍 **Reference first** - Use similar implementations and SDK functions found in research
- 📐 **Minimal modification** - Only fix issues explicitly stated (see constraints above)
- 🔐 **Dynamic validation** - CustomizeDiff uses API calls instead of hardcoding
- 📝 **Rigorous Schema** - Optional uses Default not Computed; add ValidateFunc for format requirements

## Independent Thinking Requirements

- ❌ Do not look at the PR code that fixes this Issue (if it exists)
- ❌ Do not look at solutions directly given in Issue comments
- ✅ Must independently design solution based on Phase 1 research results

---

## Output Requirements

⚠️ **Only create `issue-[number]-analysis.md` - delete all other temporary files before finishing**

**Using the following format**:

```markdown
# Issue #[number] Solution

## 1. Problem Analysis
- Problem symptoms
- Root cause
- Impact scope

## 2. Code Investigation
- Key file paths
- Related functions/classes/modules
- Discovered problem points

## 3. Solution
- Fix approach
- Specific implementation method

## 4. Code Changes

### Git Operation Record
- Branch name: issue-XXX
- Commit Hash: [hash]

### Modified Files
- `path/to/file.go` - Modification description

### Commit Message
```
[Complete commit message]
```

## 5. Test Changes

### Test File Modifications
- Modified test file paths
- New or modified test cases
- Test run results

## 6. Documentation Updates (If Applicable)
- Updated documentation file paths
- Modification description

## 7. Verification Method
- Test steps
- Expected results

## 8. Potential Impact
- Whether it affects other functionality
- Whether additional modifications are needed

## 9. Pre-submission Checklist (Required) ⚠️

| Check Item | Yes/No | Notes |
|------------|--------|-------|
| Modified files match Issue target? | | |
| Modification scope within Issue description? | | |
| No new functions/abstractions introduced? | | |
| No logs added that Issue didn't request? | | |
| Reasonable code line changes? (+/- lines) | | |
| Referenced similar PR fix styles? | | |
| **Field names exactly match SDK struct?** | | Exact to `_name`/`_id` suffix |
| **New fields have acceptance tests?** | | "Too simple" is not an acceptable reason |

## 10. Issue Reply

> Start with "Thank you for raising the issue.", write in English, briefly describe root cause and solution.

```
[Fill in here]
```
```

---

## Reference: Implementation Checklist

### 1. Git Operations

> ⚠️ **Cross-platform**: Use double quotes `"` for commit message, single-line only, use `/` for paths

```bash
git checkout main
git pull origin main
git checkout -b issue-[number]
# Modify code...
git add .
git commit -m "Fix #[number]: [short description]"
git log -1 --format="%H"  # Get commit hash
```

### 2. Code Modifications

- ✅ Use `replace_string_in_file` / `create_file` tools
- ✅ **Only modify locations explicitly required by Issue**
- ⚠️ Multiple modifications must have explicit basis in Issue

### 3. Test Updates (Follow Project Conventions)

- Simple error handling/documentation fix → Usually no new tests needed
- New features/complex logic changes → Tests needed

### 4. Documentation Updates

- Modifying public API/Schema → Must update `.html.markdown`
- Internal implementation → Not needed

---

## Reference: Quality Standards

### ✅ Excellent Solutions
- Solve root cause, don't work around
- Reference similar implementations
- Use existing SDK functionality
- Simpler code
- **Modification scope matches Issue**

### ❌ Common Mistakes
- Only adding polling/delays (treating symptoms)
- Writing own regex/validation (reinventing the wheel)
- More complex code (adding branches, new functions)
- **Over-engineering**: Fixing issues not requested by Issue
- **Scope creep**: Issue points to file A, but modifying file B
- **Wrong assumptions**: Assuming issue has been fixed by another PR
- Using Computed instead of Default in Schema
- Not adding ValidateFunc when format requirements exist
- Using hardcoding instead of API calls in CustomizeDiff
- Changed Schema but didn't update documentation
