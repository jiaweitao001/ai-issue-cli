# AI Issue CLI

AI Issue CLI is a Node.js command-line tool that uses GitHub Copilot CLI or Claude Code to research, solve, and evaluate GitHub issues against a local checkout of a target repository.

It can run as a standalone local tool, or connect to `ai-issue-service` for team triage, historical issue search, pipeline management, Trello review boards, imports, metrics, and solution search.

## What it does

- Runs a structured `Research -> Solution/Guidance -> Evaluation` workflow for a GitHub issue.
- Gives the selected agent phase-specific MCP tools for issue context, local code similarity, and optional historical issue search.
- Produces durable analysis and evaluation reports under `~/.ai-issue/reports` by default.
- Can create fix branches and push them to a configured fork remote.
- Supports batch solving with configurable concurrency.
- Optionally reports progress to `ai-issue-service` so issues can move through `triaged`, `queued`, `solving`, `solved`, `failed`, `pr_created`, and `rejected` states.

## Requirements

| Requirement | Needed for | Notes |
|-------------|------------|-------|
| Node.js and npm | All usage | `package.json` declares Node.js `>=14.0.0`. |
| Git | All solving workflows | The target repository must be cloned locally. |
| GitHub Copilot CLI | Default agent and post-Phase 2 auto-review | Install with `npm install -g @github/copilot`, then verify `copilot --version`. Auto-review is a soft dependency when another main agent is selected. |
| Claude Code CLI | Optional `claude-code` agent | Install with `npm install -g @anthropic-ai/claude-code`, then verify `claude --version`. |
| GitHub token | GitHub issue/PR context | Set `GITHUB_TOKEN` to a PAT with `repo` for private repos or `public_repo` for public repos. |
| Azure CLI | Optional service auth | `ai-issue-service` CLI commands use `az account get-access-token` first, then API key fallback. |
| `ai-issue-service` URL | Optional team features | Required for `triage`, `pipeline`, `watch`, `register`, `metrics`, `search`, `import`, and historical issue MCP search. |

## Install

For a local development install:

```bash
git clone https://github.com/jiaweitao001/ai-issue-cli.git
cd ai-issue-cli

npm install
npm link
npm run skills:install

ai-issue --version
```

On Linux/macOS you can also use the interactive installer:

```bash
./scripts/install.sh
```

The skills install step is important. Phase 1 loads three MCP servers from `skills/`: `github-issue-fetcher`, `code-similarity-finder`, and `similar-issue-finder`.

## First run

```bash
export GITHUB_TOKEN="ghp_your_token"

ai-issue init
ai-issue config set repoPath /path/to/target-repo
ai-issue config set issueBaseUrl https://github.com/owner/repo/issues

ai-issue check
ai-issue solve 12345 --branch
```

`solve` runs evaluation by default. For a faster smoke test, add the global flag:

```bash
ai-issue --skip-eval solve 12345 --branch
```

For a step-by-step setup, including Windows commands, service-backed setup, first-run checks, and troubleshooting, see [QUICKSTART.md](QUICKSTART.md).

## Configuration

Configuration is stored in `~/.ai-issue/config.json`. Environment variables are used as defaults when the config module is loaded.

