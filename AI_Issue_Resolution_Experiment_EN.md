# AI Issue Resolution Guide

## Core Rules

### 1. Code Understanding Requirements
- Must proactively read and understand relevant code context
- Cannot provide solutions based solely on issue descriptions
- Need to thoroughly analyze relevant files and logic in the codebase

### 2. Independent Thinking Requirements
- For issues with existing solutions, must not view existing answers (including PRs and comments under the issue), must think independently
- For unresolved issues, can use any tools

### 3. Git Branch Management (Important) ⭐
**For issues involving code modifications:**
- Must create a new Git branch (branch name: issue-number)
- All code modifications must be committed to that branch
- Direct modification of the main branch is prohibited
- One issue uses one independent branch

**Workflow:**
```bash
# 1. Create and switch to new branch
git checkout -b issue-XXX

# 2. Make code modifications
# ... modify relevant files ...

# 3. Commit changes
git add .
git commit -m "Fix: issue-XXX brief description

Detailed explanation of the problem fixed and the solution"
```

### 4. Testing and Documentation Modification Requirements (Important) ⭐
**Test Files:**
- Must check and update relevant test files
- Locate corresponding test files (usually in the same directory or tests directory)
- Update or add test cases based on code modifications
- Ensure tests cover the fixed scenarios
- Run tests to verify the correctness of modifications

**Documentation Updates:**
- Check if related documentation needs updating (README, API docs, etc.)
- If public APIs or behaviors are modified, documentation must be updated
- If new features are added, documentation must be added

**Commit Requirements:**
- Test and documentation modifications should be included in the same commit

### 5. Analysis Report Output Requirements
- Analysis report must be saved as an independent Markdown file
- File naming format: `issue-[issue-number]-analysis.md` (e.g., `issue-31316-analysis.md`)
- Use the `create_file` tool to create report files

### 6. Tool Usage Best Practices (Important) ⭐
**File Operation Standards:**
- ✅ Use `create_file` tool to create new files (especially large files)
- ✅ Use `replace_string_in_file` or `multi_replace_string_in_file` to edit existing files
- ❌ Avoid using heredoc (`<< 'EOF'`) to create large files (>100 lines)
- ❌ Avoid transferring large amounts of text data in single shell commands

**Rationale:**
- Creating large files with heredoc may cause terminal buffer overflow or connection timeout
- VS Code terminal has limits on data volume per command
- Using dedicated file operation tools is more reliable and efficient

## Analysis Report Format Requirements

Your analysis report for each issue must include the following structured content:

### Issue #[Number] Solution

#### 1. Problem Analysis
- Problem symptoms
- Possible root causes
- Impact scope

#### 2. Code Investigation
- List key file paths
- Related functions/classes/modules
- Identified problem points

#### 3. Solution
- Fix approach
- Specific implementation method

#### 4. Code Modifications (if applicable)
**Git Operation Record:**
- Branch name: issue-XXX
- Commit Hash: [hash value after commit]

**Modified Files:**
- `path/to/file.py` - modification description
- `path/to/another_file.py` - modification description

**Commit Message:**
```
Fix: issue-XXX [brief description]

[Detailed explanation of fix content and reason]
```

#### 5. Test Modifications (if applicable)
**Test File Modifications:**
- Modified test file paths
- Added or modified test cases
- Test execution results

#### 6. Documentation Updates (if applicable)
**Modified Documentation:**
- Updated documentation file paths
- Modification content description

#### 7. Verification Method
- Test steps
- Expected results

#### 8. Potential Impact
- Whether it affects other features
- Whether additional modifications are needed
