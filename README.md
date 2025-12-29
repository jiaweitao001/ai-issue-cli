# AI Issue CLI

> 🤖 AI-powered automated Issue resolution and evaluation tool
> **v2.0.0** - Two-Phase Approach: Research → Solution

A command-line tool based on GitHub Copilot CLI that automates the resolution and evaluation of GitHub Issues.

## ✨ What's New in v2.0

- 🔬 **Two-Phase Approach** - Separate research and solution phases for better accuracy
- 📊 **60% Accuracy Improvement** - Forced deep research before implementation
- ⚡ **Parallel Processing** - Configurable concurrency for batch operations
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

## Installation

### Prerequisites

- Node.js >= 14.0.0
- GitHub Copilot CLI >= 0.0.342
- GitHub Copilot subscription

### Quick Installation

```bash
# 1. Clone or download the code
cd /path/to/cli

# 2. Run the installation script
chmod +x install.sh
./install.sh

# 3. Choose installation method
#    Option 1: Global installation (recommended)
#    Option 2: Local link (development mode)
```

### Manual Installation

```bash
# Global installation
npm install -g .

# Or use npm link (development mode)
npm link
```

### Install GitHub Copilot CLI

```bash
npm install -g @github/copilot
```

## Configuration

### First-time Use

```bash
# 1. Check environment
ai-issue check

# 2. Configure paths
ai-issue config set repoPath /path/to/your/repo
ai-issue config set reportPath /path/to/reports

# 3. View configuration
ai-issue config show
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|--------|
| `repoPath` | Repository path | `~/Work/terraform-provider-azurerm` |
| `reportPath` | Report output path | `~/Work/AI_Issue_Experiment` |
| `model` | AI model | `claude-sonnet-4.5` |
| `logLevel` | Log level | `info` |
| `issueBaseUrl` | Issue URL prefix | GitHub URL |

### Environment Variables

You can override configuration with environment variables:

```bash
export AI_ISSUE_REPO_PATH="/path/to/repo"
export AI_ISSUE_REPORT_PATH="/path/to/reports"
export AI_ISSUE_MODEL="gpt-5"
export AI_ISSUE_LOG_LEVEL="debug"
```

## Usage

### Basic Commands

```bash
# Solve a single Issue (Two-Phase: Research → Solution → Evaluation)
ai-issue solve 30340

# Solve only, skip evaluation
ai-issue solve 30340 --no-eval

# Evaluate a solved Issue separately
ai-issue evaluate 30340

# Batch processing (default: 3 concurrent)
ai-issue batch 30340 31316 31500

# Custom concurrency
ai-issue batch 30340 31316 31500 --concurrency 5

# Batch with options
ai-issue batch 30049 30340 30360 30384 30437 31120 31180 --concurrency 7 --no-eval

# Specify AI model
ai-issue solve 30340 --model gpt-5
```

### Configuration Management

```bash
# Show all configurations
ai-issue config show

# Set configuration
ai-issue config set repoPath /new/path
ai-issue config set model gpt-5

# Get configuration
ai-issue config get model

# Reset configuration
ai-issue config reset
```

### Environment Check

```bash
# Check environment configuration
ai-issue check
```

### Other Commands

```bash
# Show version
ai-issue version

# Show help
ai-issue help
```

## Workflow

### Single Issue Processing Flow

```
ai-issue solve 30340
        ↓
┌─────────────────────┐
│ Copilot Session 1   │
│ (Solve Issue)       │
├─────────────────────┤
│ • Get Issue details │
│ • Analyze code      │
│ • Create Git branch │
│ • Modify code       │
│ • Update tests      │
│ • Update docs       │
│ • Commit changes    │
│ • Generate analysis │
└─────────────────────┘
        ↓
   Wait for completion
        ↓
┌─────────────────────┐
│ Copilot Session 2   │
│ (Evaluate) Isolated │
├─────────────────────┤
│ • Read analysis.md  │
│ • Evaluate by std   │
│ • Generate eval.md  │
└─────────────────────┘
        ↓
      Done!
```

## Output Files

```
reportPath/
├── issue-30340-research.md      # Research report (Phase 1, deleted after Phase 2)
├── issue-30340-analysis.md      # Analysis report (Phase 2)
├── issue-30340-evaluation.md    # Evaluation report (Phase 3)
└── logs/
    └── issue-30340-*.log         # Detailed logs

cli/ (Tool directory)
├── PHASE1_RESEARCH_PROMPT_EN.md          # Phase 1: Research prompt
├── PHASE2_SOLUTION_PROMPT_EN.md          # Phase 2: Solution prompt (CODE_CHANGE)
├── PHASE2_GUIDANCE_PROMPT_EN.md          # Phase 2: Guidance prompt (GUIDANCE)
└── MANUAL_EVALUATION_PROMPT_EN.md        # Phase 3: Evaluation prompt
```

## Examples

### Example 1: Process Single Issue

```bash
$ ai-issue solve 30340

