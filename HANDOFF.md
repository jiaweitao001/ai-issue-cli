# 交接说明 (Handoff Notes)

> ⚠️ **原维护者 (`jiaweitao`) 于 2026-06-04 离职。** 这是接手人应该最先阅读的文档，会指向其它正确的入口并标注尚未完成的工作。

---

## 这是什么项目

`ai-issue-cli` 是一个 Node.js 命令行工具，使用可插拔的 **agent 后端**（默认 GitHub Copilot CLI，也支持 Anthropic Claude Code CLI）自动化解决 GitHub Issue。两阶段流程：Phase 1 深度调研 issue，Phase 2 实现方案（或给出指导）。可选的 Phase 3 会对照参考 PR 评估方案。

CLI 可以选择性地与 `ai-issue-service`（独立的 FastAPI 后端）集成，用于 pipeline 管理、triage、以及通过 Trello 看板共享团队知识。它还自带一个离线的**本地知识库**模块 (`lib/local-knowledge-base.js` + `ai-issue kb` 命令)，让社区贡献者 / 离线运行也能用到相似 issue 检索。

---

## 从哪里开始读（按顺序）

1. **`README.md`** — 安装、基础用法、配置
2. **`QUICKSTART.md`** — 5 分钟跑通第一个 issue 的入门流程
3. **`CLAUDE.md`** — 给 AI agent 看的项目说明，但人类阅读也是了解架构最快的方式（命令流、模块职责、约定）。**强烈推荐先看这个再看代码。**
4. **`docs/TASK_TRACKING.md`** — 当前任务看板，记录了所有 in-flight / pending 任务，按优先级排序
5. **`docs/` 目录** — 25+ 篇 Phase 设计文档（中文），按时间顺序记录了每一次较大演进。重点：
   - `docs/PHASE5_SPEC.md` / `docs/PHASE5B_SPEC.md` — 多 agent 支持（Copilot → Claude Code → 未来 Gemini/Codex）
   - `docs/PHASE5C_SPEC.md` — 本地知识库 (KB) 的设计 + 上线流程
   - `docs/RUBBER_DUCK_CRITIQUE_PROPOSAL.md` — Phase 2 后强制运行的 rubber-duck 质量门

---

## 尚未完成的工作

直接以 `docs/TASK_TRACKING.md` 为准；下面只列出离职时仍挂着的几个最高优先级项目：

| # | 项目 | 状态 | 在哪里接手 |
|---|------|------|------------|
| 1 | **本地知识库 quality gate** | 第一个 KB tarball 已发布但 `manifest.qualityGate === 'pending'`；需要跑 `scripts/eval/kb-quality-eval.js` 拿到 Recall@3 ≥ 0.6, MRR@5 ≥ 0.4 之后把 gate 升到 `'passed'`，CLI 才会真正启用社区 KB | gate 函数在 `lib/local-knowledge-base.js` 的 `shouldPreferLocal()`；评估脚本在 `scripts/eval/kb-quality-eval.js`，ground truth fixtures 在 `scripts/eval/fixtures/`；设计 + 验收清单见 `docs/PHASE5C_SPEC.md` 和 `docs/TASK_TRACKING.md` |
| 2 | **`manager_api_key` 轮换** | Open since 2026-05-09（明文出现在部署日志中） | 完整步骤在 `docs/SUB_ROTATION.md` §7。这是 P1 级别，不需要任何外部审批，建议接手第一周内完成 |
| 3 | **TUI UX 手动验收** | v0.10.0 已 tag、PR #56-#67 全 merged，等按 10 节清单手动跑 | `docs/TUI_MANUAL_ACCEPTANCE.md` |
| 4 | **新 agent 接入路线图** | Copilot + Claude Code 已经在生产；下一个是 **Gemini CLI**，再下一个是 **Codex CLI** | `lib/agents/index.js` 的 `REGISTRY`；接入步骤见 `docs/PHASE5_SPEC.md` §3.1；fake-binary 集成测试模板见 `tests/integration/claude-fake-binary.test.js` |
| 5 | **服务端依赖** | CLI 默认离线工作；若开启了服务端 (`AI_ISSUE_SERVICE_URL`)，请同步阅读 `ai-issue-service` 的 `HANDOFF.md` 和 `docs/CORP_TENANT_MIGRATION_RUNBOOK.md`，因为后端正在筹备从 sub-B 迁到 Corp tenant | `lib/service-client.js` 是唯一 HTTP 入口 |

