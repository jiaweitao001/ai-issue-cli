# 两阶段提示方案说明

## 📋 概述

AI Issue CLI 现在采用**两阶段提示**方案，显著提升AI解决方案的准确性和质量。

### 🎯 核心理念

**分离关注点**：将"调研"和"解决"分为两个独立阶段，每个阶段有明确的目标和简洁的提示词。

## 🔄 工作流程

```
Issue #XXXX
    ↓
┌─────────────────────────────────────┐
│   Phase 1: Deep Research            │
│   📚 专注于信息收集和分析              │
│                                     │
│   输入：Issue描述                     │
│   输出：research report              │
│   ✓ 找相似实现                       │
│   ✓ 搜SDK工具                        │
│   ✓ 查代码历史                       │
│   ✓ 识别影响范围                     │
│   ✗ 不提出解决方案                   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│   Phase 2: Solution Implementation  │
│   🔧 基于调研设计和实施解决方案         │
│                                     │
│   输入：Phase 1 research report      │
│   输出：analysis report + code       │
│   ✓ 参考相似实现                     │
│   ✓ 复用SDK函数                      │
│   ✓ 全局一致修改                     │
│   ✓ 治本不治标                       │
│   ✓ 创建分支和提交                   │
└─────────────────────────────────────┘
    ↓
┌─────────────────────────────────────┐
│   Phase 3: Evaluation (Optional)    │
│   📊 评估方案质量                     │
└─────────────────────────────────────┘
```

## 📁 文件结构

```
ai-issue-cli/
├── PHASE1_RESEARCH_PROMPT.md       # 阶段1提示词（调研）
├── PHASE2_SOLUTION_PROMPT.md       # 阶段2提示词（解决）
├── MANUAL_EVALUATION_PROMPT.md     # 阶段3提示词（评估）
├── ai-issue.js                     # CLI工具（实现两阶段流程）
└── TWO_PHASE_APPROACH.md          # 本文件
```

### 输出文件

每个Issue处理后会生成：

```
AI_Issue_Experiment/
├── issue-XXXX-research.md    # 阶段1：调研报告
├── issue-XXXX-analysis-and-solution.md    # 阶段2：分析与解决方案报告
└── issue-XXXX-evaluation.md  # 阶段3：评估报告
```

## 🎯 两阶段方案的优势

### 1. **提示词简洁高效**

| 方案 | 提示词总长度 | AI注意力 | Token效率 |
|------|-------------|----------|-----------|
| 单阶段 | ~800行 | 分散 | 低 |
| 两阶段 | Phase1: ~300行<br>Phase2: ~300行 | 集中 | 高 |

**优势**：
- ✅ 每个阶段的提示词更短，AI更容易理解和执行
- ✅ 避免"Lost in the Middle"现象
- ✅ 每次API调用成本更低

### 2. **明确的职责分离**

**Phase 1: 调研专家**
- 🎯 目标：收集信息，不下结论
- 🚫 禁止：提出解决方案
- ✅ 输出：结构化的调研数据

**Phase 2: 解决专家**
- 🎯 目标：基于调研设计最佳方案
- 📊 依据：Phase 1的发现
- ✅ 输出：完整的实现方案

### 3. **强制深度调研**

单阶段问题：
```
AI: 看到Issue → 快速形成假设 → 立即编码 → 可能误判根因
```

两阶段优势：
```
Phase 1: 看到Issue → 全面调研 → 收集证据 → 输出报告
         ↓
Phase 2: 读取调研 → 基于证据思考 → 选择最佳方案 → 精准实施
```

### 4. **质量检查清单**

每个阶段都有**强制检查清单**：

**Phase 1必须完成：**
- [ ] 找到至少1个相似实现
- [ ] 搜索了SDK工具函数
- [ ] 查看了git历史
- [ ] 识别了所有影响位置

**Phase 2必须完成：**
- [ ] 参考了调研中的相似实现
- [ ] 使用了SDK现有函数（如果有）
- [ ] 检查了所有CRUD操作
- [ ] 更新了测试文件
- [ ] 创建了git分支并提交

### 5. **可追溯的决策过程**

