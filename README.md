# AI Issue CLI

> 🤖 AI-powered automated Issue resolution and evaluation tool
> **v0.9.0** - Two-Phase Approach: Research → Solution

A command-line tool based on GitHub Copilot CLI that automates the resolution and evaluation of GitHub Issues.

## Features

- ✅ **Two-Phase Resolution** - Phase 1: Deep research, Phase 2: Implementation
- ✅ **Accuracy Focus** - Forced deep research before implementation
- ✅ **Fully Automated** - Complete Issue analysis, code modification, testing, and evaluation
- ✅ **Context Isolation** - Resolution and evaluation use separate AI sessions
- ✅ **Parallel Batch Processing** - Process multiple Issues concurrently (configurable)
- ✅ **Simplified Prompts** - Phase 1: 141 lines, Phase 2: 143 lines (from 617 lines)
- ✅ **Independent Thinking** - Prevents peeking at PR solutions
- ✅ **Configuration Management** - Flexible configuration system
- ✅ **Detailed Logging** - Complete execution log recording
- ✅ **Professional CLI** - Full command-line tool experience
- ✅ **Team Knowledge Sharing** - Knowledge base built from verified resolved issues (server-side scan)
- ✅ **Similar Issue Search** - Vector-based historical issue retrieval via backend service
- ✅ **Smart Triage** - LLM-based issue classification, duplicate detection, and resource owner routing
- ✅ **Watch Daemon** - Auto-poll queued issues and solve them locally
- ✅ **Git Branch + Push** - Create branches and push to fork after solving
- ✅ **Trello Dashboard** - Zero-code visual pipeline with N+1 boards, drag-to-approve PR creation, manager/engineer isolation
- ✅ **Historical Import** - Batch import GitHub issues into pipeline with status inference, timestamp backfill, and Trello sync

## Quick Start

See [QUICKSTART.md](QUICKSTART.md) for detailed installation and usage instructions.

### Prerequisites