| Key | Env var | Required | Description |
|-----|---------|----------|-------------|
| `repoPath` | `AI_ISSUE_REPO_PATH` | Yes | Absolute path to the local target repository. Must be a Git repository. |
| `issueBaseUrl` | `AI_ISSUE_BASE_URL` | Yes | GitHub issue URL prefix. Must end with `/issues`. |
| `reportPath` | `AI_ISSUE_REPORT_PATH` | No | Directory for generated reports. Default: `~/.ai-issue/reports`. |
| `agent` | `AI_ISSUE_AGENT` | No | Main agent for solve/evaluate/batch/watch. Supported: `copilot`, `claude-code`. Default: `copilot`. |
| `model` | `AI_ISSUE_MODEL` | No | Copilot model fallback passed to `copilot --model`. Default: `claude-sonnet-4.5`. |
| `agents.<agent>.model` | - | No | Per-agent model override, for example `agents.claude-code.model=sonnet`. |
| `rubberDuckAgent` | `AI_ISSUE_RUBBER_DUCK_AGENT` | No | Optional agent override for the post-Phase 2 rubber-duck critique/fix pass. |
| `logLevel` | `AI_ISSUE_LOG_LEVEL` | No | Copilot log level. Default: `info`; `--debug` uses debug logging. |
| `serviceUrl` | `AI_ISSUE_SERVICE_URL` | Service features | Base URL for `ai-issue-service`. |
| `serviceApiKey` | `AI_ISSUE_SERVICE_API_KEY` | Optional | Legacy service auth fallback. Also used by the Phase 1 `similar-issue-finder` MCP skill if your backend expects `X-Api-Key`. |
| `repo` | `AI_ISSUE_REPO` | Service features if not derivable | GitHub repo in `owner/name` form. Usually derived from `issueBaseUrl`. |
| `forkRemote` | - | No | Git remote used by `solve --push-fork`. Default fallback: `origin`. |
| `owner` | `AI_ISSUE_OWNER` | Some service flows | Owner identifier used by `register` if `--owner` is omitted. |
| `updateChannel` | - | No | Self-update channel for `ai-issue update`. One of `auto` (default), `tag`, `branch`. See "Updating the CLI". |

Common config commands:

```bash
ai-issue config show
ai-issue config get repoPath
ai-issue config set agent claude-code
ai-issue config set agents.claude-code.model sonnet
ai-issue config set rubberDuckAgent copilot
ai-issue config set model claude-sonnet-4.5
ai-issue config reset
```

### Switching models

Typing model ids by hand (e.g. `claude-sonnet-4.5`) is error-prone. Use the `model` command group instead:

```bash
ai-issue model            # interactive picker (arrow keys in a TTY, numbered prompt over a pipe)
ai-issue model list       # tabular preset catalog with ★ recommended and ✓ current markers
ai-issue model current    # print just the effective model id (suitable for $(...))
ai-issue model list --agent claude-code
ai-issue model current --agent claude-code
```

The picker pre-selects the current model for the chosen agent, lets you pick a built-in preset, or pick `[Enter custom model ID...]` to type a BYOK / preview id. Interactive selection writes to `agents.<agent>.model`; the legacy top-level `model` remains the Copilot fallback.

Notes:

- The catalog under `data/models.json` is a **curated preset list, not authoritative**. Newly released models that are not yet listed are still accepted — you'll just get a one-time warning per process explaining how to confirm the id.
- You can extend or override the catalog by creating `~/.ai-issue/models.json` with the same schema. Entries are merged by `(agent, id)`; entries without `agent` default to `copilot` for backward compatibility.
- The same warning fires once per process per `(agent, model)` whenever any command uses an unknown model id, whether it was set via `config set ...`, `--model ...`, or environment defaults. Validation is **warning-only** — it never blocks a run.

### Choosing an agent

Copilot remains the default and is the required agent for the post-Phase 2 auto-review tool. Claude Code can be selected as the main solving/evaluation agent:

```bash
# Persistently use Claude Code for solve/evaluate/batch/watch
ai-issue config set agent claude-code
ai-issue config set agents.claude-code.model sonnet

# Override for one run only
ai-issue solve 30340 --agent claude-code --branch
ai-issue evaluate 30340 --agent claude-code
ai-issue batch 30340 31316 --agent claude-code
ai-issue watch --owner alice --agent claude-code

# Heterogeneous review: main agent writes, another agent rubber-duck reviews
ai-issue config set rubberDuckAgent copilot
```

`--model` is also run-scoped: it applies to the agent selected for that command and does not rewrite `~/.ai-issue/config.json`.

