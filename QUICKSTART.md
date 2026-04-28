# Quick Start

This guide walks from a fresh checkout to a completed `ai-issue solve` run. It also covers the optional `ai-issue-service` workflow for teams using triage, pipeline, watch, Trello approval, imports, metrics, and search.

## 1. Choose your mode

AI Issue CLI has two useful modes.

| Mode | What you need | What works |
|------|---------------|------------|
| Standalone local mode | GitHub token, Copilot CLI, local target repo | `solve`, `evaluate`, `batch`, `validate`, local code similarity, GitHub issue context |
| Service-backed team mode | Everything in standalone mode plus `ai-issue-service` | Triage, pipeline, watch daemon, historical issue search, import, metrics, search, Trello PR approval |

If you only want to solve one issue locally, start with standalone mode. You can add service configuration later without reinstalling.

## 2. Install prerequisites

### Node.js, npm, and Git

```bash
node --version
npm --version
git --version
```

Install Node.js from <https://nodejs.org/> if `node` or `npm` is missing. The package declares Node.js `>=14.0.0`.

### GitHub Copilot CLI

```bash
npm install -g @github/copilot
copilot --version
```

If the Copilot CLI asks you to authenticate on first use, complete that flow before running `ai-issue`.

### GitHub token

Create a GitHub Personal Access Token:

1. Open <https://github.com/settings/tokens>.
2. Generate a classic token.
3. Use `repo` scope for private repositories, or `public_repo` for public repositories.
4. Export it as `GITHUB_TOKEN`.

Linux/macOS:

```bash
export GITHUB_TOKEN="ghp_your_token_here"
```

Windows PowerShell:

```powershell
$env:GITHUB_TOKEN = "ghp_your_token_here"
```

`ai-issue check` verifies `GITHUB_TOKEN`, so set it in the same shell that will run the CLI.

### Target repository

Clone the repository whose issues you want to solve. The CLI edits this local checkout.

```bash
git clone https://github.com/owner/repo.git /path/to/target-repo
cd /path/to/target-repo
git status --short
```

Start from a clean working tree when possible. `ai-issue solve --branch` will create or switch to `fix/issue-<N>`, but it will not clean up unrelated local changes for you.

### Optional: Azure CLI for service-backed mode

Service-backed commands are designed to authenticate through Azure CLI. Log in once before using `triage`, `pipeline`, `watch`, `import`, `metrics`, or `search`.

```bash
az login
az account show
```

Install Azure CLI from <https://aka.ms/install-az-cli> if `az` is missing. API-key authentication still exists as a fallback for older deployments, but most users should use `az login`.

## 3. Install AI Issue CLI

From this repository:

```bash
git clone https://github.com/jiaweitao001/ai-issue-cli.git
cd ai-issue-cli

npm install
npm link
npm run skills:install

ai-issue --version
```

`npm link` exposes the local checkout as the global `ai-issue` command. Code changes in this repository take effect immediately.

On Linux/macOS, you can use the interactive installer instead:

```bash
./scripts/install.sh
```

On Windows, the same manual commands work in PowerShell. If `npm run skills:install` has shell compatibility issues in your environment, install the three skill packages directly:

```powershell
npm --prefix skills/github-issue-fetcher install
npm --prefix skills/code-similarity-finder install
npm --prefix skills/similar-issue-finder install
```

## 4. Initialize configuration

Create the config file and report directory:

```bash
ai-issue init
```

Set the target repo path:

```bash
ai-issue config set repoPath /path/to/target-repo
```

Only set `issueBaseUrl` if you are not using the default repository (`https://github.com/hashicorp/terraform-provider-azurerm/issues`):

```bash
ai-issue config set issueBaseUrl https://github.com/owner/repo/issues
```

The `issueBaseUrl` value must end with `/issues`. The CLI derives `owner/repo` from this URL for most service calls.

The remaining defaults are ready to use:

| Config | Default | When to change it |
|--------|---------|-------------------|
| `reportPath` | `~/.ai-issue/reports` | Use a different report output directory. |
| `model` | `claude-sonnet-4.5` | Prefer another Copilot model. You can also use `--model` per run. |
| `logLevel` | `info` | Usually leave this alone; use `--debug` for troubleshooting. |
| `forkRemote` | `origin` fallback | Set this only if `--push-fork` should push to another remote. |

For example, only configure `forkRemote` when needed:

```bash
ai-issue config set forkRemote my-fork
```

View the final config:

```bash
ai-issue config show
```

## 5. Configure service-backed features, if needed

Skip this section for standalone local mode.

Set the service URL:

```bash
ai-issue config set serviceUrl https://your-ai-issue-service.example.com
```

If your `issueBaseUrl` is not enough to derive the GitHub repo, set it explicitly:

```bash
ai-issue config set repo owner/repo
```