- **Node.js** >= 14.0.0
- **Git** — clone the target repository locally (e.g., `terraform-provider-azurerm`)
- **GITHUB_TOKEN** — [create a GitHub PAT](https://github.com/settings/tokens) with `repo` or `public_repo` scope and set it as an environment variable

### Install & Run

```bash
# 1. Install (Linux/macOS)
./scripts/install.sh

# Windows: see QUICKSTART.md for manual steps (npm install && npm link && skills install)

# 2. Configure
ai-issue init
ai-issue config set repoPath /path/to/terraform-provider-azurerm

# 3. Run
ai-issue solve 30340
```

## Configuration Management

### Config Actions

| Action | Usage | Description |
|--------|-------|-------------|
| `show` | `ai-issue config show` | Display all current configuration values |
| `set` | `ai-issue config set <key> <value>` | Set a configuration key to a value |
| `get` | `ai-issue config get <key>` | Get the value of a specific key |
| `reset` | `ai-issue config reset` | Reset all configuration to default values |

### Configuration Keys

| Key | Description | Default |
|-----|-------------|---------|
| `repoPath` | Repository path | *(required, must be set)* |
| `issueBaseUrl` | Issue URL prefix | `https://github.com/hashicorp/terraform-provider-azurerm/issues` |
| `reportPath` | Report output path | `~/.ai-issue/reports` |
| `model` | AI model | `claude-sonnet-4.5` |
| `logLevel` | Log level | `info` |
| `serviceUrl` | ai-issue-service URL | *(env: AI_ISSUE_SERVICE_URL)* |
| `serviceApiKey` | Service API key | *(env: AI_ISSUE_SERVICE_API_KEY)* |
| `repo` | GitHub repo (owner/name) | *(from issueBaseUrl)* |
| `forkRemote` | Git remote for `--push-fork` | `origin` |

### Examples

```bash
ai-issue config set repoPath /path/to/repo
ai-issue config set model gpt-5
ai-issue config get repoPath
ai-issue config show
ai-issue config reset
```

## Command Options

### Global Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--debug` | Enable debug mode (detailed logging) | `ai-issue solve 30340 --debug` |
| `--no-eval` | Skip evaluation phase | `ai-issue solve 30340 --no-eval` |
| `--model <model>` | Override AI model | `ai-issue solve 30340 --model gpt-4` |
| `--concurrency <n>` | Set parallel instances for batch | `ai-issue batch 30340 31316 --concurrency 5` |

### solve Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--branch` | Create git branch `fix/issue-<N>` before solving | `ai-issue solve 30340 --branch` |
| `--push-fork` | Push branch to fork remote after solving | `ai-issue solve 30340 --branch --push-fork` |
| `--force` | Override triage SKIP/NEEDS_HUMAN recommendation | `ai-issue solve 30340 --force` |

### pipeline Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--owner <name>` | Filter by assigned owner | `ai-issue pipeline --owner jiaweitao` |
| `--status <status>` | Filter by status (triaged/queued/solving/solved/failed) | `ai-issue pipeline --status queued` |
| `--limit <n>` | Max entries to return (default: 20) | `ai-issue pipeline --limit 50` |

### watch Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--owner <name>` | **Required.** Your owner identifier | `ai-issue watch --owner alice` |
| `--interval <sec>` | Poll interval in seconds (default: 300) | `ai-issue watch --owner alice --interval 60` |
| `--push-fork` | Push branches to fork remote after solving | `ai-issue watch --owner alice --push-fork` |

Watch daemon behavior: polls `GET /pipeline?owner=xxx&status=queued` every N seconds, automatically picks up and solves issues. Reports `solving` status before starting (distributed lock), then `solved`/`failed` on completion. `Ctrl+C` for graceful shutdown.

### register Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--pat <token>` | **Required.** GitHub PAT (scope: `repo`) | `ai-issue register --pat ghp_xxx` |
| `--owner <name>` | Owner identifier (default: `$USER`) | `ai-issue register --pat ghp_xxx --owner alice` |
| `--trello-member-id <id>` | Trello member ID for board access | `ai-issue register --pat ghp_xxx --trello-member-id 5f8a...` |

### metrics Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--owner <name>` | Filter by engineer | `ai-issue metrics --owner alice` |
| `--since <period>` | Start of time range (default: `30d`) | `ai-issue metrics --since 7d` |
| `--until <date>` | End of time range | `ai-issue metrics --until 2026-04-01` |

View team performance metrics: solve rate, average response/solve time, P50/P90 percentiles. Shows per-engineer breakdown and status/complexity distribution. Requires `ai-issue-service`.

### search Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--owner <name>` | Filter by engineer | `ai-issue search "timeout" --owner alice` |
| `--status <status>` | Filter by status | `ai-issue search "timeout" --status solved` |
| `--limit <n>` | Max results (default: 20) | `ai-issue search "timeout" --limit 5` |

Search issues and solutions by keyword. Uses PostgreSQL full-text search with automatic semantic fallback when fuzzy results are insufficient. Requires `ai-issue-service`.

### import Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--mode <mode>` | Import mode: `full`, `incremental`, `backfill` (default: `incremental`) | `ai-issue import --mode full` |
| `--state <state>` | Issue state filter: `all`, `open`, `closed` (default: `all`) | `ai-issue import --state open` |
| `--since <period>` | Only import issues after this date | `ai-issue import --since 30d` |
| `--labels <labels>` | Comma-separated label filter | `ai-issue import --labels bug,enhancement` |
| `--limit <n>` | Max issues to import | `ai-issue import --limit 1000` |
| `--skip-triage` | Skip LLM triage, use rule-based inference only | `ai-issue import --skip-triage` |
| `--dry-run` | Preview mode, do not write to DB | `ai-issue import --dry-run` |
| `--force` | Re-import issues already in pipeline (overwrite) | `ai-issue import --force` |
| `--status` | Check import progress | `ai-issue import --status` |

Import historical GitHub issues into the pipeline with automatic status inference. Infers `solved`/`skipped`/`triaged`/`queued`/`solving` from issue state, labels, timeline events, and comments. Backfills timestamps (`assigned_at`, `first_response_at`, `solved_at`). Requires `ai-issue-service`.

## Skills (MCP Servers)

AI Issue CLI includes built-in skills powered by MCP (Model Context Protocol) to enhance issue resolution:

| Skill | Tools | Description | Used In |
|-------|-------|-------------|--------|
| `github-issue-fetcher` | `get_issue_context` | Fetch structured issue data from GitHub (comments, timeline, linked PRs) | Phase 1, 2, Evaluate |
| `code-similarity-finder` | `find_similar_implementations` | Find similar Go code implementations by structural analysis | Phase 1 |
| `similar-issue-finder` | `find_similar_issues`, `check_existing_research` | Search historical similar issues and verified solutions via backend service | Phase 1 |

Phase-specific MCP configs control which skills are available at each stage:

| Config File | Phase | Skills |
|-------------|-------|--------|
| `config/mcp-config-phase1.json` | Research | All 3 skills |
| `config/mcp-config-phase2.json` | Solution | `github-issue-fetcher` only |
| `config/mcp-config-evaluate.json` | Evaluation | `github-issue-fetcher` only |

Skills are automatically installed when you run `./scripts/install.sh`.

## Workflow

```
ai-issue solve 30340
        ↓
┌──────────────────────────────────┐
│ Phase 1: Research                │
│ • Check existing team research   │
│ • Search similar historical issues│
│ • Find similar code impl         │
│ • Fetch issue context from GitHub│
└──────────────────────────────────┘
        ↓
┌──────────────────────────────────┐
│ Phase 2: Solution                │
│ • Design fix (or guidance)       │
│ • Modify code & commit           │
│ • (CODE_CHANGE only) Auto run    │
│   terraform AI review + address  │
│   review comments                │
│ • Generate analysis report       │
└──────────────────────────────────┘
        ↓
┌──────────────────────────────────┐
│ Phase 3: Evaluate                │
│ • Find reference PR              │
│ • Compare & score (5 dimensions) │
│ • Generate evaluation report     │
└──────────────────────────────────┘
```

### Automated Triage + Watch Workflow (with ai-issue-service)

```
[Server] Issue Watcher (cron, every 30 min)
  ├─ Poll new issues from upstream repo
  ├─ POST /triage → LLM classify + duplicate detect + owner match
  ├─ Write to pipeline (status: queued / triaged)
  ├─ Notify owner (ADO Work Item comment / email)
  └─ Sync to Trello boards (if enabled)

[Local] ai-issue watch --owner alice
  ├─ Poll GET /pipeline?owner=alice&status=queued (every 5 min)
  ├─ Report status=solving (lock)
  ├─ Auto: ai-issue solve <N> --branch --push-fork
  └─ Report pipeline status=solved → Trello card moves to Review

[Trello] Engineer Board (Phase 4)
  ├─ Engineer sees Review column → clicks GitHub Compare link → reviews diff
  ├─ Drag card to Approved → auto-creates PR (author = engineer)
  └─ Drag card to Rejected → records rejection reason

[Trello] Manager Board (Phase 4)
  ├─ Manager sees all issues across all engineers
  ├─ Triaged column: SKIP/NEEDS_HUMAN issues
  ├─ Drag Triaged → Queued (with Member assigned) → creates engineer card
  └─ Filter by engineer label or member to focus
```

## Output Files

```
reportPath/
├── issue-30340-research.md               # Research report (Phase 1, deleted after Phase 2)
├── issue-30340-analysis-and-solution.md  # Analysis and solution report (Phase 2)
├── issue-30340-evaluation.md             # Evaluation report (Phase 3)
└── logs/
    └── issue-30340-*.log                 # Detailed logs
```

## Backend Service Integration (Optional)

AI Issue CLI can optionally integrate with `ai-issue-service` (a separate FastAPI backend) for team knowledge sharing:

- **Similar issue search** — Vector-based retrieval of historical issues via PostgreSQL + pgvector
- **Knowledge base** — Server-side weekly scan of resolved GitHub issues builds a verified knowledge base
- **Existing research lookup** — Check if teammates have already researched a similar issue

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_ISSUE_SERVICE_URL` | Backend service URL (e.g., `https://your-service.example.com`) | For backend features |
| `AI_ISSUE_SERVICE_API_KEY` | API key for backend authentication | For backend features |
| `GITHUB_TOKEN` | GitHub personal access token (`repo` or `public_repo` scope). [Create one here](https://github.com/settings/tokens). | Yes |

When `AI_ISSUE_SERVICE_URL` is not set, the tool works without backend features — using only GitHub API and local code analysis.

## Project Structure

```
ai-issue-cli/
│
│── ai-issue.js                          # CLI entry point (Commander.js)
│── package.json
│── .editorconfig                        # Editor settings (2-space indent, LF, UTF-8)
│
├── lib/                                 # Core library
│   ├── config.js                        # Configuration management (~/.ai-issue/config.json)
│   ├── copilot.js                       # Copilot CLI executor (phase-aware MCP config)
│   ├── logger.js                        # Logging utilities
│   ├── service-client.js                # HTTP client for ai-issue-service
│   ├── environment.js                   # Environment checks
│   ├── report-validator.js              # Report template validation
│   ├── utils.js                         # Shared helpers (waitForFile, parseBoolean, etc.)
│   ├── git-utils.js                     # Git command wrapper (runGit)
│   ├── review-tool.js                   # Code review tool installation & auto-review
│   ├── prompt-loader.js                 # Prompt template loading from prompts/ dir
│   ├── display-helpers.js               # CLI display formatting + metrics table rendering
│   ├── summary-extractor.js             # Extract solution summary from Phase 2 reports
│   ├── types.js                         # Shared JSDoc typedefs (Config, SolveOptions, etc.)
│   └── commands/                        # Command handlers
│       ├── solve.js                     # solve — two-phase resolution
│       ├── evaluate.js                  # evaluate — standalone evaluation
│       ├── batch.js                     # batch — parallel multi-issue processing
│       ├── triage.js                    # triage — view/trigger issue triage
│       ├── pipeline.js                  # pipeline — view pipeline status (--owner/--status)
│       ├── watch.js                     # watch — daemon for auto-solving queued issues
│       ├── register.js                  # register — register GitHub PAT for PR creation
│       ├── metrics.js                   # metrics — team performance dashboard
│       ├── search-cmd.js               # search — search issues and solutions
│       ├── init.js                      # init — create config file
│       ├── check.js                     # check — environment verification
│       ├── config-cmd.js                # config — show/set/get/reset config
│       └── validate.js                  # validate — report template validation
│
├── skills/                              # MCP Servers (stdio-based)
│   ├── github-issue-fetcher/            # → get_issue_context (GitHub API)
│   ├── code-similarity-finder/          # → find_similar_implementations (local Go analysis)
│   └── similar-issue-finder/            # → find_similar_issues, check_existing_research (backend)
│
├── config/                              # MCP configuration files
│   ├── mcp-config-phase1.json           # Phase 1: all 3 skills
│   ├── mcp-config-phase2.json           # Phase 2: github-issue-fetcher only
│   ├── mcp-config-evaluate.json         # Evaluate: github-issue-fetcher only
│   └── mcp-config.json                  # Default fallback config
│
├── prompts/                             # Prompt templates
│   ├── PHASE1_RESEARCH_PROMPT.md        # Phase 1 prompt template
│   ├── PHASE2_SOLUTION_PROMPT.md        # Phase 2 prompt (CODE_CHANGE)
│   ├── PHASE2_GUIDANCE_PROMPT.md        # Phase 2 prompt (GUIDANCE)
│   └── MANUAL_EVALUATION_PROMPT.md      # Evaluation prompt template
│
├── scripts/                             # Utility scripts
│   ├── install.sh                       # Installation script
│   ├── monitor_progress.sh              # Real-time progress monitor
│   └── test-skills.js                   # MCP skills verification
│
├── QUICKSTART.md                        # Quick start guide
│
└── tests/                               # Jest unit tests
    ├── helpers/
    │   └── mock-logger.js               # Shared mock logger factory
    ├── commands/                        # Command handler tests
    │   ├── solve.test.js
    │   ├── evaluate.test.js
    │   ├── batch.test.js
    │   ├── triage.test.js
    │   ├── watch.test.js
    │   ├── init.test.js
    │   ├── check.test.js
    │   └── config-cmd.test.js
    ├── config.test.js
    ├── copilot.test.js
    ├── service-client.test.js
    ├── review-tool.test.js
    ├── utils.test.js
    ├── git-utils.test.js
    ├── display-helpers.test.js
    ├── prompt-loader.test.js
    └── ...
```

## Trello Dashboard Guide

The Trello Dashboard replaces a traditional web UI with zero frontend code. It provides a visual pipeline for the entire issue lifecycle — from triage to PR creation — using drag-and-drop on Trello boards.

### Architecture: N+1 Boards

The system uses **physically isolated boards** for data privacy:

- **Manager Board** (1 board) — Visible only to the team manager. Shows **all** issues across all engineers. Used for monitoring, triage overrides, and task assignment.
- **Engineer Board** (1 per engineer) — Visible only to that engineer + the bot. Shows only issues **assigned to them**. Used for reviewing solutions and approving/rejecting.

### Issue State Machine

Every issue has a `status` in the pipeline database. The state machine:

```
                    ┌─────────────────────────────────────────┐
                    │              (requeue)                   │
                    ▼                                         │
┌─────────┐    ┌────────┐    ┌─────────┐    ┌────────┐    ┌──────────┐
│ triaged │───▶│ queued │───▶│ solving │───▶│ solved │───▶│pr_created│
└─────────┘    └────────┘    └─────────┘    └────────┘    └──────────┘
  SKIP/              ▲            │              │
  NEEDS_HUMAN        │            │              ▼
                     └────────────┘         ┌──────────┐
                       (requeue)            │ rejected │
                          ▲                 └──────────┘
                          │
                      ┌────────┐
                      │ failed │
                      └────────┘
```

**State transitions and who triggers them:**

| Transition | Triggered By | How |
|------------|-------------|-----|
| → `triaged` | Issue Watcher | Auto-triage (SKIP / NEEDS_HUMAN) |
| → `queued` | Issue Watcher | Auto-triage (PROCEED) |
| `triaged` → `queued` | Manager | Trello drag Triaged→Queued or API `/enqueue` |
| `queued` → `triaged` | Manager | Trello drag Queued→Triaged or Remove Member or API `/dequeue` |
| `queued` → `solving` | Watch daemon | API `/solving` (distributed lock) |
| `solving` → `solved` | CLI | API `/solved` (solve completed) |
| `solving` → `failed` | CLI | API `/failed` (solve error) |
| `solved` → `pr_created` | Engineer | Trello drag Review→Approved or API `/approve` |
| `solved` → `rejected` | Engineer | Trello drag Review→Rejected or API `/reject` |
| `failed` → `queued` | Manager/API | API `/requeue` |

**Mapping to Trello board columns:**

| Pipeline Status | Manager Board | Engineer Board |
|----------------|---------------|----------------|
| `triaged` | 📥 Triaged | *(not shown)* |
| `queued` | 🔄 Queued | 🔄 Queued |
| `solving` | 🔨 Solving | 🔨 Solving |
| `solved` | 👀 Review | 👀 Review |
| `pr_created` | ✅ Approved | ✅ Approved |
| `rejected` | ❌ Rejected | ❌ Rejected |
| `failed` | ❌ Rejected | ❌ Rejected |

> Note: `failed` and `rejected` share the Rejected column; the card comment indicates the reason.

### Board Columns

**Manager Board** has 6 columns:
```
📥 Triaged → 🔄 Queued → 🔨 Solving → 👀 Review → ✅ Approved → ❌ Rejected
```

**Engineer Board** has 5 columns (no Triaged — engineers don't see SKIP/NEEDS_HUMAN issues):
```
🔄 Queued → 🔨 Solving → 👀 Review → ✅ Approved → ❌ Rejected
```

### Card Anatomy

Each card represents one GitHub issue:

```
🟢 #31984  azurerm_container_app crashes on read

Labels:  [CODE_CHANGE] [MEDIUM] [AI-HIGH]
Due:     2026-04-10 (if SLA configured)

── Description ──
Resource: azurerm_container_app
Confidence: 85%
Reasoning: Missing null check on flattenXxx()
Branch: ai/issue-31984

🔗 GitHub Issue → github.com/hashicorp/.../issues/31984
🔗 View Diff   → github.com/your-fork/compare/main...ai/issue-31984

── Comments ──
[Bot] ✅ PR #123 created → github.com/.../pull/123
```

**Title emoji** — set at creation, indicates triage recommendation:

| Emoji | Meaning | Triage Recommendation |
|-------|---------|----------------------|
| 🟢 | AI can handle this | `PROCEED` |
| ⏭️ | Skip (question, non-code) | `SKIP` |
| 🟡 | Needs human judgment | `NEEDS_HUMAN` |

**Labels** — auto-assigned based on triage, 3 per card:

| Color | Category | Possible Values |
|-------|----------|----------------|
| 🔵 Blue | Issue type | `CODE_CHANGE`, `BUG_REPORT`, `GUIDANCE`, `QUESTION`, `FEATURE_REQUEST` |
| 🟡 Yellow | Complexity | `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |
| 🟢 Green | AI solvability | `AI-HIGH`, `AI-MEDIUM`, `AI-LOW` |
| ⚫ Black | Engineer (manager board only) | `👤alice`, `👤bob`, etc. |

Use Trello's **Filter by label** to quickly find issues by type, complexity, or assignee.

### Manager Workflow

#### Step 1: Monitor the Pipeline

Open the Manager Board. Cards automatically appear as Issue Watcher triages new issues:
- **Triaged column** — Issues marked SKIP or NEEDS_HUMAN. Not auto-assigned.
- **Queued column** — Issues marked PROCEED. Already assigned to an engineer by resource matching.
- Other columns update automatically as engineers work.

#### Step 2: Assign SKIP/NEEDS_HUMAN Issues (if needed)

For issues in the Triaged column that you want an engineer to handle:

1. Click the card → **Members** → Add the responsible engineer
2. Drag the card from **Triaged → Queued**
3. System automatically:
   - Updates DB: status=queued, assigned_to=engineer
   - Creates a card on the engineer's private board
   - Sends notification to the engineer

If you drag without adding a Member first, the card bounces back with a comment:
> ⚠️ Please Add Member to assign an engineer before moving to Queued.

#### Step 3: Unassign / Dequeue

To take an issue back from an engineer:
- **Option A**: Drag the card from **Queued → Triaged**
- **Option B**: Remove the Member from a Queued card

Both actions: dequeue the issue + delete the card from the engineer's board.

#### Step 4: Filter and Track

- Use **Filter by member** to see one engineer's workload
- Use **Filter by label** to find all `CRITICAL` or `CODE_CHANGE` issues
- Count cards per column for throughput metrics

### Engineer Workflow

#### Step 1: Initial Setup (one-time)

```bash
# Register your GitHub PAT for PR creation
ai-issue register --pat ghp_xxxxxxxxxxxx --trello-member-id YOUR_TRELLO_ID
```

This encrypts your PAT on the server and creates your private Trello board.

To find your Trello member ID, ask your admin or check in a browser:
```
https://trello.com/1/members/me?key=API_KEY&token=API_TOKEN
```

#### Step 2: Start Watch Daemon (optional, maximum automation)

```bash
ai-issue watch --owner YOUR_NAME --push-fork
```

The daemon auto-polls queued issues, solves them, and pushes to your fork. Cards move automatically: Queued → Solving → Review.

#### Step 3: Review Solutions

When a card appears in the **Review** column on your private board:

1. Click the **View Diff** link on the card → opens GitHub Compare page
2. Review the code changes
3. Decision:

**Approve** — Drag card from **Review → Approved**:
- System creates a PR using your PAT (PR author = you)
- Card comment: `✅ PR #123 created → [link]`
- Manager board card syncs to Approved

**Reject** — Drag card from **Review → Rejected**:
- System marks as rejected
- Card comment prompts: `Please fill in the rejection reason`
- Manager board card syncs to Rejected

#### Step 4: Check Pipeline Status

```bash
# See your current issues
ai-issue pipeline --owner YOUR_NAME

# See only queued issues
ai-issue pipeline --status queued
```

### Allowed vs. Illegal Drags

Only specific drag directions are allowed. All other drags are **automatically bounced back** to the original column with a comment.

**Manager Board — allowed:**

| Drag | What Happens |
|------|-------------|
| Triaged → Queued (with Member) | Assign + create engineer card |
| Queued → Triaged | Dequeue + delete engineer card |

**Engineer Board — allowed:**

| Drag | What Happens |
|------|-------------|
| Review → Approved | Create PR (author = you) |
| Review → Rejected | Record rejection |

**Everything else** (e.g., Queued → Solving, Triaged → Review, Approved → Queued) is illegal and gets bounced back immediately.

### Automatic Card Updates

Cards move automatically in response to backend events — no manual dragging required for these:

| Event | Card Movement |
|-------|--------------|
| Issue Watcher triages new issue (PROCEED) | Card created in Queued on both boards |
| Issue Watcher triages new issue (SKIP/NEEDS_HUMAN) | Card created in Triaged on manager board only |
| Watch daemon picks up issue | Queued → Solving |
| CLI solve completes | Solving → Review (+ diff link added) |
| CLI solve fails | → Rejected (+ error comment) |
| Pipeline entry deleted | Card archived on both boards |

### CLI Command Cheat Sheet

```bash
# View your pipeline
ai-issue pipeline --owner YOUR_NAME

# View all queued issues
ai-issue pipeline --status queued

# Manually triage an issue
ai-issue triage 31984

# Manually solve (without watch daemon)
ai-issue solve 31984 --branch --push-fork

# Register / update your GitHub PAT
ai-issue register --pat ghp_xxx

# Start auto-solve daemon
ai-issue watch --owner YOUR_NAME --push-fork

# View team metrics (past 30 days)
ai-issue metrics

# View metrics for a specific engineer
ai-issue metrics --owner alice --since 7d

# Search issues and solutions
ai-issue search "polling timeout"

# Search with filters
ai-issue search "key vault" --owner alice --status solved
```

## Troubleshooting

### Copilot CLI version too old
```bash
npm update -g @github/copilot
ai-issue check
```

### Configuration file corrupted
```bash
ai-issue config reset
ai-issue config set repoPath /your/path
```

### Git operations failed
```bash
cd /path/to/repo
git status
git checkout main
```

## Acknowledgments

- GitHub Copilot
- Terraform Provider AzureRM