生成三个独立文件：
1. `research.md` - 为什么这样分析
2. `analysis-and-solution.md` - 为什么这样解决
3. `evaluation.md` - 质量如何

可以清晰看到AI的思考过程！

## 🚀 使用方法

### 基本用法

```bash
# 自动执行两阶段
ai-issue solve 30340

# 只执行solve，不评估
ai-issue solve 30340 --no-eval

# 批量处理
ai-issue batch 30340 31316 31500
```

### 执行过程

```
🚀 AI Issue Solver (Two-Phase Approach)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Processing Issue #30340

📚 Phase 1: Deep Research
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Conducting comprehensive technical research...
[Copilot执行Phase 1...]
✅ Research report generated
ℹ️  File: issue-30340-research.md

🔧 Phase 2: Solution Implementation
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️  Designing and implementing solution based on research...
[Copilot执行Phase 2...]
✅ Analysis and solution report generated
ℹ️  File: issue-30340-analysis-and-solution.md

📊 Phase 3: Evaluate Solution
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

[Copilot执行评估...]
✅ Evaluation report generated
ℹ️  File: issue-30340-evaluation.md

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ Issue #30340 processing completed!
```

## 📊 预期效果提升

基于评估报告分析，两阶段方案预期能解决的核心问题：

### 问题1: 根本原因定位错误
**之前**: AI看到"超时"就增加超时时间 (治标)
**现在**: Phase 1强制查找相似实现，发现某个过滤器有问题，Phase 2直接移除过滤器 (治本)

### 问题2: 参考选择不当
**之前**: 随机找个看起来相关的文件参考
**现在**: Phase 1系统化搜索同目录相似资源，对比差异

### 问题3: 未使用SDK现有功能
**之前**: 自己写复杂正则
**现在**: Phase 1强制搜索SDK函数，Phase 2必须使用找到的工具

### 问题4: 修改范围不完整
**之前**: 只改Update函数
**现在**: Phase 1识别所有CRUD操作，Phase 2全部同步修改

### 问题5: 忽略历史和上下文
**之前**: 不知道问题何时引入
**现在**: Phase 1用git log查找相关commits，理解演进路径

## 🎯 评分预期

| 评估维度 | 单阶段平均分 | 两阶段预期分 | 提升 |
|---------|-------------|-------------|-----|
| 核心思路 | 2.0/5 | 4.0/5 | +100% |
| 功能等价性 | 2.3/5 | 4.2/5 | +83% |
| 实现方式 | 2.5/5 | 4.0/5 | +60% |
| 完整性 | 3.0/5 | 4.5/5 | +50% |
| 代码质量 | 3.3/5 | 4.3/5 | +30% |
| **总分** | **2.5/5** | **4.2/5** | **+68%** |

**目标**：从Reject区间(0-3.4)进入Accept区间(4.5-5.0)

## 🔧 技术实现细节

### 流程控制

```javascript
async function cmdSolve(issueNumber) {
  // Phase 1: Research
  const phase1Prompt = loadPrompt('PHASE1_RESEARCH_PROMPT.md');
  await runCopilot(phase1Prompt + issueContext);
  
  // 等待research report生成
  const researchReport = readFile(`issue-${issueNumber}-research.md`);
  
  // Phase 2: Solution  
  const phase2Prompt = loadPrompt('PHASE2_SOLUTION_PROMPT.md');
  await runCopilot(phase2Prompt + researchReport);
  
  // Phase 3: Evaluation (optional)
  if (!options.noEval) {
    const evalPrompt = loadPrompt('MANUAL_EVALUATION_PROMPT.md');
    const analysisReport = readFile(`issue-${issueNumber}-analysis-and-solution.md`);
    await runCopilot(evalPrompt + analysisReport);
  }
}
```

### 并发控制

批量处理时，每个Issue都独立执行两阶段：

```javascript
async function processBatch(issues) {
  const concurrency = 3;
  const queue = [...issues];
  
  while (queue.length > 0) {
    const issue = queue.shift();
    await cmdSolve(issue); // 完整的两阶段
  }
}
```

## 📝 提示词设计原则

### Phase 1: Research
- **长度**: ~300行
- **风格**: 清单式、强制性
- **重点**: 
  - ⭐⭐⭐ 相似实现查找
  - ⭐⭐ SDK工具搜索
  - ⭐ 历史分析