### Agent acceptance harness

Use the acceptance harness to generate a manual comparison template for a five-issue agent smoke run:

```bash
npm run acceptance:agents -- --issues 30340,31316,31500,31501,31502 --output /tmp/phase5b-acceptance.md
```

By default it generates Copilot and Claude Code commands for each issue. Add `--branch` or `--skip-eval` to mirror the run mode you want to test. The output is a local template for recording Phase 1 classification, Phase 2 outcome, artifact validation, rubber-duck behavior, duration, and estimated cost.

## Main workflow

`ai-issue solve <issue>` is the primary command.

1. If `serviceUrl` is configured, the CLI checks pipeline triage first. Issues triaged as `SKIP` or `NEEDS_HUMAN` are skipped unless `--force` is used.
2. If `--branch` is used, the CLI creates or switches to `fix/issue-<N>` in the target repository.
3. Phase 1 runs deep research with MCP tools and writes `issue-<N>-research.md`.
4. The research report classifies the issue as `CODE_CHANGE` or `GUIDANCE`.
5. Phase 2 either implements a solution or writes user guidance, then saves `issue-<N>-analysis-and-solution.md`.
6. For `CODE_CHANGE`, the always-on rubber-duck critique/fix pass reviews the Phase 2 changes.
7. For `CODE_CHANGE`, the Copilot-backed post-Phase 2 auto-review tool runs when available. If Copilot is not installed and another main agent is selected, auto-review is skipped without failing the solve.
8. If `--push-fork` and `--branch` are both used, the branch is pushed to `forkRemote`.
9. If service integration is enabled, the CLI reports `solved` or `failed` and uploads the solution summary when available.
10. The temporary research report is deleted after Phase 2 succeeds.
11. Phase 3 evaluation runs unless `--skip-eval` is set, writing `issue-<N>-evaluation.md`.

## Command reference

Global options:

| Option | Description |
|--------|-------------|
| `--model <model>` | Override the selected agent model for the current run. |
| `--agent <agent>` | Override the configured main agent for the current run (`copilot` or `claude-code`). |
| `--skip-eval` | Skip Phase 3 evaluation after solving. |
| `--concurrency <number>` | Batch concurrency. Default: `3`. |
| `--debug` | Enable debug logging. |

Commands:

| Command | Service required | Description |
|---------|------------------|-------------|
| `ai-issue init` | No | Create `~/.ai-issue/config.json` and the report directory. |
| `ai-issue config [show|get|set|reset]` | No | Manage configuration. |
| `ai-issue model [list|current]` | No | List the preset model catalog, print the current model id, or run an interactive picker (no subcommand). Supports `--agent`. See "Switching models" above. |
| `ai-issue check` | No | Validate config, `GITHUB_TOKEN`, selected agent CLI, repo path, report path, prompt files, and (when `serviceUrl` is set) `ai-issue-service` reachability + authentication. Supports `--agent`. |
| `ai-issue solve <issue>` | No | Run research, solution/guidance, auto-review for code changes, and optional evaluation. |
| `ai-issue evaluate <issue>` | No | Run evaluation against an existing analysis report. Alias: `eval`. |
| `ai-issue batch <issues...>` | No | Solve multiple issues concurrently. |
| `ai-issue validate [target]` | No | Validate generated report format. A direct file path is the most reliable target. |
| `ai-issue triage <issue>` | Yes | Trigger service triage and display recommendation, type, complexity, solvability, owner, duplicate, and reasoning. |
| `ai-issue pipeline` | Yes | List pipeline entries with optional owner/status filters. Entries are sorted by issue number ascending, so the newest issues appear at the bottom. |
| `ai-issue pipeline mark-pr-created <issue> --pr-url <url>` | Yes | Manually mark a pipeline issue as PR-created after a PR exists. |
| `ai-issue watch --owner <owner>` | Yes | Poll queued issues assigned to an owner and solve them locally. |
| `ai-issue register --pat <token>` | Yes | Register an engineer GitHub PAT for PR creation after Trello approval. |
| `ai-issue metrics` | Yes | Show team metrics such as solve rate, response time, and per-engineer breakdown. |
| `ai-issue search <query>` | Yes | Search pipeline issues and solution summaries. |
| `ai-issue import` | Yes | Import historical GitHub issues into the pipeline. Import triage always runs; there is no `--skip-triage` option. |
| `ai-issue update` | No | Update the CLI itself. By default upgrades to the latest GitHub release. See "Updating the CLI" below. |

