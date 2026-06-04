# Handoff Notes

> ⚠️ **The original maintainer (`jiaweitao`) is no longer with the company as of 2026-06-04.**
> This document is the first thing the inheritor should read. It points to the right docs and flags what was left unfinished.

---

## What this project is

`ai-issue-cli` is a Node.js command-line tool that automates GitHub Issue resolution using a pluggable **agent backend** — currently GitHub Copilot CLI (default) and Anthropic's Claude Code CLI. It uses a two-phase approach: Phase 1 conducts deep research on an issue, Phase 2 implements the solution (or provides guidance). An optional Phase 3 evaluates the solution against reference PRs.

The CLI optionally integrates with `ai-issue-service` (a separate FastAPI backend) for pipeline management, triage, and team knowledge sharing via Trello dashboards. It also ships an offline **local knowledge base** module (`lib/local-knowledge-base.js` + `ai-issue kb` command) so community contributors / disconnected runs still get similar-issue retrieval.

---

## Where to start (in order)

1. **`README.md`** — installation, basic usage, configuration
2. **`QUICKSTART.md`** — 5-minute walkthrough for your first issue
3. **`CLAUDE.md`** — written for AI agents but it's also the fastest way for a human to understand the architecture (command flow, module responsibilities, conventions). **Strongly recommend reading this before diving into code.**
4. **`docs/TASK_TRACKING.md`** — current kanban board with all in-flight / pending tasks ordered by priority
5. **`docs/` directory** — 25+ Phase design docs (in Chinese), recording each major evolution in time order. Highlights:
   - `docs/PHASE5_SPEC.md` / `docs/PHASE5B_SPEC.md` — multi-agent support (Copilot → Claude Code → future Gemini/Codex)
   - `docs/PHASE5C_SPEC.md` — design + rollout flow for the local knowledge base (KB)
   - `docs/RUBBER_DUCK_CRITIQUE_PROPOSAL.md` — the mandatory rubber-duck quality gate that runs after Phase 2

---

## Unfinished work

Use `docs/TASK_TRACKING.md` as the source of truth; below are the highest-priority items still open at departure:

| # | Item | Status | Where to pick up |
|---|------|--------|------------------|
| 1 | **Local KB quality gate** | First KB tarball is published but `manifest.qualityGate === 'pending'`; needs `scripts/eval/kb-quality-eval.js` to hit Recall@3 ≥ 0.6 and MRR@5 ≥ 0.4 before the gate can be stamped `'passed'`, at which point the CLI will actually start using the community KB | Gate function is `shouldPreferLocal()` in `lib/local-knowledge-base.js`; eval script is `scripts/eval/kb-quality-eval.js`; ground-truth fixtures in `scripts/eval/fixtures/`; design + acceptance checklist in `docs/PHASE5C_SPEC.md` and `docs/TASK_TRACKING.md` |
| 2 | **`manager_api_key` rotation** | Open since 2026-05-09 (the value appeared in plaintext in a deployment log) | Procedure in `docs/SUB_ROTATION.md` §7. P1 priority, requires no external approvals, recommend completing in your first week. |
| 3 | **TUI UX manual acceptance** | v0.10.0 tagged, PRs #56–#67 all merged, waiting for someone to walk through the 10-section checklist by hand | `docs/TUI_MANUAL_ACCEPTANCE.md` |
| 4 | **New agent onboarding roadmap** | Copilot + Claude Code are in production today; next is **Gemini CLI**, then **Codex CLI** | `REGISTRY` in `lib/agents/index.js`; onboarding steps in `docs/PHASE5_SPEC.md` §3.1; fake-binary integration test template at `tests/integration/claude-fake-binary.test.js` |
| 5 | **Service-side dependency** | The CLI works offline by default; if the service is enabled (`AI_ISSUE_SERVICE_URL` set), read the `ai-issue-service` `HANDOFF.md` and especially `docs/CORP_TENANT_MIGRATION_RUNBOOK.md` because the backend is preparing to migrate from sub-B to a Corp tenant | `lib/service-client.js` is the only HTTP entry point |

There are **no open PRs** at the time of writing. ~24 stale local branches (`feature/bs-01-verify-loop` etc.) can be deleted — they're all either merged or deprecated.

---

## Key conventions (easy to miss without reading the docs)

These also appear in `CLAUDE.md`, but they're the ones that trip people up most often:

| Category | Rule |
|----------|------|
| **Documentation language** | All files under `docs/` **must be written in Simplified Chinese** (new docs and major rewrites alike). Top-level `README.md` / `CLAUDE.md` / `QUICKSTART.md` / `HANDOFF.md` are English — keep them that way. |
| **Never `git add docs/`** | The `docs/` directory is internal task tracking + design history and **must not be pushed**. The original maintainer was firm about this. If you want to share a particular doc, discuss whether it should be promoted to a `README.md` link first. |
| **PR-only flow** | **Always open a PR, never push directly to `main`, always wait for review before merging.** The original maintainer's personal review requirement transfers to the inheritor / team-owned review process. |
| **Commit trailer** | Append `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>` to every commit unless the user explicitly says otherwise. |
| **CommonJS only** | Use `require` / `module.exports`, no ES modules. Chalk is pinned at v4. |
| **Type checking** | `// @ts-check` + JSDoc. Run with `npm run typecheck` (tsc --noEmit). `tsconfig.json` has `checkJs: false`, so only files that explicitly opt in are checked. |
| **MCP skills install** | After every `npm ci` you must run `npm run skills:install` or tsc / Jest will fail to resolve `@modelcontextprotocol/sdk/...`. CI already does this. |
| **Logger mock** | Every test that imports `lib/logger` must use the `mockCreateLogger` helper (the variable name must start with `mock` or Jest hoisting will reject it). See `tests/helpers/mock-logger.js`. |

---

## Agent / model selection strategy

| Task type | Source of truth | Default |
|-----------|-----------------|---------|
| `research`, `solution`, `verify_fix`, `evaluation`, `kb_*` | `--agent` (CLI flag) → `config.agent` | `copilot` |
| `rubber_duck_critique`, `rubber_duck_fix` | `config.rubberDuckAgent` → `config.agent` | `copilot` |
| `auto_review` | **hard-pinned** in `lib/agents/index.js::selectAgentForTask` | **always `copilot`** (required by the Terraform AI review tool) |

Model resolution order: `--model` (CLI) → `config.agents.<agent>.model` → **only for `copilot`, falls back to `config.model`** → the agent's built-in default (see `DEFAULT_MODELS` in `lib/agents/model-resolver.js`, e.g. `claude-code` defaults to `sonnet`).

To register a new agent you must update three places: `REGISTRY` in `lib/agents/index.js`, `SUPPORTED_AGENTS` in `lib/config.js`, and `SUPPORTED_AGENTS` in `lib/commands/config-cmd.js`.

---

## Command cheat sheet

```bash
npm test                              # Run the full Jest suite
npm run typecheck                     # tsc --noEmit (only files with // @ts-check)
npm run skills:install                # Install all MCP skill sub-packages (mandatory after npm ci)
npm run smoke:claude-mcp              # Optional: real Claude + MCP smoke test (requires AI_ISSUE_REAL_CLAUDE_SMOKE=1)
npx jest tests/copilot.test.js        # Run a single test file
npx jest --testPathPattern=solve      # Run tests matching a pattern
```

There is no build step and no linter.

---

## Related repositories

- **`ai-issue-service`** — the FastAPI backend (`https://github.com/jiaweitao001/ai-issue-service`). Also read its `HANDOFF.md`, especially `docs/CORP_TENANT_MIGRATION_RUNBOOK.md`.
