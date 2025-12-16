# 🚀 Quick Start Guide

## 1. Installation

```bash
cd /Users/jiaweitao/Downloads/AI_Issue_Experiment/cli
./install.sh
```

Choose **Option 2 (Local Link)** for development mode installation.

## 2. Configuration

```bash
# Configuration has automatically detected default paths, but you can verify:
ai-issue config show

# If you need to modify:
ai-issue config set repoPath /Users/jiaweitao/Work/terraform-provider-azurerm
ai-issue config set reportPath /Users/jiaweitao/Work/AI_Issue_Experiment
```

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
# Core commands
ai-issue solve <number>      # Solve Issue (includes evaluation)
ai-issue evaluate <number>   # Evaluate separately
ai-issue batch <n1> <n2>     # Batch processing

# Management commands
ai-issue config show         # View configuration
ai-issue config set <k> <v>  # Set configuration
ai-issue check               # Environment check
ai-issue help                # Help information
```

## 6. FAQ

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

### Q: Where are the generated files?
```bash
# Analysis report
~/Work/AI_Issue_Experiment/issue-30340-analysis.md

# Evaluation report
~/Work/AI_Issue_Experiment/issue-30340-evaluation.md

# Logs
~/Work/AI_Issue_Experiment/logs/

# Prompt files (built-in cli directory)
cli/AI_Issue_Resolution_Experiment.md
cli/MANUAL_EVALUATION_PROMPT.md
```

### Q: How to uninstall?
```bash
npm unlink -g ai-issue-cli
```

## 7. Advanced Usage

### Batch process Issues from file
```bash
# Create issues.txt
echo "30340" > issues.txt
echo "31316" >> issues.txt
echo "31500" >> issues.txt

# Batch process
cat issues.txt | xargs ai-issue batch
```

### Combine with GitHub CLI
```bash
# Get latest open Issues and process
gh issue list --limit 5 --json number --jq '.[].number' | xargs ai-issue batch
```

## 8. Directory Structure

```
cli/
├── ai-issue.js                           # Main program (executable)
├── package.json                          # npm configuration
├── install.sh                            # Installation script (executable)
├── AI_Issue_Resolution_Experiment.md     # Issue resolution prompt
├── MANUAL_EVALUATION_PROMPT.md           # Evaluation prompt
├── README.md                             # Complete documentation
├── QUICKSTART.md                         # This file
└── DEMO.md                               # Demo documentation
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