Frequently used command examples:

```bash
# Solve one issue on a dedicated branch
ai-issue solve 30340 --branch

# Faster run without evaluation
ai-issue --skip-eval solve 30340 --branch

# Solve and push the generated branch
ai-issue solve 30340 --branch --push-fork

# Override a service triage recommendation
ai-issue solve 30340 --force

# Use Claude Code for a single run
ai-issue solve 30340 --agent claude-code --branch

# Batch solve with lower concurrency
ai-issue --concurrency 2 batch 30340 31316 31500

# Evaluate later
ai-issue evaluate 30340

# Validate a generated report
ai-issue validate ~/.ai-issue/reports/issue-30340-analysis-and-solution.md
```

Service-backed examples:

```bash
ai-issue triage 30340
ai-issue pipeline --owner alice --status queued
ai-issue pipeline mark-pr-created 30340 --pr-url https://github.com/hashicorp/terraform-provider-azurerm/pull/30345
ai-issue watch --owner alice --interval 300 --push-fork

ai-issue import --dry-run --since 30d --limit 100
ai-issue import --mode incremental --state all
ai-issue import --status

ai-issue register --pat ghp_xxx --owner alice --trello-member-id 5f8a...
ai-issue metrics --since 7d
ai-issue search "polling timeout" --status solved --limit 5
```

## Optional service and team workflow

Without `serviceUrl`, the CLI still solves issues using GitHub API context and local code analysis.

With `ai-issue-service`, the CLI participates in a team pipeline:

1. New or imported issues are triaged by the service.
2. Managers or external assignment sync move selected issues to `queued` with an `assigned_to` owner.
3. Engineers run `ai-issue watch --owner <owner>` locally.
4. The watch daemon marks issues as `solving`, runs `solve --branch --force`, and reports `solved` or `failed`.
5. Trello boards can show manager-wide and engineer-specific views.
6. Engineers approve solved cards to create PRs using the PAT registered by `ai-issue register`, or manually record an existing PR with `ai-issue pipeline mark-pr-created`.
7. Managers use `metrics` and `search` to inspect throughput and prior solutions.

Service authentication behavior:

- CLI service commands use Azure CLI Bearer token first. Run `az login` before using them.
- If Azure CLI auth is unavailable, `serviceApiKey` / `AI_ISSUE_SERVICE_API_KEY` is used as an `X-Api-Key` fallback.
- The Phase 1 `similar-issue-finder` MCP skill forwards `AI_ISSUE_SERVICE_URL` and `AI_ISSUE_SERVICE_API_KEY` to the skill process. Configure `serviceApiKey` if your backend requires API-key auth for those MCP endpoints.

## Updating the CLI

`ai-issue update` upgrades this CLI in place. By default it upgrades to the latest GitHub **release tag**. There are two install modes:

- **link mode** — you ran `npm link` or `./scripts/install.sh` from a clone. The clone IS your install. `update` runs a fast-forward `git pull` + `npm install` against your current branch.
- **copy mode** — the package was installed globally (e.g. `npm install -g .`). The CLI maintains its own clone at `~/.ai-issue/source/ai-issue-cli` and reinstalls globally from there.

Mode is auto-detected. Run `ai-issue update --check` to see what mode you're in, what version you'd move to, and from where, **without** making changes.

