# AI Issue 项目任务追踪

**最后更新：** 2026-04-17

---

## 一、Phase 总览

| 阶段 | 任务 | 仓库 | 设计 | 代码 | 测试 | 部署 | 待办 |
|------|------|------|:----:|:----:|:----:|:----:|------|
| **Phase 1** | 相似 Issue 向量检索 | service | ✅ | ✅ | ✅ | ✅ | — |
| **Phase 1** | similar-issue-finder MCP skill | cli | ✅ | ✅ | ✅ | ✅ | — |
| **Phase 2** | 知识库扫描（merged PR → knowledge） | service | ✅ | ✅ | ✅ | ✅ | — |
| **Phase 2** | knowledge/find API + MCP skill | service+cli | ✅ | ✅ | ✅ | ✅ | — |
| **Phase 3** | 智能分诊（LLM 分类 + 重复检测 + owner 路由） | service | ✅ | ✅ | ✅ | ✅ | — |
| **Phase 3** | Issue Watcher（定时轮询 + 分诊 + 通知） | service | ✅ | ✅ | ✅ | ✅ | — |
| **Phase 3** | Pipeline 状态管理 API | service | ✅ | ✅ | ✅ | ✅ | — |
| **Phase 3** | triage / pipeline / watch CLI 命令 | cli | ✅ | ✅ | ⚠️ | ✅ | — |
| **Phase 4** | Dashboard（Trello N+1 方案） | service+cli | ✅ | ✅ | ✅ | ✅ | 5 PR 全部完成，53 tests + 已部署上线 |
| **Phase 5** | 可插拔 Agent + 本地知识库 | cli | ✅ | ❌ | ❌ | ❌ | 整体未开始 |
| **Phase 6** | Manager Metrics Dashboard + 模糊搜索 | service+cli | ✅ | ✅ | ✅ | ❌ | 7 PR 全部完成，63 new tests |
| **Phase 7** | 历史 Issue 批量导入 + 状态推断 | service+cli | ✅ | ❌ | ❌ | ❌ | 设计文档完成，待实施 |
| **Phase 8** | 评估反馈闭环 | service+cli | ✅ | ❌ | ❌ | ❌ | 设计文档完成，待实施 |

---

## 二、Phase 1-3 详情（已完成）

Phase 1-3 的核心功能均已完成并部署。以下记录 Phase 3 的后续演进和未完成的运维事项。

### Phase 3 演进：ADO 评论通知

详细设计见 [ADO_COMMENT_NOTIFICATION.md](../ai-issue-service/docs/ADO_COMMENT_NOTIFICATION.md)

| 子任务 | 仓库 | 状态 | 说明 |
|--------|------|:----:|------|
| 设计文档 | service | ✅ | `docs/ADO_COMMENT_NOTIFICATION.md` |
| PR 1: ADO 客户端 | service | ✅ | `ado_client.py` + 14 tests + API 连通性验证通过 |
| PR 2: 通知渠道切换 | service | ✅ | `notification.py` 改写 + 24 tests |
| PR 3: notified 重试机制 | service | ✅ | `issue_watcher.py` + `create_tables.sql` + 21 tests |
| README 更新 | service | ✅ | 新增 ADO 环境变量 + ado_client 说明 |
| Terraform 配置 ADO 环境变量 | service/infra | ✅ | `variables.tf` + `main.tf` + `terraform.tfvars` 已添加 ADO 配置，`terraform validate` 通过 |
| 数据库 migration（notified 列） | service | ✅ | `scripts/migrations/001_add_notified_column.sql` 已创建，待生产 DB 执行 |
| resource_owners 映射补充 | service | ❌ | 目前只映射了 jiaweitao，需补充团队其他工程师 |
| PAT 轮换 | — | ❌ | 旧 PAT 已暴露，需生成新的并填入 `terraform.tfvars` |
| 部署验证 | service | ❌ | terraform apply + DB migration + 端到端验证 |

---

## 三、Phase 4：Trello 多 Board Dashboard（已完成）

