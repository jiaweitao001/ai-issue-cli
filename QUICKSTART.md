# 🚀 Quick Start Guide

## What's New in v2.0

✨ **Two-Phase Resolution**:
- Phase 1: Deep Research (find similar implementations, SDK tools, code history)
- Phase 2: Solution Implementation (based on research findings)
- Result: ~60% accuracy improvement!

🔍 **Backend Service Integration** (optional):
- Search historical similar issues via vector similarity (PostgreSQL + pgvector)
- Knowledge base built from verified resolved issues (server-side scan)
- Check if teammates have already researched a similar issue

⚡ **Parallel Batch Processing**:
- Process multiple issues concurrently
- Configurable concurrency (default: 3, recommended ≤5 to avoid rate limits)
- Real-time progress tracking

## 1. Installation

```bash
cd /path/to/ai-issue-cli
./scripts/install.sh
```

Choose **Option 2 (Local Link)** for development mode installation.

## 2. Initialize & Configure

```bash
# Initialize configuration file
ai-issue init

# Set required configurations
ai-issue config set repoPath /path/to/your/repo
# issueBaseUrl defaults to terraform-provider-azurerm, change if needed:
# ai-issue config set issueBaseUrl https://github.com/owner/repo/issues

# View configuration
ai-issue config show
```

### Environment Variables

```bash
# Required
export GITHUB_TOKEN="ghp_..."              # GitHub PAT (read access to issues/PRs)

# Optional - Backend service for team knowledge sharing
export AI_ISSUE_SERVICE_URL="https://your-service.example.com"
export AI_ISSUE_SERVICE_API_KEY="your-api-key"
```

Without `AI_ISSUE_SERVICE_URL`, the tool works standalone using only GitHub API and local code analysis.

## 3. Environment Check

```bash
ai-issue check
```

Ensure all checks pass.

## 4. Test Run

```bash
# Process a new Issue
ai-issue solve 30340

# View help
ai-issue help
```

## 5. Command Overview

```bash
# Core commands (v2.0)
ai-issue solve <number>           # Two-phase: Research → Solution → Evaluation
ai-issue solve <number> --debug   # Enable debug mode (detailed logging)
ai-issue batch <n1> <n2> ...      # Parallel batch processing (default: 3 concurrent)
ai-issue batch <n1> <n2> --concurrency 5  # Custom concurrency

# Management commands
ai-issue config show              # View configuration
ai-issue config set <k> <v>       # Set configuration
ai-issue check                    # Environment check
ai-issue help                     # Help information

# Phase 3: Server-backed commands (require AI_ISSUE_SERVICE_URL)
ai-issue triage <number>          # View triage result for an issue
ai-issue pipeline                 # View pipeline status (--owner, --status)
ai-issue watch --owner <name>     # Auto-solve daemon

# Phase 4: Trello Dashboard commands
ai-issue register --pat <token>   # Register GitHub PAT for PR creation
```

## 6. FAQ

### Q: How to enable debug mode?
```bash
# Enable detailed logging for troubleshooting
ai-issue solve 30340 --debug

# Shows:
# - Configuration details
# - File paths being used
# - Copilot command details
# - Execution flow tracking
```

### Q: How to skip evaluation?
```bash
ai-issue solve 30340 --no-eval
```

### Q: How to switch AI model?
```bash
ai-issue solve 30340 --model gpt-5
# Or set permanently
ai-issue config set model gpt-5
```

### Q: How does parallel batch processing work?
```bash
# Default: 3 concurrent issues
ai-issue batch 30340 31316 31500

# Custom: 5 concurrent issues (recommended max to avoid rate limits)
ai-issue batch 30049 30340 30360 30384 30437 31120 31180 --concurrency 5

# View real-time progress
# Output shows: Progress: 3/7 | Active: #30049, #30340, #30360
```

### Q: Where are the generated files?
```bash
# Phase 1: Research report (temporary, deleted after Phase 2)
~/.ai-issue/reports/issue-30340-research.md

# Phase 2: Analysis and solution report (final output)
~/.ai-issue/reports/issue-30340-analysis-and-solution.md

# Phase 3: Evaluation report
~/.ai-issue/reports/issue-30340-evaluation.md
```

### Understanding Two-Phase Approach

**Phase 1: Deep Research (141 lines prompt)**
- Check existing team research (via backend, if configured)
- Search similar historical issues (via backend vector search)
- Find similar code implementations (local Go AST analysis)
- Fetch issue context from GitHub (comments, timeline, linked PRs)
- Search for existing SDK tools
- Analyze code history with git
- Output: `issue-XXX-research.md` (temporary, used by Phase 2)

**Phase 2: Solution Implementation (143 lines prompt)**
- Design solution based on research findings
- Follow similar implementations
- Use SDK functions (not reinvent)
- Ensure completeness (all CRUD operations)
- For CODE_CHANGE: auto-commit solution, then run terraform AI review and address review comments
- Output: `issue-XXX-analysis-and-solution.md`

**Why Two-Phase?**
- Prevents "quick fix" without understanding root cause
- Forces AI to find similar implementations first
- Leverages team knowledge from historical issues and prior research
- Uses shorter, focused prompts (was 617 lines total)
- ~60% accuracy improvement in testing

### Q: How to uninstall?
```bash
npm unlink -g ai-issue-cli
```

## 7. Advanced Usage

### Combine with GitHub CLI
```bash
# Get latest open Issues and process
gh issue list --limit 5 --json number --jq '.[].number' | xargs ai-issue batch
```

### Phase 4: Trello Dashboard Setup

Trello Dashboard enables team-wide visualization of the issue processing pipeline, with drag-and-drop actions for approval and assignment.