```bash
# See what an update would do (no side effects)
ai-issue update --check

# Apply the update (defaults to the latest release tag)
ai-issue update

# Pin to a specific tag, branch, or commit SHA
ai-issue update --ref v0.10.0
ai-issue update --ref main

# Allow a downgrade (refused by default)
ai-issue update --ref v0.9.1 --confirm-downgrade

# Force a reinstall even when already up to date
ai-issue update --force
```

### Channels

The `updateChannel` config controls what "latest" means when no `--ref` is passed:

| Channel | Meaning |
|---------|---------|
| `auto` (default) | link mode → tracks your current branch HEAD; copy mode → tracks the latest release tag. |
| `tag` | Always upgrades to the latest stable release tag. |
| `branch` | Always tracks the current branch's upstream HEAD (link mode); not meaningful in copy mode. |

```bash
ai-issue config set updateChannel tag       # always pull releases
ai-issue config set updateChannel branch    # always track branch HEAD
```

`--ref` always overrides the channel for a single run.

### Safety

- **Concurrent runs are blocked.** `update` acquires `~/.ai-issue/update.lock`. A running `ai-issue watch` writes `~/.ai-issue/watch-active.lock`; `update` refuses to run while watch is active, and watch refuses to start a new cycle while update is running.
- **Dirty link clones are refused.** If your clone has uncommitted changes (tracked files), `update` exits with code `12` and asks you to commit or stash first.
- **Detached HEAD is refused in link mode.** Check out a branch first.
- **Refs that would change HEAD are refused in link mode.** If you ask for a tag that doesn't match your current branch's HEAD, `update` exits `12` and prints both alternatives (checkout the tag in your clone, or switch to `branch` channel).
- **Downgrades are refused** unless you pass `--confirm-downgrade`.
- **Global install permission errors map to exit `21`** with explicit guidance to fix your npm prefix (`npm config set prefix ~/.npm-global`). `ai-issue update` will never recommend `sudo npm install -g`.

### Exit codes

| Code | Meaning |
|------|---------|
| `0` | Success (or already up to date). |
| `2` | Refused: downgrade without `--confirm-downgrade`. |
| `10` | Network / GitHub API failure during version check. |
| `12` | Refused due to environment (dirty clone, detached HEAD, watch lock held, etc.). |
| `20` | Worker failed mid-update (e.g. git fetch / npm install error). |
| `21` | Global install failed with EACCES — fix your npm prefix and retry. |
| `99` | Internal error. |



The CLI passes a phase-specific MCP config to the selected agent. For Claude Code, the CLI normalizes the config to Claude's MCP format, strips Copilot-only fields, runs with `--strict-mcp-config`, and passes the prompt through stdin.

| Phase | Config | Skills |
|-------|--------|--------|
| Phase 1 research | `config/mcp-config-phase1.json` | `github-issue-fetcher`, `code-similarity-finder`, `similar-issue-finder` |
| Phase 2 solution/guidance | `config/mcp-config-phase2.json` | `github-issue-fetcher` |
| Phase 3 evaluation | `config/mcp-config-evaluate.json` | `github-issue-fetcher` |

Skill summary:

| Skill | Tooling | Purpose |
|-------|---------|---------|
| `github-issue-fetcher` | `get_issue_context` | Fetch issue details, comments, timeline, and linked PRs from GitHub. |
| `code-similarity-finder` | `find_similar_implementations` | Analyze local Go files and find structurally similar implementations. |
| `similar-issue-finder` | `find_similar_issues`, `check_existing_research` | Query `ai-issue-service` for historical issues and verified prior research. |

## Output files

Default report directory:

```text
~/.ai-issue/reports/
```

Generated files:

```text
issue-30340-research.md               # Phase 1 research; deleted after successful Phase 2
issue-30340-analysis-and-solution.md  # Phase 2 final analysis, solution, or guidance
issue-30340-evaluation.md             # Phase 3 evaluation, unless --skip-eval is used
logs/batch-<timestamp>.log            # Batch run log
```