详细设计见 [PHASE4_SPEC.md](PHASE4_SPEC.md)

**架构**：N+1 Board（每个工程师一个私有 Board + 经理一个全局 Board），拖拽卡片触发 approve/reject/分配等后端操作，零前端代码。

| PR | 子任务 | 仓库 | 状态 | 说明 |
|----|--------|------|:----:|------|
| **PR 1** | DB 表 + PAT 加密 + 注册接口 | service+cli | ✅ | `engineer_tokens` + `trello_card_mapping` + pipeline 新增字段 |
| PR 1 | AES-256-GCM 加密模块 | service | ✅ | `app/encryption.py` — 7 tests passed |
| PR 1 | `POST /engineers/register` 接口 | service | ✅ | 验证 PAT + 加密存储 + `GET /engineers/{owner}` |
| PR 1 | `ai-issue register --pat` CLI 命令 | cli | ✅ | `lib/commands/register.js` 注册完成 |
| PR 1 | 配置项 + Terraform 环境变量 | service | ✅ | Trello/encryption/fork 变量 + secrets + terraform validate 通过 |
| **PR 2** | Trello API 封装 + 单向同步 | service | ✅ | `app/trello.py` ~450 行 — 20 tests passed |
| PR 2 | `sync_to_trello()` 双 Board 同步 | service | ✅ | 状态变更时同时更新工程师 Board + 经理 Board |
| PR 2 | Issue Watcher 挂钩 Trello 同步 | service | ✅ | 分诊后自动创建卡片 |
| PR 2 | Board 自动创建脚本 | service | ✅ | `setup_engineer_board()` 创建 Board + 5 Lists + Webhook |
| PR 2 | `TRELLO_ENABLED=false` 总开关 | service | ✅ | 关闭时所有 Trello 调用静默跳过 |
| **PR 3** | Webhook 拖拽工作流 | service | ✅ | `app/webhook.py` ~330 行 + `POST /trello/webhook` — 20 tests passed |
| PR 3 | 工程师 Board 拖拽 | service | ✅ | Review→Approved（创建 PR）、Review→Rejected |
| PR 3 | 经理 Board 拖拽 | service | ✅ | Triaged→Queued（分配）、Queued→Triaged（撤回） |
| PR 3 | 非法拖拽回弹 | service | ✅ | 非白名单转换自动回弹 + 卡片评论提示 |
| PR 3 | `POST /pipeline/{n}/approve` | service | ✅ | decrypt PAT → 创建跨 fork PR → 更新 pipeline |
| PR 3 | `POST /pipeline/{n}/reject` | service | ✅ | 更新状态 + 记录原因 |
| PR 3 | `POST /pipeline/{n}/enqueue` + `/dequeue` | service | ✅ | 经理手动入队/撤回 + 联动工程师 Board 卡片 |
| **PR 4** | 定时对账 + Butler 规则 | service | ✅ | `scripts/reconcile_trello.py` + 每小时 cron — 6 tests passed |
| PR 4 | Terraform 对账 cron job | service/infra | ✅ | 条件创建（trello_api_key 非空时），每小时运行 |
| PR 4 | Butler 规则文档 | — | ⏭️ | Trello Butler 在 Board 创建后手动配置，无需代码 |
| **PR 5** | 部署 + 端到端验证 | service/infra | ✅ | Terraform applied + 镜像推送 + DB 迁移 + 4 端点冒烟测试通过 |

**依赖关系**：PR 1 → PR 2 → PR 3，PR 4 依赖 PR 2，PR 5 依赖 PR 1-4。

### Phase 4 上线调试进度