Authenticate with Azure CLI:

```bash
az login
```

API-key auth is only a legacy fallback. If your service admin tells you the deployment still requires an API key, set `serviceApiKey`; otherwise skip it.

## 6. Run environment checks

```bash
ai-issue check
```

This checks:

- Config validation.
- `GITHUB_TOKEN`.
- Copilot CLI availability.
- Target repository path.
- Report directory.
- Required prompt files.

Fix any failed check before running `solve`.

## 7. Run your first issue

Use an issue number from the repository configured in `issueBaseUrl`.

For a full run:

```bash
ai-issue solve 30340 --branch
```

For a faster first smoke test without Phase 3 evaluation:

```bash
ai-issue --skip-eval solve 30340 --branch
```

What happens during `solve`:

1. If service integration is configured, the CLI checks pipeline triage. `SKIP` and `NEEDS_HUMAN` are skipped unless you pass `--force`.
2. `--branch` creates or switches to `fix/issue-30340`.
3. Phase 1 asks Copilot to research the issue using GitHub issue context, local code similarity, and optional historical issue search.
4. Phase 1 writes a temporary research report and classifies the issue as `CODE_CHANGE` or `GUIDANCE`.
5. Phase 2 either implements a code fix or writes a guidance answer.
6. For `CODE_CHANGE`, the post-Phase 2 review tool runs and Copilot is expected to address review feedback.
7. The final Phase 2 report is saved.
8. If evaluation is not skipped, Phase 3 evaluates the result and saves an evaluation report.

Useful variants:

```bash
# Use a different model for this run
ai-issue --model gpt-5 solve 30340 --branch

# Print debug logs
ai-issue --debug solve 30340 --branch

# Override a service triage SKIP/NEEDS_HUMAN recommendation
ai-issue solve 30340 --branch --force

# Create a branch and push it after solving
ai-issue solve 30340 --branch --push-fork
```

Only use `--push-fork` after `forkRemote` points at the remote you want to push to, or when pushing to `origin` is correct.

## 8. Review the result

Generated reports are written to `reportPath`, which defaults to `~/.ai-issue/reports`.

```text
~/.ai-issue/reports/
  issue-30340-analysis-and-solution.md
  issue-30340-evaluation.md
  logs/batch-<timestamp>.log
```

The Phase 1 research report is temporary and is deleted after Phase 2 succeeds. If the run fails, it may remain and can help with debugging.

Review code changes in the target repository:

```bash
cd /path/to/target-repo
git status --short
git log -1 --oneline
git show --stat
```

Run the target repository's normal tests manually. `ai-issue` cannot know every downstream project's preferred test command.

If you skipped evaluation and want to run it later:

```bash
ai-issue evaluate 30340
```

Validate a generated report:

```bash
ai-issue validate ~/.ai-issue/reports/issue-30340-analysis-and-solution.md
```

When validating by issue number instead of file path, run the command from the directory containing the report files, or configure `workDir` manually.

## 9. Push or open a PR

If you did not use `--push-fork`, push manually after reviewing the branch:

```bash
cd /path/to/target-repo
git push origin fix/issue-30340
```

Then open a PR using your normal workflow.

If your team uses the service-backed Trello approval workflow, do not manually open the PR unless your process says to. In that workflow:

1. `solve` pushes the branch.
2. The Trello card moves to Review.
3. The engineer reviews the diff.
4. Dragging the card to Approved creates the PR using the PAT registered with `ai-issue register`.

## 10. Batch process issues

Batch mode runs multiple `solve` calls with a concurrency limit.

```bash
ai-issue --concurrency 2 batch 30340 31316 31500
```

For a faster batch run:

```bash
ai-issue --skip-eval --concurrency 2 batch 30340 31316 31500
```

Batch logs are written under:

```text
~/.ai-issue/reports/logs/
```

Keep concurrency conservative if Copilot or GitHub rate limits become an issue.

## 11. Service-backed daily workflow

This section assumes `serviceUrl` is configured and authentication works.

### Triage one issue

```bash
ai-issue triage 30340
```

The command displays recommendation, issue type, complexity, AI solvability, confidence, resource, assignee, duplicate information, and reasoning when available.

### View the pipeline

```bash
ai-issue pipeline
ai-issue pipeline --owner alice
ai-issue pipeline --status queued --limit 50
```

### Manually record an existing PR

If a PR already exists outside the automated Trello approval flow, mark the issue as PR-created and let the service sync Trello:

```bash
ai-issue pipeline mark-pr-created 30340 --pr-url https://github.com/hashicorp/terraform-provider-azurerm/pull/30345
```

Use `--repo owner/name` when the configured repository is not the issue repository. The CLI parses `--pr-number` from the URL unless you pass it explicitly.

### Import historical issues

Preview first:

```bash
ai-issue import --dry-run --since 30d --limit 100
```