写这个文档时**没有开放中的 PR**。本地有 ~24 个陈旧 branch（`feature/bs-01-verify-loop` 等），可以放心删除；它们都已合并或被弃用。

---

## 关键约定（不写文档很难发现）

这些是 `CLAUDE.md` 里也提到的，但单独再列一次，因为它们最容易踩坑：

| 类别 | 约定 |
|------|------|
| **文档语言** | `docs/` 下所有文档**必须用简体中文**写（包括新增和重大改写）。顶层 `README.md` / `CLAUDE.md` / `QUICKSTART.md` 是英文，保持不变即可。 |
| **`docs/` 不入 git** | `docs/` 是内部任务追踪和设计文档，**不允许** `git add docs/`、不允许 push。原维护者多次强调。如果你想分享某篇 doc，先讨论是否应该升级成 `README.md` 的链接。 |
| **PR 流程** | **永远开 PR，不要直接 push `main`，必须等 review 之后合并。** 原维护者的个人审查要求转交给接手人 / 团队继续执行。 |
| **Commit trailer** | 每个 commit 末尾加 `Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>`，除非用户明确说不要。 |
| **CommonJS only** | 全部用 `require` / `module.exports`，不要 ES modules。Chalk 锁在 v4。 |
| **类型检查** | `// @ts-check` + JSDoc。`npm run typecheck`（tsc --noEmit）。`tsconfig.json` 里 `checkJs:false`，只有显式 opt-in 的文件被检查。 |
| **MCP skills 安装** | 每次 `npm ci` 之后必须跑 `npm run skills:install`，否则 tsc / Jest 找不到 `@modelcontextprotocol/sdk/...`。CI 已经这样做。 |
| **Logger mock** | 所有 import `lib/logger` 的测试都必须用 `mockCreateLogger` helper（变量名必须以 `mock` 开头，否则 Jest hoist 会报错）。见 `tests/helpers/mock-logger.js`。 |

---

## Agent / Model 选择策略

| Task type | 来源 | 默认 |
|-----------|------|------|
| `research`, `solution`, `verify_fix`, `evaluation`, `kb_*` | `--agent` CLI 参数 → `config.agent` | `copilot` |
| `rubber_duck_critique`, `rubber_duck_fix` | `config.rubberDuckAgent` → `config.agent` | `copilot` |
| `auto_review` | **硬编码** in `lib/agents/index.js::selectAgentForTask` | **始终是 `copilot`**（Terraform AI review tool 要求） |

Model 解析顺序：`--model` (CLI 参数) → `config.agents.<agent>.model` → **仅 `copilot` 才回退到 `config.model`** → agent 的内置默认值（见 `lib/agents/model-resolver.js` 的 `DEFAULT_MODELS`，例如 `claude-code` 默认 `sonnet`）。

新增 agent 时需要同时修改三处：`lib/agents/index.js` 的 `REGISTRY`、`lib/config.js` 的 `SUPPORTED_AGENTS`、以及 `lib/commands/config-cmd.js` 的 `SUPPORTED_AGENTS`。

---

## 命令速查

```bash
npm test                              # Jest 全部测试
npm run typecheck                     # tsc --noEmit（只检查 @ts-check 文件）
npm run skills:install                # 安装所有 MCP skill 子包（npm ci 之后必跑）
npm run smoke:claude-mcp              # 可选：真实 Claude + MCP 烟测（需要 AI_ISSUE_REAL_CLAUDE_SMOKE=1）
npx jest tests/copilot.test.js        # 跑单个测试文件
npx jest --testPathPattern=solve      # 按模式跑
```

没有 build 步骤，也没有 lint。

---

## 相关仓库

- **`ai-issue-service`** — FastAPI 后端 (`https://github.com/jiaweitao001/ai-issue-service`)。请同步阅读那边的 `HANDOFF.md`，尤其是 `docs/CORP_TENANT_MIGRATION_RUNBOOK.md`。