| 项目 | 状态 | 说明 |
|------|:----:|------|
| Trello API 凭据获取 | ✅ | API Key + Token 已获取 |
| 经理 Board 创建 | ✅ | 📊 AI Issue Pipeline（6 列），通过 API 自动创建 |
| Trello 配置部署 | ✅ | terraform.tfvars + terraform apply 完成 |
| Trello Webhook 注册 | ✅ | Manager board webhook 已注册并 active |
| Container App min_replicas=1 | ✅ | 防止冷启动导致 webhook 超时 |
| Webhook 签名验证 | ✅ | 已跳过（Azure TLS termination 导致 URL mismatch） |
| 非法拖拽回弹 | ✅ | 回弹 + 英文评论，无循环（move_card 记录 + consume-on-read） |
| Gunicorn workers 1 | ✅ | 单 worker 保证 _recent_api_moves 内存共享 |
| 工程师注册 (`ai-issue register`) | ✅ | jiaweitao 已注册，私有 Board 自动创建 |
| 合法拖拽 Triaged→Queued | ✅ | Add Member 后拖拽成功，工程师 Board 同步创建卡片 |
| 合法拖拽 Review→Approved | ✅ | PR 自动创建（author=jiaweitao001），卡片评论 PR 链接 |
| 合法拖拽 Review→Rejected | ✅ | DB 状态更新 + 经理 Board 同步 |
| 经理 Queued→Triaged 撤回 | ✅ | 工程师 Board 卡片自动删除 |
| 端到端：triage → 卡片 → 拖拽 → PR | ✅ | 全链路验证通过 |

---

## 四、Phase 5：可插拔 Agent + 本地知识库

详细设计见 [PHASE5_SPEC.md](PHASE5_SPEC.md)

**状态**：设计文档已完成，整体未开始实施。

---

## 五、Phase 6：Manager Metrics + 模糊搜索（已完成）

详细设计见 [PHASE6_SPEC.md](PHASE6_SPEC.md)

**目标**：Manager 终端查看团队级效能指标（回复率、响应速度、解决率、P50/P90）+ 全文模糊搜索历史解决方案。

| PR | 子任务 | 仓库 | 状态 | 说明 |
|----|--------|------|:----:|------|
| **PR 1** | DB Migration + 时间戳记录 | service | ✅ | `assigned_at`, `first_response_at`, `solved_at`, `solution_summary` 字段 + 回填脚本 + 10 new tests |
| **PR 2** | Metrics API | service | ✅ | `app/metrics.py` + `GET /metrics/{repo:path}` + 20 new tests |
| **PR 3** | Metrics CLI | cli | ✅ | `lib/commands/metrics.js` + `display-helpers.js` 扩展 + 28 new tests |
| **PR 4** | Solution Summary 提取 + 上报 | service+cli | ✅ | `PATCH /pipeline/{repo}/{issue}/summary` + `extractSolutionSummary()` + solve.js 集成 + 23 new tests |
| **PR 5** | Search API | service | ✅ | `app/pipeline_search.py`（fuzzy + semantic 自动 fallback）+ `GET /search/pipeline/{repo:path}` + 20 new tests |
| **PR 6** | Search CLI | cli | ✅ | `lib/commands/search-cmd.js` + `ai-issue search` 命令 + 15 new tests |
| **PR 7** | 文档更新 | cli | ✅ | README + QUICKSTART + PHASE6_SPEC 更新 |

**依赖关系**：PR 1 → PR 2 → PR 3，PR 1 → PR 4 → PR 5 → PR 6，PR 7 最后合并。

---

## 六、Phase 7：历史 Issue 批量导入

详细设计见 [PHASE7_SPEC.md](PHASE7_SPEC.md)

**目标**：一键导入 GitHub 历史 issue 到 pipeline，根据 issue 评论/PR/关闭状态自动推断 pipeline 状态，纳入 Dashboard 和 Metrics。