#### 7.1 Get Trello Credentials

1. Go to https://trello.com/power-ups/admin → Create a new Power-Up → Note the **API Key**
2. Visit the following URL in your browser (replace `YOUR_KEY`):
   ```
   https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=YOUR_KEY
   ```
   Click **Allow** → Copy the **API Token** shown on the page

#### 7.2 Create Manager Board

Create a Trello board manually with 6 lists (left to right):
- Triaged → Queued → Solving → Review → Approved → Rejected

Note the Board ID from the URL: `https://trello.com/b/BOARD_ID/...`

#### 7.3 Configure and Deploy

```bash
# Generate encryption key
python3 -c "import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"

# Add to terraform.tfvars
trello_api_key          = "your API Key"
trello_api_token        = "your Token"
trello_manager_board_id = "manager Board ID"
trello_webhook_secret   = "any random string"
encryption_key          = "generated key above"
fork_repo               = "your-org/terraform-provider-azurerm"

# Deploy
cd infra && terraform apply
```

#### 7.4 Register Engineers

Each engineer runs this once locally:

```bash
# Register GitHub PAT (used to create PRs on your behalf)
ai-issue register --pat ghp_xxxxxxxxxxxx

# With Trello member ID (optional)
ai-issue register --pat ghp_xxx --trello-member-id 5f8a...
```

After registration, the system automatically creates your private Trello board (visible only to you).

#### 7.5 Daily Usage

##### Engineer Perspective

```
1. Start watch daemon at the beginning of your day (optional, maximum automation)
   $ ai-issue watch --owner jiaweitao --push-fork

   → Daemon auto-polls your queued issues → solve → push fork → report solved
   → Your Trello board cards move automatically: Queued → Solving → Review

2. See a card in the Review column (via email / Trello notification)

3. Click the "View Diff" link on the card → review code on GitHub Compare page

4. Approve: Drag the card to ✅ Approved
   → System creates a PR using your PAT (author = you)
   → Card comment: "✅ PR #123 created → [link]"

5. Reject: Drag the card to ❌ Rejected
   → System marks as rejected + prompts you to fill in rejection reason

6. Other drag directions are automatically bounced back (e.g., Queued → Approved)
```

##### Manager Perspective

```
1. Open Manager Board (📊 AI Issue Pipeline) → see all issues across all engineers

2. Triaged column: SKIP / NEEDS_HUMAN issues (not auto-assigned)
   → Decide whether to process
   → Add Member to the card (choose the responsible engineer)
   → Drag card to Queued
   → System creates a card on that engineer's private board + sends notification

3. Monitor team throughput by card counts per column

4. Use Trello's Filter by member / label to focus on a specific engineer

5. To unassign: Drag Queued card back to Triaged → auto-deletes engineer board card
```

##### CLI Command Cheat Sheet

```bash
# View pipeline (my issues)
ai-issue pipeline --owner jiaweitao

# View all queued issues
ai-issue pipeline --status queued

# Manually triage an issue
ai-issue triage 31984

# Manually solve an issue (without watch daemon)
ai-issue solve 31984 --branch --push-fork

# Register / update GitHub PAT
ai-issue register --pat ghp_xxx
```

## 8. Directory Structure

```
ai-issue-cli/
│
│── ai-issue.js                          # CLI entry point
│
├── lib/                                 # Core library
│   ├── config.js                        #   Configuration management
│   ├── copilot.js                       #   Copilot CLI executor
│   ├── logger.js                        #   Logging utilities
│   ├── service-client.js                #   HTTP client for ai-issue-service
│   └── commands/                        #   Command handlers
│       ├── solve.js                     #     Two-phase resolve + --branch/--push-fork
│       ├── batch.js                     #     Parallel multi-issue processing
│       ├── evaluate.js                  #     Standalone evaluation
│       ├── triage.js                    #     View/trigger issue triage
│       ├── pipeline.js                  #     View pipeline status (--owner/--status)
│       ├── watch.js                     #     Watch daemon (auto-solve queued issues)
│       ├── register.js                  #     Register GitHub PAT for PR creation
│       └── ...                          #     init, check, config, validate
│
├── skills/                              # MCP Servers (Copilot CLI tools)
│   ├── github-issue-fetcher/            #   GitHub API → issue context
│   ├── code-similarity-finder/          #   Local → Go code structural analysis
│   └── similar-issue-finder/            #   Backend → similar issues & research
│
├── config/                              # MCP configuration files
│   ├── mcp-config-phase1.json           #   Research phase: all 3 skills
│   ├── mcp-config-phase2.json           #   Solution phase: github-issue-fetcher only
│   └── mcp-config-evaluate.json         #   Evaluate phase: github-issue-fetcher only
│
├── prompts/                             # Prompt templates
│   ├── PHASE1_RESEARCH_PROMPT.md
│   ├── PHASE2_SOLUTION_PROMPT.md
│   ├── PHASE2_GUIDANCE_PROMPT.md
│   └── MANUAL_EVALUATION_PROMPT.md
│
├── scripts/                             # Utility scripts
│   ├── install.sh                       #   Installation script
│   └── monitor_progress.sh              #   Real-time progress monitor
│
├── docs/                                # Design specs & guides
└── tests/                               # Jest unit tests
```

## 9. Next Steps

1. ✅ CLI tool installed
2. ✅ Environment configured
3. ⏭️  Run `ai-issue solve 30340` to test
4. ⏭️  Check generated reports
5. ⏭️  Adjust configuration as needed

---

**Ready? Run your first command:**

```bash
ai-issue solve 30340
```
