# 项目结构说明

原来的 `ai-issue.js` 文件（718行）已被拆分为多个模块化文件，提高了代码的可维护性和可读性。

## 新的文件结构

```
ai-issue-cli/
├── ai-issue.js              # 主入口文件（精简版，只负责路由）
├── package.json             # 项目配置
├── lib/                     # 库文件目录
│   ├── config.js           # 配置管理（加载/保存配置）
│   ├── logger.js           # 日志工具（颜色输出）
│   ├── environment.js      # 环境检查
│   ├── copilot.js          # Copilot执行器
│   └── commands/           # 命令实现目录
│       ├── init.js         # init命令（初始化配置）
│       ├── solve.js        # solve命令（两阶段解决方案）
│       ├── evaluate.js     # evaluate命令
│       ├── batch.js        # batch命令（批处理）
│       ├── config-cmd.js   # config命令
│       └── check.js        # check命令
├── PHASE1_RESEARCH_PROMPT.md        # 阶段1调研prompt（中文）
├── PHASE1_RESEARCH_PROMPT_EN.md     # 阶段1调研prompt（英文）★ 代码使用
├── PHASE2_SOLUTION_PROMPT.md        # 阶段2解决方案prompt（中文）
├── PHASE2_SOLUTION_PROMPT_EN.md     # 阶段2解决方案prompt（英文）★ 代码使用
├── PHASE2_GUIDANCE_PROMPT.md        # 阶段2指导解释prompt（中文）- GUIDANCE类型
├── PHASE2_GUIDANCE_PROMPT_EN.md     # 阶段2指导解释prompt（英文）★ 代码使用
├── MANUAL_EVALUATION_PROMPT.md      # 评估prompt（中文）
└── MANUAL_EVALUATION_PROMPT_EN.md   # 评估prompt（英文）★ 代码使用
```

## 模块说明

### 核心模块

- **ai-issue.js** (主入口)
  - 解析命令行参数
  - 路由到相应的命令处理器
  - 处理错误和异常

- **lib/config.js**
  - 管理配置文件
  - 加载和保存用户配置
  - 提供默认配置

- **lib/logger.js**
  - 统一的日志输出
  - 颜色支持（成功、错误、警告、信息）
  - 便于调试和用户反馈

- **lib/environment.js**
  - 环境检查功能
  - 验证必需的工具和文件
  - 提供修复建议

- **lib/copilot.js**
  - Copilot CLI 执行器
  - 处理进程spawn和错误
  - 统一的Copilot调用接口
  - 跨平台支持（Windows/Unix）

### 命令模块

- **lib/commands/init.js**
  - 初始化配置文件
  - 创建报告目录
  - 首次使用时的引导

- **lib/commands/solve.js**
  - 实现两阶段解决方案流程
  - Phase 1: 深度研究（输出问题分类：CODE_CHANGE/GUIDANCE）
  - Phase 2: 根据分类选择不同prompt
    - CODE_CHANGE → PHASE2_SOLUTION_PROMPT_EN.md
    - GUIDANCE → PHASE2_GUIDANCE_PROMPT_EN.md

- **lib/commands/evaluate.js**
  - 评估已解决的issue
  - 生成评估报告

- **lib/commands/batch.js**
  - 批量处理多个issue
  - 并发控制
  - 进度追踪

- **lib/commands/config-cmd.js**
  - 配置管理命令
  - show/set/get/reset操作

- **lib/commands/check.js**
  - 环境检查命令
  - 显示所有检查结果

## 优势

1. **模块化**: 每个文件职责单一，易于理解和维护
2. **可扩展**: 添加新命令只需在commands目录创建新文件
3. **可测试**: 每个模块可以独立测试
4. **可读性**: 代码组织清晰，易于新开发者理解
5. **可维护**: 修改某个功能只需关注对应的模块

## 功能完整性

✅ 所有原有功能都已保留
✅ 命令行接口完全兼容
✅ 配置系统保持一致
✅ 错误处理机制完整

## 使用方式

使用方式与之前完全相同：

```bash
ai-issue init
ai-issue solve 30340
ai-issue batch 30340 31316 31500 --concurrency 5
ai-issue config show
ai-issue check
```
