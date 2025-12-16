# AI Issue CLI

> 🤖 AI-powered automated Issue resolution and evaluation tool

基于 GitHub Copilot CLI 的命令行工具，自动化解决和评估 GitHub Issues。

## 特性

- ✅ **完全自动化** - 一条命令完成 Issue 分析、代码修改、测试、评估
- ✅ **上下文隔离** - 解决和评估使用独立的 AI 会话
- ✅ **批量处理** - 支持同时处理多个 Issue
- ✅ **配置管理** - 灵活的配置系统
- ✅ **详细日志** - 完整的执行日志记录
- ✅ **专业 CLI** - 完整的命令行工具体验

## 安装

### 前置要求

- Node.js >= 14.0.0
- GitHub Copilot CLI >= 0.0.342
- GitHub Copilot 订阅

### 快速安装

```bash
# 1. 克隆或下载代码
cd /path/to/cli

# 2. 运行安装脚本
chmod +x install.sh
./install.sh

# 3. 选择安装方式
#    选项 1: 全局安装（推荐）
#    选项 2: 本地链接（开发模式）
```

### 手动安装

```bash
# 全局安装
npm install -g .

# 或者使用 npm link（开发模式）
npm link
```

### 安装 GitHub Copilot CLI

```bash
npm install -g @github/copilot
```

## 配置

### 首次使用

```bash
# 1. 检查环境
ai-issue check

# 2. 配置路径
ai-issue config set repoPath /path/to/your/repo
ai-issue config set reportPath /path/to/reports

# 3. 查看配置
ai-issue config show
```

### 配置项

| 配置项 | 说明 | 默认值 |
|--------|------|--------|
| `repoPath` | 代码仓库路径 | `~/Work/terraform-provider-azurerm` |
| `reportPath` | 报告输出路径 | `~/Work/AI_Issue_Experiment` |
| `model` | AI 模型 | `claude-sonnet-4.5` |
| `logLevel` | 日志级别 | `info` |
| `issueBaseUrl` | Issue URL 前缀 | GitHub URL |

### 环境变量

可以通过环境变量覆盖配置：

```bash
export AI_ISSUE_REPO_PATH="/path/to/repo"
export AI_ISSUE_REPORT_PATH="/path/to/reports"
export AI_ISSUE_MODEL="gpt-5"
export AI_ISSUE_LOG_LEVEL="debug"
```

## 使用方法

### 基本命令

```bash
# 解决单个 Issue
ai-issue solve 30340

# 仅解决，不评估
ai-issue solve 30340 --no-eval

# 单独评估已解决的 Issue
ai-issue evaluate 30340

# 批量处理
ai-issue batch 30340 31316 31500

# 指定 AI 模型
ai-issue solve 30340 --model gpt-5
```

### 配置管理

```bash
# 显示所有配置
ai-issue config show

# 设置配置项
ai-issue config set repoPath /new/path
ai-issue config set model gpt-5

# 获取配置项
ai-issue config get model

# 重置配置
ai-issue config reset
```

### 环境检查

```bash
# 检查环境配置
ai-issue check
```

### 其他命令

```bash
# 显示版本
ai-issue version

# 显示帮助
ai-issue help
```

## 工作流程

### 单个 Issue 处理流程

```
ai-issue solve 30340
        ↓
┌─────────────────────┐
│ Copilot Session 1   │
│ (解决 Issue)        │
├─────────────────────┤
│ • 获取 Issue 详情   │
│ • 分析代码          │
│ • 创建 Git 分支     │
│ • 修改代码          │
│ • 更新测试          │
│ • 更新文档          │
│ • 提交 commit       │
│ • 生成 analysis.md  │
└─────────────────────┘
        ↓
   等待完成
        ↓
┌─────────────────────┐
│ Copilot Session 2   │
│ (评估方案) 独立会话  │
├─────────────────────┤
│ • 读取 analysis.md  │
│ • 按标准评估        │
│ • 生成 evaluation.md│
└─────────────────────┘
        ↓
      完成！
```

## 输出文件

