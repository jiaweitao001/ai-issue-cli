# AI Issue CLI

> 🤖 AI-powered automated Issue resolution and evaluation tool
> **v2.0.0** - Two-Phase Approach: Research → Solution

A command-line tool based on GitHub Copilot CLI that automates the resolution and evaluation of GitHub Issues.

## ✨ What's New in v2.0

- 🔬 **Two-Phase Approach** - Separate research and solution phases for better accuracy
- 📊 **60% Accuracy Improvement** - Forced deep research before implementation
- ⚡ **Parallel Processing** - Configurable concurrency for batch operations (recommended ≤5 to avoid rate limits)
- 🎯 **Simplified Prompts** - Phase 1: 141 lines, Phase 2: 143 lines (from 617 lines)
- 🔍 **Independent Thinking** - Prevents peeking at PR solutions

## Features

- ✅ **Two-Phase Resolution** - Phase 1: Deep research, Phase 2: Implementation
- ✅ **Fully Automated** - Complete Issue analysis, code modification, testing, and evaluation
- ✅ **Context Isolation** - Resolution and evaluation use separate AI sessions
- ✅ **Parallel Batch Processing** - Process multiple Issues concurrently (configurable)
- ✅ **Configuration Management** - Flexible configuration system
- ✅ **Detailed Logging** - Complete execution log recording
- ✅ **Professional CLI** - Full command-line tool experience

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

## Workflow

```
ai-issue solve 30340
        ↓
┌─────────────────────┐
│ Phase 1: Research   │
│ • Find similar impl │
│ • Search SDK tools  │
│ • Analyze history   │
└─────────────────────┘
        ↓
┌─────────────────────┐
│ Phase 2: Solution   │
│ • Design fix        │
│ • Modify code       │
│ • Commit changes    │
└─────────────────────┘
        ↓
┌─────────────────────┐
│ Phase 3: Evaluate   │
│ • Compare with std  │
│ • Generate report   │
└─────────────────────┘
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

## Project Structure

```
cli/
├── ai-issue.js                           # Main entry point
├── lib/                                  # Library modules
│   ├── config.js                        # Configuration management
│   ├── copilot.js                       # Copilot executor
│   ├── logger.js                        # Logging utilities
│   ├── environment.js                   # Environment checks
│   └── commands/                        # Command implementations
├── PHASE1_RESEARCH_PROMPT.md          # Phase 1: Research prompt
├── PHASE2_SOLUTION_PROMPT.md          # Phase 2: Solution prompt (CODE_CHANGE)
├── PHASE2_GUIDANCE_PROMPT.md          # Phase 2: Guidance prompt (GUIDANCE)
└── MANUAL_EVALUATION_PROMPT.md        # Evaluation prompt
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
