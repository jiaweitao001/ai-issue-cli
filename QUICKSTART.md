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

Trello Dashboard 让团队通过看板可视化 issue 处理流程，拖拽卡片完成审批。

#### 7.1 获取 Trello 凭据

1. 打开 https://trello.com/power-ups/admin → 创建 Power-Up → 记下 **API Key**
2. 浏览器访问（替换 YOUR_KEY）：
   ```
   https://trello.com/1/authorize?expiration=never&scope=read,write&response_type=token&key=YOUR_KEY
   ```
   授权后获得 **API Token**

#### 7.2 创建经理 Board

在 Trello 手动创建一个 Board，建 6 个 List（从左到右）：
- Triaged → Queued → Solving → Review → Approved → Rejected

记下 Board ID（Board URL 中的那串字符，如 `https://trello.com/b/BOARD_ID/...`）

#### 7.3 配置部署

```bash
# 生成加密密钥
python3 -c "import os,base64;print(base64.urlsafe_b64encode(os.urandom(32)).decode())"

# 在 terraform.tfvars 中添加
trello_api_key          = "你的 API Key"
trello_api_token        = "你的 Token"
trello_manager_board_id = "经理 Board ID"
trello_webhook_secret   = "任意随机字符串"
encryption_key          = "上面生成的密钥"
fork_repo               = "your-org/terraform-provider-azurerm"

# 部署
cd infra && terraform apply
```

#### 7.4 注册工程师

每个工程师在本地执行一次：

```bash
# 注册 GitHub PAT（用于以你的身份创建 PR）
ai-issue register --pat ghp_xxxxxxxxxxxx

# 如果有 Trello member ID（可选）
ai-issue register --pat ghp_xxx --trello-member-id 5f8a...
```

注册后系统自动创建你的私有 Trello Board（只有你能看到）。

#### 7.5 日常使用

- **工程师**：打开你的私有 Board → 看到 Review 列中的 issue → 点 GitHub Compare 链接看 diff → 拖入 Approved 自动创建 PR
- **经理**：打开 Manager Board → 查看全局 → 给 Triaged 列的卡片 Add Member 后拖入 Queued 分配工程师

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
│   └── commands/                        #   Command handlers
│       ├── solve.js                     #     Two-phase resolve
│       ├── batch.js                     #     Parallel multi-issue processing
│       ├── evaluate.js                  #     Standalone evaluation
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
