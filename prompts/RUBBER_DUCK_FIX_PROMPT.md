# Apply Rubber-Duck Critique Fixes (Post-Phase 2)

A rubber-duck critique pass produced findings. Apply fixes for **high** and
**medium** severity findings only. Skip **low** findings.

---

## Constraints

- Each fix must follow the **Suggested fix** in the critique exactly
- For "reuse" findings, you MUST call the cited existing helper, NOT
  re-implement it
- For "naming" findings, rename to match the cited existing convention
- For "pattern" findings, refactor to follow the cited existing pattern
- **Do NOT introduce changes outside the scope of the critique**
- **Do NOT add new files** unless a finding explicitly requires extracting
  a helper to an existing file

---

## Git Constraint (HARD)

You MUST NOT run any git command that changes repo state:

- ❌ `git commit` (the CLI owns commit creation; it will use a mandated message
  and trailer; if you commit, the CLI will detect it and `git reset --mixed`
  to undo your commit and put your edits back in the working tree, then
  commit again with the correct message)
- ❌ `git add`, `git stage`, or any indexing command (the CLI will stage
  selectively, excluding the critique report from the commit)
- ❌ `git stash`, `git checkout`, `git reset`, `git rebase`, `git merge`,
  `git push`, `git branch`
- ❌ `git restore`, `git revert`

You MAY:

- Read files (including the critique report and Phase 2 diff)
- Run read-only git commands (`git log`, `git diff`, `git show`, `git blame`)
- Modify source files in the working tree (this is the only mutation allowed)

If you ignore this constraint and `git commit` anyway, the CLI will:

1. Detect that `HEAD` moved
2. `git reset --mixed <pre-fix HEAD>` to put your changes back in the working
   tree (unstaged) and discard your commit
3. Re-commit with the mandated title `Apply rubber-duck critique fixes for
   #<N>` and trailer

So your commit message will be discarded. Save effort and don't commit.

---

## Workflow

1. Read the inlined critique report (provided in this prompt; the on-disk file
   may be temporarily stashed during this call)
2. For each high / medium finding (use the JSON block; ignore low findings):
   - Open the cited existing example to confirm the pattern
   - Apply the suggested fix
3. Run any project-specific build / lint check that already exists
4. **Do NOT commit** — leave changes in the working tree; the CLI will create
   an independent commit titled `Apply rubber-duck critique fixes for #<N>`
   that sits on top of the Phase 2 commit
