# 🚀 Quick Start Guide

## What's New in v2.0

✨ **Two-Phase Resolution**:
- Phase 1: Deep Research (find similar implementations, SDK tools, code history)
- Phase 2: Solution Implementation (based on research findings)
- Result: ~60% accuracy improvement!

⚡ **Parallel Batch Processing**:
- Process multiple issues concurrently
- Configurable concurrency (default: 3)
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
ai-issue config set issueBaseUrl https://github.com/owner/repo/issues

# View configuration
ai-issue config show
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
# Core commands (v2.0)
ai-issue solve <number>           # Two-phase: Research → Solution → Evaluation
ai-issue evaluate <number>        # Evaluate separately
ai-issue batch <n1> <n2> ...      # Parallel batch processing (default: 3 concurrent)
ai-issue batch <n1> <n2> --concurrency 5  # Custom concurrency

# Management commands
ai-issue config show              # View configuration
ai-issue config set <k> <v>       # Set configuration
ai-issue check                    # Environment check
ai-issue help                     # Help information
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

### Q: How does parallel batch processing work?
```bash
# Default: 3 concurrent issues
ai-issue batch 30340 31316 31500

# Custom: 7 concurrent issues
ai-issue batch 30049 30340 30360 30384 30437 31120 31180 --concurrency 7

# View real-time progress
# Output shows: Progress: 3/7 | Active: #30049, #30340, #30360
```

### Q: Where are the generated files?
```bash
# Phase 1: Research report (temporary, deleted after Phase 2)
~/Work/AI_Issue_Experiment/issue-30340-research.md

# Phase 2: Analysis and solution report (final output)
~/Work/AI_Issue_Experiment/issue-30340-analysis-and-solution.md

# Phase 3: Evaluation report
~/Work/AI_Issue_Experiment/issue-30340-evaluation.md

# LoUnderstanding Two-Phase Approach

**Phase 1: Deep Research (141 lines prompt)**
- Find similar implementations in codebase
- Search for existing SDK tools
- Analyze code history with git
- Identify all affected locations
- Output: `issue-XXX-research.md`

**Phase 2: Solution Implementation (143 lines prompt)**
- Design solution based on research findings
- Follow similar implementations
- Use SDK functions (not reinvent)
- Ensure completeness (all CRUD operations)
- Output: `issue-XXX-analysis-and-solution.md`

**Why Two-Phase?**
- Prevents "quick fix" without understanding root cause
- Forces AI to find similar implementations first
- Uses shorter, focused prompts (was 617 lines total)
- ~60% accuracy improvement in testing

### Batch process Issues from file
```bash
# Create issues.txt
echo "30340" > issues.txt
echo "31316" >> issues.txt
echo "31500" >> issues.txt

# Batch process with custom concurrency
ai-issue batch $(cat issues.txt) --concurrency 5
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
├── ai-issue.js                           # Main program v2.0 (executable)
├── package.json                          # npm configuration
├── install.sh                            # Installation script (executable)
├── lib/                                  # Library modules
│   ├── config.js                        # Configuration management
│   ├── logger.js                        # Logging utilities
│   ├── environment.js                   # Environment checks
│   ├── copilot.js                       # Copilot executor
│   ├── help.js                          # Help text
│   └── commands/                        # Command implementations
│       ├── solve.js                     # solve command (two-phase)
│       ├── evaluate.js                  # evaluate command
│       ├── batch.js                     # batch command
│       ├── config-cmd.js                # config command
│       └── check.js                     # check command
├── PHASE1_RESEARCH_PROMPT_EN.md          # Phase 1: Research prompt (English) ★
├── PHASE2_SOLUTION_PROMPT_EN.md          # Phase 2: Solution prompt (English) ★
├── PHASE2_GUIDANCE_PROMPT_EN.md          # Phase 2: Guidance prompt (English) ★ NEW
├── MANUAL_EVALUATION_PROMPT_EN.md        # Phase 3: Evaluation prompt (English) ★
├── PHASE1_RESEARCH_PROMPT.md             # Phase 1: Research prompt (Chinese)
├── PHASE2_SOLUTION_PROMPT.md             # Phase 2: Solution prompt (Chinese)
├── PHASE2_GUIDANCE_PROMPT.md             # Phase 2: Guidance prompt (Chinese) NEW
├── MANUAL_EVALUATION_PROMPT.md           # Phase 3: Evaluation prompt (Chinese)
├── TWO_PHASE_APPROACH.md                 # Two-phase methodology doc
├── STRUCTURE.md                          # Project structure doc
├── README.md                             # Complete documentation
└── QUICKSTART.md                         # This file
```

★ = Used by code (English versions)

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
