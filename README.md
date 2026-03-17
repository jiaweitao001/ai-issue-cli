# AI Issue CLI

> 🤖 AI-powered automated Issue resolution and evaluation tool
> **v2.0.0** - Two-Phase Approach: Research → Solution

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
- ✅ **Team Knowledge Sharing** - Research reports auto-uploaded to team backend for reuse
- ✅ **Similar Issue Search** - Vector-based historical issue retrieval via backend service

## Quick Start

See [QUICKSTART.md](QUICKSTART.md) for detailed installation and usage instructions.

```bash
# 1. Install
./install.sh

# 2. Configure
ai-issue init
ai-issue config set repoPath /path/to/terraform-provider-azurerm

# 3. Run
ai-issue solve 30340
```

## Configuration Options

| Option | Description | Default |
|--------|-------------|--------|
| `repoPath` | Repository path | *(required, must be set)* |
| `issueBaseUrl` | Issue URL prefix | `https://github.com/hashicorp/terraform-provider-azurerm/issues` |
| `reportPath` | Report output path | `~/.ai-issue/reports` |
| `model` | AI model | `claude-sonnet-4.5` |
| `logLevel` | Log level | `info` |

## Command Options

| Option | Description | Usage |
|--------|-------------|-------|
| `--debug` | Enable debug mode (detailed logging) | `ai-issue solve 30340 --debug` |
| `--no-eval` | Skip evaluation phase | `ai-issue solve 30340 --no-eval` |
| `--model <model>` | Override AI model | `ai-issue solve 30340 --model gpt-4` |
| `--concurrency <n>` | Set parallel instances for batch | `ai-issue batch 30340 31316 --concurrency 5` |

**Debug Mode**: Shows detailed execution information including config values, file paths, copilot commands, and sets log level to `debug`. Useful for troubleshooting.

## Skills (MCP Servers)

AI Issue CLI includes built-in skills powered by MCP (Model Context Protocol) to enhance issue resolution:

| Skill | Tools | Description | Used In |
|-------|-------|-------------|--------|
| `github-issue-fetcher` | `get_issue_context` | Fetch structured issue data from GitHub (comments, timeline, linked PRs) | Phase 1, 2, Evaluate |
| `code-similarity-finder` | `find_similar_implementations` | Find similar Go code implementations by structural analysis | Phase 1 |
| `similar-issue-finder` | `find_similar_issues`, `check_existing_research` | Search historical similar issues and team research reports via backend service | Phase 1 |

Phase-specific MCP configs control which skills are available at each stage:

| Config File | Phase | Skills |
|-------------|-------|--------|
| `mcp-config-phase1.json` | Research | All 3 skills |
| `mcp-config-phase2.json` | Solution | `github-issue-fetcher` only |
| `mcp-config-evaluate.json` | Evaluation | `github-issue-fetcher` only |

Skills are automatically installed when you run `./install.sh`.

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
│ • Upload research to backend     │
└──────────────────────────────────┘
        ↓
┌──────────────────────────────────┐
│ Phase 2: Solution                │
│ • Design fix (or guidance)       │
│ • Modify code & commit           │
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
- **Research report caching** — Auto-upload Phase 1 reports so team members can reuse findings
- **Existing research lookup** — Check if teammates have already researched a similar issue

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AI_ISSUE_SERVICE_URL` | Backend service URL (e.g., `https://your-service.example.com`) | For backend features |
| `AI_ISSUE_SERVICE_API_KEY` | API key for backend authentication | For backend features |
| `GITHUB_TOKEN` | GitHub personal access token (read access to issues/PRs) | Yes |

When `AI_ISSUE_SERVICE_URL` is not set, the tool works without backend features — using only GitHub API and local code analysis.

## Project Structure

```
ai-issue-cli/
│
│── ai-issue.js                          # CLI entry point (Commander.js)
│── install.sh                           # Installation script
│── package.json
│
├── lib/                                 # Core library
│   ├── config.js                        # Configuration management (~/.ai-issue/config.json)
│   ├── copilot.js                       # Copilot CLI executor (phase-aware MCP config)
│   ├── logger.js                        # Logging utilities
│   ├── environment.js                   # Environment checks
│   ├── report-validator.js              # Report template validation
│   └── commands/                        # Command handlers
│       ├── solve.js                     # solve — two-phase resolution + backend upload
│       ├── evaluate.js                  # evaluate — standalone evaluation
│       ├── batch.js                     # batch — parallel multi-issue processing
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
├── mcp-config-phase1.json               # Phase 1: all 3 skills
├── mcp-config-phase2.json               # Phase 2: github-issue-fetcher only
├── mcp-config-evaluate.json             # Evaluate: github-issue-fetcher only
├── mcp-config.json                      # Default fallback config
│
├── PHASE1_RESEARCH_PROMPT.md            # Phase 1 prompt template
├── PHASE2_SOLUTION_PROMPT.md            # Phase 2 prompt (CODE_CHANGE)
├── PHASE2_GUIDANCE_PROMPT.md            # Phase 2 prompt (GUIDANCE)
├── MANUAL_EVALUATION_PROMPT.md          # Evaluation prompt template
│
├── docs/                                # Design specs
│   ├── PHASE1_SPEC.md                   # Backend Phase 1: similar issue search
│   ├── PHASE2_SPEC.md                   # Backend Phase 2: research report caching
│   └── PHASE3_SPEC.md                   # Backend Phase 3: feedback loop
│
└── tests/                               # Jest unit tests
    ├── commands/                        # Command handler tests
    ├── config.test.js
    ├── copilot.test.js
    └── ...
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