If a solve fails before cleanup, the research report may remain in the report directory and can be useful for debugging.

## Project structure

```text
ai-issue-cli/
  ai-issue.js                    # Commander.js entry point
  lib/
    agents/                      # AgentRunner adapters and shared agent helpers
    commands/                    # Command handlers
    config.js                    # ~/.ai-issue/config.json management
    copilot.js                   # Copilot CLI runner and phase MCP config selection
    service-client.js            # ai-issue-service HTTP client
    az-token.js                  # Azure CLI token helper
    review-tool.js               # Post-Phase 2 auto-review integration
    report-validator.js          # Report template validation
    summary-extractor.js         # Service solution summary extraction
  config/                        # Phase-specific MCP configs
  prompts/                       # Prompt templates for each phase
  skills/                        # MCP servers used by Copilot
  scripts/                       # Installer, utility scripts, and agent acceptance harness
  tests/                         # Jest tests
```

## Development

```bash
npm install
npm run skills:install
npm test

# Run one test file
npx jest tests/commands/solve.test.js
```

The project uses CommonJS, JSDoc type annotations, and Jest. There is no build step or configured linter.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Configuration file not found` | Run `ai-issue init`. |
| `repoPath is not set` | Run `ai-issue config set repoPath /path/to/repo`. |
| `issueBaseUrl format invalid` | Set a URL ending in `/issues`, for example `https://github.com/owner/repo/issues`. |
| `GITHUB_TOKEN` check fails | Export `GITHUB_TOKEN` in the same shell that runs `ai-issue`. |
| `Copilot CLI` check fails | Run `npm install -g @github/copilot`, then complete Copilot CLI authentication if prompted. |
| `Claude Code` check fails | Run `npm install -g @anthropic-ai/claude-code`, then complete Claude Code authentication if prompted. |
| `ai-issue check --agent claude-code` mentions `.mcp.json` | This is informational: Claude Code runs with strict phase-specific MCP config, so a repository-level `.mcp.json` is intentionally ignored for ai-issue tasks. |
| Service commands fail auth | Run `az login`; if your deployment uses API keys, set `serviceApiKey` or `AI_ISSUE_SERVICE_API_KEY`. |
| `Service Reachability` shows `INVALID_URL` / `INVALID_SCHEMA` in `ai-issue check` | `serviceUrl` must be the origin only (e.g. `https://svc.example.com`) using `http`/`https`; do not append paths, query strings, or fragments. The CLI builds `/health` and `/pipeline` from this base. |
| `Service Reachability` shows `ENOTFOUND` / `ECONNREFUSED` / `ETIMEDOUT` | Verify VPN, corporate DNS, the backend process is up, and that the port/host in `serviceUrl` is correct. |
| `Service Authentication` shows 401 with `credentialSent=Bearer` | Azure CLI access token was rejected. Run `az login` (the CLI caches `az account get-access-token` for 60s; wait or open a new shell to force refresh). |
| `Service Authentication` shows 401 with `credentialSent=X-Api-Key` | The configured `serviceApiKey` is invalid or revoked. Update via `ai-issue config set serviceApiKey <new-key>`. |
| `Service Authentication` shows ⚠️ "anonymous access" | The backend accepted the request without validating any credential. Verify the backend has `aad_tenant_id` and/or `api_key` configured for production. |
| Historical issue MCP search fails | Confirm `serviceUrl` is set and, if required, configure `serviceApiKey` because the MCP skill sends `X-Api-Key`. |
| `--no-eval` does not work | Use the current flag: `--skip-eval`. |
| `import --skip-triage` is rejected | The option was removed; import always runs triage. |

## Uninstall

```bash
npm unlink -g ai-issue-cli
rm -rf ~/.ai-issue
```
