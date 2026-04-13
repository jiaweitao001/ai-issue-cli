# AI Issue 项目任务追踪

**最后更新：** 2026-04-08

---

## 一、核心功能阶段

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

---

## 二、ADO 评论通知（Phase 3 演进）

详细设计见 [ADO_COMMENT_NOTIFICATION.md](../ai-issue-service/docs/ADO_COMMENT_NOTIFICATION.md)

| 子任务 | 仓库 | 状态 | 说明 |
|--------|------|:----:|------|
| 设计文档 | service | ✅ | `docs/ADO_COMMENT_NOTIFICATION.md` |
| PR 1: ADO 客户端 | service | ✅ | `ado_client.py` + 14 tests + API 连通性验证通过 |
| PR 2: 通知渠道切换 | service | ✅ | `notification.py` 改写 + 24 tests |
| PR 3: notified 重试机制 | service | ✅ | `issue_watcher.py` + `create_tables.sql` + 21 tests |
| README 更新 | service | ✅ | 新增 ADO 环境变量 + ado_client 说明 |
| Terraform 配置 ADO 环境变量 | service/infra | ❌ | `variables.tf` + `main.tf` + `terraform.tfvars` 需添加 ADO 配置 |
| 数据库 migration（notified 列） | service | ❌ | 需在生产 DB 执行 `ALTER TABLE issue_pipeline ADD COLUMN IF NOT EXISTS notified BOOLEAN DEFAULT false` |
| resource_owners 映射补充 | service | ❌ | 目前只映射了 jiaweitao，需补充团队其他工程师 |
| PAT 轮换 | — | ❌ | 旧 PAT 已暴露，需生成新的 |
| 部署验证 | service | ❌ | 部署后需验证 ADO 评论正常出现 |

---

## 三、Phase 4：Trello 多 Board Dashboard

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

## 四、其他并行计划

| 任务 | 仓库 | 设计 | 实现 | 说明 |
|------|------|:----:|:----:|------|
| Rust CLI 重写 | cli | ✅ 990 行规划 | ❌ | 4 周 5 阶段路线图，零 Rust 代码 |
| MCP Skills 增强（6 个工具） | cli | ✅ 526 行规划 | ⚠️ 部分 | github-fetcher + code-similarity 已存在，其余未实现 |

---

## 五、近期优先级

| 优先级 | 任务 | 原因 |
|:------:|------|------|
| **P0** | PAT 轮换 | 安全问题，旧 token 已暴露 |
| **P0** | Terraform 添加 ADO 环境变量 | ADO 通知部署的前置条件 |
| **P1** | 数据库 migration | 生产 DB 加 `notified` 列 |
| **P1** | resource_owners 补充 | 否则所有 issue 都匹配不到正确的工程师 |
| **P1** | 部署 + 验证 | 推送代码，验证 ADO 评论功能端到端工作 |
| **P2** | ~~Phase 4 Trello 方案实施~~ | ✅ 已完成，5 PR 全部部署 |
| **P3** | Rust 重写 / MCP 增强 | 非阻塞，可延后 |