- **禁止**: 提出解决方案

### Phase 2: Solution
- **长度**: ~300行
- **风格**: 指导式、质量标准
- **输入**: Phase 1的完整report
- **重点**:
  - 🎯 治本不治标
  - 📚 参考优先于发明
  - 🌐 全局一致性
  - ✅ 质量自评

### Phase 3: Evaluation
- **长度**: ~200行 (保持不变)
- **输入**: Phase 2的完整report

## 🔬 实验验证

### 测试计划

使用已评估的7个Issues重新运行：

| Issue | 原始得分 | 主要问题 | 两阶段预期改进 |
|-------|---------|---------|---------------|
| 31180 | 1.90 | 误判根因(轮询vs过滤器) | Phase 1会找到pim_active无此问题 |
| 30384 | 1.95 | 修改不完整 | Phase 1会识别所有位置 |
| 30437 | 3.43 | 自己写正则 | Phase 1会找到SDK函数 |
| 30049 | N/A | 虚构commit | Phase 1会确认issue状态 |
| 31120 | 5.00 | 完美 | 保持 |
| 30340 | 5.00 | 完美 | 保持 |
| 30360 | N/A | 待测试 | - |

### 验证命令

```bash
# 单个测试
ai-issue solve 31180

# 批量测试
ai-issue batch 31180 30384 30437 30049 31120 30340 30360

# 对比结果
diff issue-31180-analysis-and-solution.md issue-31180-analysis-and-solution-v2.md
```

## 🎓 最佳实践

### 编写Phase 1提示词
1. ✅ 使用清单式格式（容易检查）
2. ✅ 强制执行关键步骤（相似实现、SDK搜索）
3. ✅ 明确禁止提出解决方案
4. ✅ 要求结构化输出

### 编写Phase 2提示词
1. ✅ 明确引用Phase 1的发现
2. ✅ 强调"参考优先于发明"
3. ✅ 包含质量自评清单
4. ✅ 标注常见错误和成功要诀

### 调试技巧

如果效果不好：

1. **检查Phase 1输出质量**
   - research report是否找到了相似实现？
   - 是否搜索了SDK函数？
   - 是否完成了所有检查清单？

2. **检查Phase 2是否使用了Phase 1发现**
   - analysis report中是否引用了相似实现？
   - 是否使用了Phase 1找到的SDK函数？
   - 是否基于调研做决策？

3. **如果Phase 1调研不足**
   - 增强Phase 1的强制性指令
   - 简化搜索关键词
   - 提供更多示例

4. **如果Phase 2未遵循调研**
   - 在Phase 2提示词中更强调"必须使用Phase 1发现"
   - 增加质量检查清单
   - 明确指出常见错误

## 🚀 未来优化

### 短期（v2.1）
- [ ] 添加Phase 1和Phase 2之间的人工检查点（可选）
- [ ] research report质量自动评分
- [ ] 如果Phase 1质量不足，重试

### 中期（v2.5）
- [ ] 支持自定义提示词模板
- [ ] 统计两阶段vs单阶段的效果对比
- [ ] 优化Phase 1的搜索策略

### 长期（v3.0）
- [ ] Phase 1使用专门的"调研模型"
- [ ] Phase 2使用专门的"编码模型"
- [ ] 自适应提示词（根据历史效果调整）

## 📚 相关文档

- [PHASE1_RESEARCH_PROMPT.md](PHASE1_RESEARCH_PROMPT.md) - 阶段1提示词
- [PHASE2_SOLUTION_PROMPT.md](PHASE2_SOLUTION_PROMPT.md) - 阶段2提示词
- [MANUAL_EVALUATION_PROMPT.md](MANUAL_EVALUATION_PROMPT.md) - 评估提示词
- [QUICKSTART.md](QUICKSTART.md) - 快速开始指南

## 🤝 反馈

如果你发现两阶段方案的问题或有改进建议，请：
1. 记录具体的Issue编号和问题
2. 对比research report和analysis report
3. 分析是Phase 1还是Phase 2的问题
4. 提出具体的提示词改进建议