Run an incremental import:

```bash
ai-issue import --mode incremental --state all --since 30d
```

Check import status:

```bash
ai-issue import --status
```

Import options:

| Option | Description |
|--------|-------------|
| `--mode <mode>` | `full`, `incremental`, or `backfill`. Default: `incremental`. |
| `--state <state>` | `all`, `open`, or `closed`. Default: `all`. |
| `--since <period>` | Relative days such as `30d`, or an ISO date such as `2026-01-01`. |
| `--labels <labels>` | Comma-separated GitHub labels. |
| `--limit <n>` | Max issues to import. |
| `--dry-run` | Preview without writing to the database. |
| `--force` | Re-import existing pipeline entries. |
| `--status` | Show import progress. |

Import always runs service triage. The old `--skip-triage` option has been removed.

### Register an engineer for PR creation

```bash
ai-issue register --pat ghp_xxx --owner alice
```

With Trello member mapping:

```bash
ai-issue register --pat ghp_xxx --owner alice --trello-member-id 5f8a...
```

The service stores the PAT encrypted and uses it when the engineer approves a solved card.

### Start the watch daemon

```bash
ai-issue watch --owner alice --interval 300 --push-fork
```

The watch daemon:

1. Polls queued issues assigned to `alice`.
2. Marks each issue as `solving`.
3. Runs `solve` locally with `branch: true` and `force: true`.
4. Pushes to the configured fork remote if `--push-fork` is used.
5. Reports `solved` or `failed`.

To skip evaluation in watch mode:

```bash
ai-issue --skip-eval watch --owner alice --push-fork
```

Stop the daemon with `Ctrl+C`.

### Use metrics and search

```bash
ai-issue metrics
ai-issue metrics --owner alice --since 7d

ai-issue search "polling timeout"
ai-issue search "key vault" --owner alice --status solved --limit 5
```

These commands require service support and may be manager-restricted depending on your deployment.

## 12. Command cheat sheet

```bash
# Config
ai-issue init
ai-issue config show
ai-issue config set repoPath /path/to/repo
ai-issue check

# Standalone solving
ai-issue solve 30340 --branch
ai-issue --skip-eval solve 30340 --branch
ai-issue evaluate 30340
ai-issue validate ~/.ai-issue/reports/issue-30340-analysis-and-solution.md
ai-issue --concurrency 2 batch 30340 31316

# Service-backed workflow
ai-issue triage 30340
ai-issue pipeline --owner alice
ai-issue pipeline mark-pr-created 30340 --pr-url https://github.com/hashicorp/terraform-provider-azurerm/pull/30345
ai-issue import --dry-run --since 30d
ai-issue register --pat ghp_xxx --owner alice
ai-issue watch --owner alice --push-fork
ai-issue metrics --since 7d
ai-issue search "timeout" --status solved
```

## 13. Troubleshooting

### `Configuration file not found`

```bash
ai-issue init
```

### `repoPath is not set` or `repoPath does not exist`

```bash
ai-issue config set repoPath /absolute/path/to/target-repo
```

Make sure the path is a Git repository:

```bash
git -C /absolute/path/to/target-repo rev-parse --git-dir
```

### `issueBaseUrl format invalid`

Use a URL ending in `/issues`:

```bash
ai-issue config set issueBaseUrl https://github.com/owner/repo/issues
```

### `GITHUB_TOKEN` check fails

Export the token in the same shell:

```bash
export GITHUB_TOKEN="ghp_your_token"
ai-issue check
```

### Copilot CLI check fails

```bash
npm install -g @github/copilot
copilot --version
```

Complete any Copilot authentication prompt, then rerun:

```bash
ai-issue check
```

### Service auth fails

Use Azure CLI auth:

```bash
az login
az account get-access-token --output json
```

If this still fails, confirm that your Azure account has access to the service. API-key auth is a legacy fallback; set `serviceApiKey` only if your service admin tells you to.

### Historical issue search fails during Phase 1

Confirm the service URL first:

```bash
ai-issue config get serviceUrl
```

If your deployment still protects historical-search endpoints with API-key auth, set `serviceApiKey`; otherwise Azure CLI login is the expected path.

### The run created changes on the wrong branch

Check the target repository:

```bash
cd /path/to/target-repo
git branch --show-current
git status --short
```

Prefer:

```bash
ai-issue solve 30340 --branch
```

### Evaluation ran but you wanted to skip it

Use the current global flag:

```bash
ai-issue --skip-eval solve 30340 --branch
```

`--no-eval` is not supported.

### Import rejects `--skip-triage`

That option was removed. Import always runs service triage:

```bash
ai-issue import --dry-run --since 30d
```

## 14. Uninstall

```bash
npm unlink -g ai-issue-cli
rm -rf ~/.ai-issue
```
