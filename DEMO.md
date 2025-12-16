# AI Issue CLI - 安装和使用演示

## 演示脚本

### 场景 1：全新安装

```bash
# 1. 进入 CLI 目录
cd /Users/jiaweitao/Downloads/AI_Issue_Experiment/cli

# 2. 运行安装脚本
./install.sh
# 选择: 2 (本地链接，用于开发)

# 3. 验证安装
ai-issue --version
# 输出: ai-issue v1.0.0

# 4. 查看帮助
ai-issue help
```

### 场景 2：首次配置

```bash
# 1. 检查环境
ai-issue check

# 2. 查看当前配置
ai-issue config show

# 3. 修改配置（如果需要）
ai-issue config set model claude-sonnet-4.5
ai-issue config set logLevel info

# 4. 再次检查
ai-issue check
```

### 场景 3：解决单个 Issue

```bash
# 完整流程（解决 + 评估）
ai-issue solve 30340

# 期待输出：
# 🚀 AI Issue Solver
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ℹ️  处理 Issue #30340
# 
# 🔧 阶段 1: 解决 Issue
# [Copilot 执行中...]
# ✅ 分析报告已生成
# 
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📊 阶段 2: 评估方案
# [Copilot 执行中...]
# ✅ 评估报告已生成
# 
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ✅ Issue #30340 处理完成！
```

### 场景 4：仅解决不评估

```bash
# 只解决，不评估
ai-issue solve 31316 --no-eval

# 稍后单独评估
ai-issue evaluate 31316
```

### 场景 5：批量处理

```bash
# 方式 1：直接传参
ai-issue batch 30340 31316 31500

# 方式 2：从文件读取
echo "30340\n31316\n31500" > issues.txt
cat issues.txt | xargs ai-issue batch

# 期待输出：
# 📦 批量处理模式
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# ℹ️  共 3 个 Issue 待处理
# 
# [1/3] 处理 Issue #30340
# [处理中...]
# ✅ Issue #30340 处理成功
# 
# [2/3] 处理 Issue #31316
# [处理中...]
# ✅ Issue #31316 处理成功
# 
# [3/3] 处理 Issue #31500
# [处理中...]
# ✅ Issue #31500 处理成功
# 
# ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
# 📊 批处理完成统计
# 总计: 3 个
# 成功: 3 个
# 失败: 0 个
```

### 场景 6：查看生成的文件

```bash
# 进入报告目录
cd ~/Downloads/AI_Issue_Experiment

# 查看分析报告
cat issue-30340-analysis.md | head -50

# 查看评估报告
cat issue-30340-evaluation.md | head -50

# 查看日志
ls -lh logs/
tail -100 logs/issue-30340-*.log
```

### 场景 7：Git 验证

```bash
# 进入仓库
cd ~/Work/terraform-provider-azurerm

# 查看创建的分支
git branch | grep issue-

# 查看特定分支
git log issue-30340 --oneline -5

# 查看变更
git show issue-30340
```

### 场景 8：配置管理

```bash
# 显示所有配置
ai-issue config show

# 设置单个配置
ai-issue config set model gpt-5

# 获取单个配置
ai-issue config get model

# 重置配置
ai-issue config reset

# 查看配置文件位置
cat ~/.ai-issue/config.json
```

### 场景 9：故障排查

```bash
# 检查环境
ai-issue check

# 启用调试日志
ai-issue config set logLevel debug

# 重新运行
ai-issue solve 30340

# 查看详细日志
cat ~/Downloads/AI_Issue_Experiment/logs/issue-30340-*.log
```

### 场景 10：高级用法

```bash
# 结合 jq 处理 JSON
gh api repos/hashicorp/terraform-provider-azurerm/issues \
  | jq '.[] | select(.state=="open") | .number' \
  | head -5 \
  | xargs ai-issue batch

# 条件执行
ai-issue solve 30340 && echo "成功" || echo "失败"

# 并行处理（谨慎使用）
for issue in 30340 31316 31500; do
    ai-issue solve $issue &
done
wait

# 自动化脚本
cat << 'EOF' > auto_solve.sh
#!/bin/bash
for issue in "$@"; do
    echo "处理 Issue #$issue"
    ai-issue solve $issue || echo "Issue #$issue 失败"
    sleep 10
done
EOF
chmod +x auto_solve.sh
./auto_solve.sh 30340 31316 31500
```

## 演示检查清单

- [ ] 安装成功
- [ ] `ai-issue --version` 显示版本号
- [ ] `ai-issue check` 所有项通过
- [ ] `ai-issue config show` 显示正确配置
- [ ] `ai-issue solve` 成功解决一个 Issue
- [ ] 分析报告已生成
- [ ] 评估报告已生成
- [ ] Git 分支已创建
- [ ] Commit 已提交
- [ ] `ai-issue batch` 成功批量处理
- [ ] 日志文件存在

## 性能指标

| 操作 | 预计耗时 |
|------|----------|
| 解决单个 Issue | 3-10 分钟 |
| 评估方案 | 1-3 分钟 |
| 批量处理 3 个 | 15-30 分钟 |
| 环境检查 | < 5 秒 |
| 配置操作 | < 1 秒 |

## 常见输出示例

### 成功输出
```
✅ 分析报告已生成
✅ 评估报告已生成
✅ Issue #30340 处理完成！
```

### 错误输出
```
❌ 分析报告未生成
❌ 配置文件不存在: /path/to/file
❌ Copilot 退出码: 1
```

### 警告输出
```
⚠️  GitHub Copilot CLI 未安装
⚠️  评估报告可能未自动生成
```

### 信息输出
```
ℹ️  处理 Issue #30340
ℹ️  文件: /path/to/analysis.md
ℹ️  配置文件: ~/.ai-issue/config.json
```
