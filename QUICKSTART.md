# 🚀 Quick Start Guide

## What's New in v2.0

✨ **Two-Phase Resolution**:
- Phase 1: Deep Research (find similar implementations, SDK tools, code history)
- Phase 2: Solution Implementation (based on research findings)
- Result: ~60% accuracy improvement!

🔍 **Backend Service Integration** (optional):
- Search historical similar issues via vector similarity (PostgreSQL + pgvector)
- Auto-upload research reports for team knowledge sharing
- Check if teammates have already researched a similar issue

⚡ **Parallel Batch Processing**:
- Process multiple issues concurrently
- Configurable concurrency (default: 3, recommended ≤5 to avoid rate limits)
- Real-time progress tracking

## 1. Installation

```bash
cd /path/to/ai-issue-cli
./install.sh
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
- Output: `issue-XXX-research.md` (auto-uploaded to backend)

**Phase 2: Solution Implementation (143 lines prompt)**
- Design solution based on research findings
- Follow similar implementations
- Use SDK functions (not reinvent)
- Ensure completeness (all CRUD operations)
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

## 8. Directory Structure

```
ai-issue-cli/
│
│── ai-issue.js                          # CLI entry point
│── install.sh                           # Installation script
│
├── lib/                                 # Core library
│   ├── config.js                        #   Configuration management
│   ├── copilot.js                       #   Copilot CLI executor
│   ├── logger.js                        #   Logging utilities
│   └── commands/                        #   Command handlers
│       ├── solve.js                     #     Two-phase resolve + backend upload
│       ├── batch.js                     #     Parallel multi-issue processing
│       ├── evaluate.js                  #     Standalone evaluation
│       └── ...                          #     init, check, config, validate
│
├── skills/                              # MCP Servers (Copilot CLI tools)
│   ├── github-issue-fetcher/            #   GitHub API → issue context
│   ├── code-similarity-finder/          #   Local → Go code structural analysis
│   └── similar-issue-finder/            #   Backend → similar issues & research
│
├── mcp-config-phase1.json               # Research phase: all 3 skills
├── mcp-config-phase2.json               # Solution phase: github-issue-fetcher only
├── mcp-config-evaluate.json             # Evaluate phase: github-issue-fetcher only
│
├── PHASE1_RESEARCH_PROMPT.md            # Prompt templates
├── PHASE2_SOLUTION_PROMPT.md
├── PHASE2_GUIDANCE_PROMPT.md
├── MANUAL_EVALUATION_PROMPT.md
│
├── docs/                                # Backend service design specs
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
