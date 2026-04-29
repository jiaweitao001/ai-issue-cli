# AI Issue CLI

AI Issue CLI is a Node.js command-line tool that uses GitHub Copilot CLI to research, solve, and evaluate GitHub issues against a local checkout of a target repository.

It can run as a standalone local tool, or connect to `ai-issue-service` for team triage, historical issue search, pipeline management, Trello review boards, imports, metrics, and solution search.

## What it does

- Runs a structured `Research -> Solution/Guidance -> Evaluation` workflow for a GitHub issue.
- Gives Copilot phase-specific MCP tools for issue context, local code similarity, and optional historical issue search.
- Produces durable analysis and evaluation reports under `~/.ai-issue/reports` by default.
- Can create fix branches and push them to a configured fork remote.
- Supports batch solving with configurable concurrency.
- Optionally reports progress to `ai-issue-service` so issues can move through `triaged`, `queued`, `solving`, `solved`, `failed`, `pr_created`, and `rejected` states.

## Requirements

| Requirement | Needed for | Notes |
|-------------|------------|-------|
| Node.js and npm | All usage | `package.json` declares Node.js `>=14.0.0`. |
| Git | All solving workflows | The target repository must be cloned locally. |
| GitHub Copilot CLI | All solving workflows | Install with `npm install -g @github/copilot`, then verify `copilot --version`. |
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
| `model` | `AI_ISSUE_MODEL` | No | Copilot model passed to `copilot --model`. Default: `claude-sonnet-4.5`. |
| `logLevel` | `AI_ISSUE_LOG_LEVEL` | No | Copilot log level. Default: `info`; `--debug` uses debug logging. |
| `serviceUrl` | `AI_ISSUE_SERVICE_URL` | Service features | Base URL for `ai-issue-service`. |
| `serviceApiKey` | `AI_ISSUE_SERVICE_API_KEY` | Optional | Legacy service auth fallback. Also used by the Phase 1 `similar-issue-finder` MCP skill if your backend expects `X-Api-Key`. |
| `repo` | `AI_ISSUE_REPO` | Service features if not derivable | GitHub repo in `owner/name` form. Usually derived from `issueBaseUrl`. |
| `forkRemote` | - | No | Git remote used by `solve --push-fork`. Default fallback: `origin`. |
| `owner` | `AI_ISSUE_OWNER` | Some service flows | Owner identifier used by `register` if `--owner` is omitted. |

Common config commands:

```bash
ai-issue config show
ai-issue config get repoPath
ai-issue config set model claude-sonnet-4.5
ai-issue config reset
```

### Switching models

Typing model ids by hand (e.g. `claude-sonnet-4.5`) is error-prone. Use the `model` command group instead:

```bash
ai-issue model            # interactive picker (arrow keys in a TTY, numbered prompt over a pipe)
ai-issue model list       # tabular preset catalog with ★ recommended and ✓ current markers
ai-issue model current    # print just the effective model id (suitable for $(...))
```

The picker pre-selects your current model, lets you pick a built-in preset, or pick `[Enter custom model ID...]` to type a BYOK / preview id.

Notes:

- The catalog under `data/models.json` is a **curated preset list, not authoritative**. Newly released models that are not yet listed are still accepted — you'll just get a one-time warning per process explaining how to confirm the id.
- You can extend or override the catalog by creating `~/.ai-issue/models.json` with the same schema. Entries with the same `id` replace the built-in metadata in place; new ids are appended.
- The same warning fires once per process whenever any command uses an unknown model id, whether it was set via `config set model …`, `--model …`, or `AI_ISSUE_MODEL`. Validation is **warning-only** — it never blocks a run.

## Main workflow

`ai-issue solve <issue>` is the primary command.

1. If `serviceUrl` is configured, the CLI checks pipeline triage first. Issues triaged as `SKIP` or `NEEDS_HUMAN` are skipped unless `--force` is used.
2. If `--branch` is used, the CLI creates or switches to `fix/issue-<N>` in the target repository.
3. Phase 1 runs deep research with MCP tools and writes `issue-<N>-research.md`.
4. The research report classifies the issue as `CODE_CHANGE` or `GUIDANCE`.
5. Phase 2 either implements a solution or writes user guidance, then saves `issue-<N>-analysis-and-solution.md`.
6. For `CODE_CHANGE`, the post-Phase 2 auto-review tool runs against the new changes.
7. If `--push-fork` and `--branch` are both used, the branch is pushed to `forkRemote`.
8. If service integration is enabled, the CLI reports `solved` or `failed` and uploads the solution summary when available.
9. The temporary research report is deleted after Phase 2 succeeds.
10. Phase 3 evaluation runs unless `--skip-eval` is set, writing `issue-<N>-evaluation.md`.

## Command reference

Global options:

| Option | Description |
|--------|-------------|
| `--model <model>` | Override the configured Copilot model for the current run. |
| `--skip-eval` | Skip Phase 3 evaluation after solving. |
| `--concurrency <number>` | Batch concurrency. Default: `3`. |
| `--debug` | Enable debug logging. |

Commands:

| Command | Service required | Description |
|---------|------------------|-------------|
| `ai-issue init` | No | Create `~/.ai-issue/config.json` and the report directory. |
| `ai-issue config [show|get|set|reset]` | No | Manage configuration. |
| `ai-issue model [list|current]` | No | List the preset model catalog, print the current model id, or run an interactive picker (no subcommand). See "Switching models" above. |
| `ai-issue check` | No | Validate config, `GITHUB_TOKEN`, Copilot CLI, repo path, report path, and prompt files. |
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

## MCP skills

The CLI passes a phase-specific MCP config to Copilot:

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
  scripts/                       # Installer and utility scripts
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
| Service commands fail auth | Run `az login`; if your deployment uses API keys, set `serviceApiKey` or `AI_ISSUE_SERVICE_API_KEY`. |
| Historical issue MCP search fails | Confirm `serviceUrl` is set and, if required, configure `serviceApiKey` because the MCP skill sends `X-Api-Key`. |
| `--no-eval` does not work | Use the current flag: `--skip-eval`. |
| `import --skip-triage` is rejected | The option was removed; import always runs triage. |

## Uninstall

```bash
npm unlink -g ai-issue-cli
rm -rf ~/.ai-issue
```