🚀 AI Issue Solver
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Processing Issue #30340

🔧 Phase 1: Solve Issue

[Copilot executing...]

✅ Analysis report generated
ℹ️  File: /path/to/issue-30340-analysis.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Phase 2: Evaluate Solution

[Copilot executing...]

✅ Evaluation report generated
ℹ️  File: /path/to/issue-30340-evaluation.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Issue #30340 processing completed!
```

### Example 2: Batch Processing

```bash
$ ai-issue batch 30340 31316 31500

📦 Batch Processing Mode
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Total 3 Issues to process

[1/3] Processing Issue #30340
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Processing...]

✅ Issue #30340 processed successfully

[2/3] Processing Issue #31316
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Processing...]

✅ Issue #31316 processed successfully

[3/3] Processing Issue #31500
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Processing...]

✅ Issue #31500 processed successfully

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Batch Processing Statistics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Total: 3
Success: 3
Failed: 0
```

### Example 3: Configuration Management

```bash
$ ai-issue config show

⚙️  Current Configuration
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

repoPath: /Users/user/Work/terraform-provider-azurerm
reportPath: /Users/user/Work/AI_Issue_Experiment
model: claude-sonnet-4.5
logLevel: info
issueBaseUrl: https://github.com/hashicorp/terraform-provider-azurerm/issues

ℹ️  Config file: /Users/user/.ai-issue/config.json
```

## Troubleshooting

### 1. Copilot CLI version too old

```bash
npm update -g @github/copilot
ai-issue check
```

### 2. Configuration file corrupted

```bash
ai-issue config reset
ai-issue config set repoPath /your/path
```

### 3. Analysis report not generated

Check logs:
```bash
cat ~/Work/AI_Issue_Experiment/logs/issue-*-*.log
```

### 4. Git operations failed

```bash
cd /path/to/repo
git status
git checkout main
```

## Development

### Project Structure

```
cli/
├── ai-issue.js                           # Main entry point
├── package.json                          # npm configuration
├── install.sh                            # Installation script
├── lib/                                  # Library modules
│   ├── config.js                        # Configuration management
│   ├── logger.js                        # Logging utilities
│   ├── environment.js                   # Environment checks
│   ├── copilot.js                       # Copilot executor
│   ├── help.js                          # Help text
│   └── commands/                        # Command implementations
│       ├── solve.js                     # solve command
│       ├── evaluate.js                  # evaluate command
│       ├── batch.js                     # batch command
│       ├── config-cmd.js                # config command
│       └── check.js                     # check command
├── PHASE1_RESEARCH_PROMPT_EN.md          # Phase 1: Research prompt
├── PHASE2_SOLUTION_PROMPT_EN.md          # Phase 2: Solution prompt
├── PHASE2_GUIDANCE_PROMPT_EN.md          # Phase 2: Guidance prompt (NEW)
├── MANUAL_EVALUATION_PROMPT_EN.md        # Evaluation prompt
├── README.md                             # Complete documentation
├── QUICKSTART.md                         # Quick start guide
└── STRUCTURE.md                          # Project structure doc
```

### Local Development

```bash
# Clone code
cd cli/

# Link globally
npm link

# Changes take effect immediately
vi ai-issue.js

# Test
ai-issue check
```

### Uninstall

```bash
# Global installation
npm uninstall -g ai-issue-cli

# npm link method
npm unlink -g ai-issue-cli
```

## Advanced Usage

### Custom Prompts

Prompt file locations (built-in with CLI):
- Phase 1 Research: `PHASE1_RESEARCH_PROMPT_EN.md`
- Phase 2 Solution (CODE_CHANGE): `PHASE2_SOLUTION_PROMPT_EN.md`
- Phase 2 Guidance (GUIDANCE): `PHASE2_GUIDANCE_PROMPT_EN.md`
- Evaluation: `MANUAL_EVALUATION_PROMPT_EN.md`

Issue types are automatically detected from Phase 1 research:
- 🔧 **CODE_CHANGE**: Bug fixes, missing features, validation issues
- 📖 **GUIDANCE**: User configuration errors, expected behavior, version upgrades

These files are distributed with the tool, no additional configuration needed.

### Debug Mode

```bash
# Enable debug logging
ai-issue solve 30340 --model claude-sonnet-4.5
export DEBUG=1

# View detailed logs
ai-issue config set logLevel debug
```

### Integration with Other Tools

```bash
# Use in scripts
for issue in 30340 31316 31500; do
    ai-issue solve $issue --no-eval || echo "Issue $issue failed"
done

# Combine with jq to process GitHub API
gh api repos/owner/repo/issues | jq '.[].number' | xargs ai-issue batch
```


## Acknowledgments

- GitHub Copilot
- Terraform Provider AzureRM