```
reportPath/
├── issue-30340-analysis.md      # 分析报告
├── issue-30340-evaluation.md    # 评估报告
└── logs/
    └── issue-30340-*.log         # 详细日志

cli/ (工具目录)
├── AI_Issue_Resolution_Experiment.md  # Issue 解决提示词（内置）
└── MANUAL_EVALUATION_PROMPT.md        # 评估提示词（内置）
```

## 示例

### 示例 1：处理单个 Issue

```bash
$ ai-issue solve 30340

🚀 AI Issue Solver
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  处理 Issue #30340

🔧 阶段 1: 解决 Issue

[Copilot 执行中...]

✅ 分析报告已生成
ℹ️  文件: /path/to/issue-30340-analysis.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 阶段 2: 评估方案

[Copilot 执行中...]

✅ 评估报告已生成
ℹ️  文件: /path/to/issue-30340-evaluation.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Issue #30340 处理完成！
```

### 示例 2：批量处理

```bash
$ ai-issue batch 30340 31316 31500

📦 批量处理模式
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  共 3 个 Issue 待处理

[1/3] 处理 Issue #30340
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[处理中...]

✅ Issue #30340 处理成功

[2/3] 处理 Issue #31316
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[处理中...]

✅ Issue #31316 处理成功

[3/3] 处理 Issue #31500
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[处理中...]

✅ Issue #31500 处理成功

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 批处理完成统计
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

总计: 3 个
成功: 3 个
失败: 0 个
```

### 示例 3：配置管理

```bash
$ ai-issue config show

⚙️  当前配置
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

repoPath: /Users/user/Work/terraform-provider-azurerm
reportPath: /Users/user/Work/AI_Issue_Experiment
model: claude-sonnet-4.5
logLevel: info
issueBaseUrl: https://github.com/hashicorp/terraform-provider-azurerm/issues

ℹ️  配置文件: /Users/user/.ai-issue/config.json
```

## 故障排查

### 1. Copilot CLI 版本过低

```bash
npm update -g @github/copilot
ai-issue check
```

### 2. 配置文件损坏

```bash
ai-issue config reset
ai-issue config set repoPath /your/path
```

### 3. 分析报告未生成

检查日志：
```bash
cat ~/Work/AI_Issue_Experiment/logs/issue-*-*.log
```

### 4. Git 操作失败

```bash
cd /path/to/repo
git status
git checkout main
```

## 开发

### 项目结构

```
cli/
├── ai-issue.js                           # 主程序
├── package.json                          # npm 配置
├── install.sh                            # 安装脚本
├── AI_Issue_Resolution_Experiment.md     # Issue 解决提示词
├── MANUAL_EVALUATION_PROMPT.md           # 评估提示词
├── README.md                             # 完整文档
├── QUICKSTART.md                         # 快速开始指南
└── DEMO.md                               # 演示文档
```

### 本地开发

```bash
# 克隆代码
cd cli/

# 链接到全局
npm link

# 修改代码后立即生效
vi ai-issue.js

# 测试
ai-issue check
```

### 卸载

```bash
# 全局安装方式
npm uninstall -g ai-issue-cli

# npm link 方式
npm unlink -g ai-issue-cli
```

## 高级用法

### 自定义提示词

提示词文件位置（已内置在 cli 目录）：
- 解决 Issue: `cli/AI_Issue_Resolution_Experiment.md`
- 评估方案: `cli/MANUAL_EVALUATION_PROMPT.md`

这些文件随工具一起分发，无需额外配置。

### 调试模式

```bash
# 启用调试日志
ai-issue solve 30340 --model claude-sonnet-4.5
export DEBUG=1

# 查看详细日志
ai-issue config set logLevel debug
```

### 与其他工具集成

```bash
# 在脚本中使用
for issue in 30340 31316 31500; do
    ai-issue solve $issue --no-eval || echo "Issue $issue failed"
done

# 结合 jq 处理 GitHub API
gh api repos/owner/repo/issues | jq '.[].number' | xargs ai-issue batch
```

## 许可证

MIT

## 贡献

欢迎提交 Issue 和 Pull Request！

## 作者

Your Name

## 致谢

- GitHub Copilot
- Terraform Provider AzureRM