| 子任务 | 仓库 | 状态 | 说明 |
|--------|------|:----:|------|
| 设计文档 | — | ✅ | `docs/PHASE7_SPEC.md` |
| GraphQL 查询扩展（stateReason, timeline events） | service | ❌ | 获取 closedAt、assignees、关联 PR |
| 状态推断引擎 `import_engine.py` | service | ❌ | 决策树：closed+PR→solved, open+assignee→queued 等 |
| 时间戳回填逻辑 | service | ❌ | 从 GitHub 事件中回填 assigned_at / first_response_at / solved_at |
| `POST /import/{repo}` API | service | ❌ | 批量导入，支持 full/incremental/backfill 模式 |
| `GET /import/{repo}/status` API | service | ❌ | 异步导入进度查询 |
| DB Migration（import_jobs 表 + pipeline 新字段） | service | ❌ | `import_source`, `inferred_reason`, `skipped` 状态 |
| `ai-issue import` CLI | cli | ❌ | --mode, --skip-triage, --dry-run, --sync-trello |
| Trello 批量同步 | service | ❌ | 导入后可选同步到看板（限量） |

---

## 七、Phase 8：评估反馈闭环

详细设计见 [PHASE8_SPEC.md](PHASE8_SPEC.md)

**目标**：将 Evaluation 输出结构化，回流到 pipeline 数据库，通过 SQL 聚合暴露系统痛点，驱动 Prompt/Skills 持续改进。

**核心思路**：结构化输入 > 事后提取。改造 evaluation prompt 输出枚举化的错误分类，存入现有 pipeline 表，用 SQL 聚合发现痛点。

### 子任务

| PR | 子任务 | 仓库 | 状态 | 说明 |
|----|--------|------|:----:|------|
| **PR 1** | DB Migration + 评估上报 API | service | ❌ | `issue_pipeline` 新增 7 字段 + `POST /pipeline/{repo}/{issue}/evaluation` |
| **PR 2** | 评估统计 API | service | ❌ | `GET /metrics/{repo}/evaluation` 聚合查询 + 周度趋势 |
| **PR 3** | Prompt 改造 + 数据上报 | cli | ❌ | `MANUAL_EVALUATION_PROMPT.md` 添加 JSON 输出 + `evaluate.js` 解析上报 |
| **PR 4** | Metrics 展示 | cli | ❌ | `ai-issue metrics` 增加评估维度展示（可与 Phase 6 合并） |

### 错误分类体系

12 种枚举化错误类型，按归因维度分组：

| 归因 | 错误类型 |
|------|---------|
| Phase 2 / Validator 缺失 | `field_naming`, `missing_test`, `schema_error`, `nil_safety`, `overengineering` |
| Phase 2 / Prompt 问题 | `scope_creep`, `wrong_approach` |
| Phase 1 / 研究不足 | `research_gap`, `incomplete_fix`, `regression` |
| 跨 Phase | `sdk_misuse`, `format_violation` |

**依赖关系**：PR 1 → PR 2，PR 1 → PR 3 → PR 4。PR 4 可与 Phase 6 Metrics PR 合并。

---

## 八、MCP Skills 增强

详细设计见 [SKILLS_ENHANCEMENT_PLAN.md](SKILLS_ENHANCEMENT_PLAN.md)

**目标**：通过 MCP Skills 提升 Issue 自动解决的准确率和效率。当前重点从 Phase 1（研究）向 Phase 2（验证）倾斜，因为 Phase 2 是出错率最高的阶段。

### 已完成的 Skills

| Skill | 工具 | 阶段 | 仓库 | 状态 | 说明 |
|-------|------|------|------|:----:|------|
| `github-issue-fetcher` | `get_issue_context` | Phase 1 / Eval | cli | ✅ | 结构化获取 Issue 数据，含评论/时间线/关联 PR |
| `code-similarity-finder` | `find_similar_implementations` | Phase 1 | cli | ✅ | Go 文件相似度分析，自动定位参考实现 |
| `similar-issue-finder` | `check_existing_research`, `find_similar_issues` | Phase 1 | cli+service | ✅ | 知识库搜索 + 语义相似 Issue 搜索 |

### 待完成任务

#### 🔴 高优先级：验证增强

| 子任务 | 仓库 | 状态 | 说明 |
|--------|------|:----:|------|
| `github-issue-fetcher` 上下文预算修复 | cli | ❌ | 评论截断（≤20 条）、diff 截断（≤4000 字符）、分页支持、速率限制处理 |
| 实现 `terraform-validator` Skill | cli | ❌ | `validate_changes` 工具：字段命名校验、Schema 验证、测试完整性、Read 函数安全性 |
| `terraform-validator` 加入 Phase 2 MCP 配置 | cli | ❌ | 更新 `config/mcp-config-phase2.json` |
| Phase 2 Prompt 添加验证工具说明 | cli | ❌ | 更新 `prompts/PHASE2_SOLUTION_PROMPT.md` |

#### 🟡 中优先级：补充工具

| 子任务 | 仓库 | 状态 | 说明 |
|--------|------|:----:|------|
| 实现 `git-history-analyzer` Skill | cli | ❌ | `analyze_file_history` 工具：结构化 git log 摘要（非智能根因分析） |
| `report-validator` 包装为 MCP Server | cli | ❌ | 复用 `lib/report-validator.js`，验证研究/解决方案报告格式 |
| 将 `report-validator` 加入 Phase 1 & 2 配置 | cli | ❌ | 更新两个 MCP 配置文件 |
| 添加监控指标 | cli | ❌ | tool_calls_count, total_response_tokens, truncation_events |

#### 🟢 低优先级：优化

| 子任务 | 仓库 | 状态 | 说明 |
|--------|------|:----:|------|
| 评估 `sdk-docs-search` 实现价值 | cli | ❌ | 对比 grep 基线，仅在索引模式下才值得实现 |
| `code-similarity-finder` 多语言支持 | cli | ❌ | 扩展到 HCL、Python（当前仅 Go） |
| `code-similarity-finder` 目录结构可配置 | cli | ❌ | 当前硬编码 `internal/services/`，仅适用 terraform-provider-azurerm |
| 建立效果评测基线和 A/B 测试框架 | cli | ❌ | 定义准确率/完整度/工具利用率/截断率基线 |

### 反馈闭环（评估驱动迭代）

| 错误类型 | 归因 Skill | 改进方向 |
|---------|-----------|---------|
| 信息不足（报告缺上下文） | `github-issue-fetcher` | 改进截断策略 |
| 参考偏差（相似实现不相关） | `code-similarity-finder` | 调整相似度权重 |
| 历史遗漏（已有 PR 未被发现） | `similar-issue-finder` | 优化搜索或扩大知识库 |
| 字段命名错误 | `terraform-validator`（缺失） | 加速实现 |
| 过度修改 | Prompt 问题 | 强化 Phase 2 约束语 |
| 格式不合规 | `report-validator`（缺失） | 加速实现 |

---

## 九、Bug 修复记录

### 9.1 Trello 同步缺口审计（2026-04-15）

CLI 上报 pipeline 状态变更后，后端部分 endpoint handler **未调用 `sync_to_trello()`**，导致 Trello 看板不同步。

#### 缺失的同步点

| 优先级 | 状态变更 | 触发位置（CLI） | 后端 Endpoint | 影响 |
|:------:|---------|----------------|---------------|------|
| **P1** | solving → **solved** | `lib/commands/solve.js:216` | `POST /pipeline/{repo}/{n}/solved` | **流程阻塞**：卡片卡在 Solving 列，无法进入 Review |
| **P2** | solving → **failed** | `lib/commands/solve.js:233` | `POST /pipeline/{repo}/{n}/failed` | 失败不可见：经理/工程师看不到错误 |
| **P2** | solving → **failed** | `lib/commands/watch.js:97` | `POST /pipeline/{repo}/{n}/failed` | 同上（watch daemon 的失败路径） |
| **P3** | queued → **solving** | `lib/commands/watch.js:84` | `POST /pipeline/{repo}/{n}/solving` | daemon 认领 issue 时看板无实时反映 |

#### 已正常工作的同步点（后端侧触发）

| 状态变更 | 触发方式 | 说明 |
|---------|---------|------|
| triaged → queued | Issue Watcher 分诊 | ✅ 自动创建 Trello 卡片 |
| queued → triaged | 经理 Board 拖拽 / dequeue API | ✅ 工程师 Board 卡片删除 |
| solved → pr_created | 工程师 Board 拖拽 Review→Approved | ✅ 创建 PR + 更新卡片 |
| solved → rejected | 工程师 Board 拖拽 Review→Rejected | ✅ 更新状态 + 同步经理 Board |

#### 修复结论

~~修复点在 **`ai-issue-service` 后端**，CLI 侧无需改动：~~
1. ~~`/pipeline/{repo}/{n}/solved` handler 添加 `sync_to_trello()` 调用~~
2. ~~`/pipeline/{repo}/{n}/failed` handler 添加 `sync_to_trello()` 调用~~
3. ~~`/pipeline/{repo}/{n}/solving` handler 添加 `sync_to_trello()` 调用~~
4. ~~工程师未注册 `trello_member_id` 时记录 warning 日志，不静默跳过~~

**2026-04-15 修复结论**：经核实，后端代码已有 `sync_to_trello()` 调用，但存在两个隐蔽 bug：
1. **测试 mock 返回类型错误**：`mark_pipeline_solved` mock 返回 `True`（bool）而非 `dict`，导致 `entry.get("assigned_to")` 抛出 `AttributeError`——2 个测试一直在 FAIL（被忽略）
2. **端点无 try/except 包裹 sync 调用**：sync 异常会导致 500 响应，即使 DB 已成功更新

已修复（commit `09ec835`）：
- 三个端点的 `sync_to_trello()` 调用加 try/except
- 修正 mock 返回类型，新增 21 个测试（含 sync 断言、通知断言、异常容错）
- 测试从 32 passed + 2 failed → 48 passed + 0 failed

### 9.2 `ai-issue solve` 未上报 solving 状态（2026-04-15）

**问题**：用户手动 `ai-issue solve` 时，`cmdSolve` 只在完成后上报 `solved`，从不上报 `solving`。
对比 watch daemon 会在 pick 时上报 `solving`（`watch.js:84`），导致：
- 经理 Board 卡片从 Queued **直接跳到** Review，跳过 Solving
- 经理无法实时看到哪个 issue 正在被处理

**修复**：在 `lib/commands/solve.js` 的 `cmdSolve` 中，Phase 1 开始前上报 `POST /pipeline/{repo}/{n}/solving`。状态：✅ 已修复

已修复（commit `90ef3e4`）：
- 新增 `reportSolvingToPipeline()` 函数
- 在 `cmdSolve` 中 Phase 1 开始前调用，与 watch daemon 行为一致
- 新增 6 个测试：调用验证、顺序验证、空 URL、异常容错、solved/failed 覆盖
- 全量测试 208 passed

---

## 十、近期优先级

| 优先级 | 任务 | 原因 |
|:------:|------|------|
| **P0** | PAT 轮换 | 安全问题，旧 token 已暴露 |
| **P1** | resource_owners 补充 | 否则所有 issue 都匹配不到正确的工程师 |
| **P1** | 部署 + 验证 | terraform apply + DB migration + 端到端验证 ADO 评论 |
| **P2** | ~~Phase 4 Trello 方案实施~~ | ✅ 已完成，5 PR 全部部署 |
| **P2** | ~~Phase 6 Metrics + 搜索~~ | ✅ 已完成，7 PR 全部实施 |
| **P2** | 评估反馈闭环（PR 1-3） | 驱动系统持续改进的数据基础，可与 Phase 6 协同实施 |
| **P2** | Phase 7 历史 Issue 导入 | Dashboard 和 Metrics 需历史数据支撑 |
| **P3** | `terraform-validator` Skill 实现 | Phase 2 准确度最大杠杆点，高频错误自动检测 |
| **P3** | `github-issue-fetcher` 上下文预算修复 | 评论/diff 截断未执行，可能导致上下文溢出 |
