# Phase 6 技术方案：Manager Metrics Dashboard + 模糊搜索

> 在 Manager 终端提供团队级 Metrics 面板和全文模糊搜索，无需离开 CLI 即可掌握团队效能和定位历史方案

## 1. 目标

- **团队 Metrics**：Manager 在终端查看组内所有工程师的关键效能指标（回复率、响应速度、解决率等）
- **模糊搜索**：按关键词/自然语言搜索 issue 的解决方案、triage 结果、历史记录

**前置依赖**：Phase 4（Trello Dashboard + pipeline 状态跟踪）已完成。

**不做**：Web UI、图表渲染（保持纯终端体验）。

---

## 2. 背景

### 2.1 现有数据基础

当前 `issue_pipeline` 表已记录每条 issue 的完整生命周期：

| 字段 | 含义 |
|------|------|
| `assigned_to` | 分配的工程师 |
| `status` | triaged → queued → solving → solved → failed |
| `created_at` | 入 pipeline 时间（≈issue 创建/分配时间） |
| `updated_at` | 最近状态变更时间 |
| `reviewed_by` | 审阅者 |
| `reviewed_at` | 审阅时间 |
| `pr_url` / `pr_number` | PR 关联 |
| `triage_result` | JSONB，含 issue_type、complexity、recommendation 等 |

### 2.2 缺失数据

当前 pipeline 表**没有记录**以下关键时间点，需要补充：

| 缺失字段 | 含义 | 来源 |
|---------|------|------|
| `assigned_at` | issue 分配给工程师的时间 | triage 完成时记录 |
| `first_response_at` | 工程师首次回复/开始处理的时间 | `mark_pipeline_solving` 时记录 |
| `solved_at` | 解决完成时间 | `mark_pipeline_solved` 时记录 |
| `solution_summary` | 解决方案摘要（用于搜索） | Phase 2 完成时从报告中提取 |

---

## 3. 方案设计

### 3.1 数据库变更

#### 3.1.1 Pipeline 表新增字段

```sql
-- Phase 6: Metrics tracking fields
ALTER TABLE issue_pipeline ADD COLUMN IF NOT EXISTS assigned_at TIMESTAMPTZ;
ALTER TABLE issue_pipeline ADD COLUMN IF NOT EXISTS first_response_at TIMESTAMPTZ;
ALTER TABLE issue_pipeline ADD COLUMN IF NOT EXISTS solved_at TIMESTAMPTZ;
ALTER TABLE issue_pipeline ADD COLUMN IF NOT EXISTS solution_summary TEXT DEFAULT '';

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS idx_pipeline_assigned_at
    ON issue_pipeline (repo, assigned_at DESC) WHERE assigned_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pipeline_solved_at
    ON issue_pipeline (repo, solved_at DESC) WHERE solved_at IS NOT NULL;

-- Full-text search index for solution_summary + title
CREATE INDEX IF NOT EXISTS idx_pipeline_fts
    ON issue_pipeline USING GIN (
        to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(solution_summary, ''))
    );
```

#### 3.1.2 时间戳写入点

| 字段 | 写入时机 | 修改位置 |
|------|---------|---------|
| `assigned_at` | 进入 `queued` 状态且有 `assigned_to` 时 | `triage.py`, `webhook.py` |
| `first_response_at` | `mark_pipeline_solving()` 时写入（仅首次） | `triage.py` |
| `solved_at` | `mark_pipeline_solved()` 时写入 | `triage.py` |
| `solution_summary` | CLI solve 完成后通过新 API 上报 | `main.py` 新端点 |

#### 3.1.3 实现细节（已实施）

**`assigned_at` 语义与写入规则**：

`assigned_at` 表示"进入活跃分配/队列"的时间点，**不是** triage 推荐 owner 的时间。具体规则：

1. **INSERT 路径**（`upsert_pipeline_entry`）：使用 SQL CASE 表达式，仅当 `status = 'queued'` 且 `assigned_to != ''` 时设为 `NOW()`，否则为 `NULL`。这确保 SKIP/NEEDS_HUMAN 的 triaged 状态不会错误记录分配时间。

2. **ON CONFLICT 路径**（re-triage 同一 issue）：
   - 若现有状态为 `solving`/`solved`/`pr_created`，保留原始 `assigned_to` 和 `assigned_at`（防止 in-flight issue 被覆盖）
   - 若 `assigned_to` 变更（使用 `IS DISTINCT FROM` 做 NULL 安全比较），更新 `assigned_at = NOW()`
   - 若 `assigned_at` 为 NULL 且新 `assigned_to` 非空，填入 `NOW()`

3. **手动分配路径**（`webhook.py:_update_pipeline_status`）：当 kwargs 包含非空 `assigned_to` 时，自动追加 `assigned_at = NOW()`。覆盖 `enqueue_issue()` 和 Trello addMemberToCard webhook 两条路径。

**`first_response_at` 幂等性**：

使用 `COALESCE(first_response_at, NOW())` 确保仅首次 solving 时记录，重复调用不覆盖。

**`solved_at` 直接写入**：

`mark_pipeline_solved()` 中直接设置 `solved_at = NOW()`。

**`get_pipeline_entries()` 序列化**：

新增 `assigned_at`、`first_response_at`、`solved_at` 的 ISO 格式序列化（与 `created_at`、`updated_at` 同等处理）。

---

### 3.2 后端 API（ai-issue-service）

#### 3.2.1 Metrics API

**`GET /metrics/{repo}`**

Query Parameters:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `owner` | str | (all) | 按工程师筛选，不传则返回全组汇总 |
| `since` | str | 30d ago | 起始时间（ISO 8601 或相对值如 `7d`, `30d`, `90d`） |
| `until` | str | now | 结束时间 |

Response:

```json
{
  "period": { "since": "2026-03-15T00:00:00Z", "until": "2026-04-14T23:59:59Z" },
  "summary": {
    "total_issues": 42,
    "solved": 30,
    "failed": 5,
    "in_progress": 4,
    "pending": 3,
    "solve_rate": 0.714,
    "avg_response_time_hours": 2.5,
    "avg_solve_time_hours": 18.3,
    "p50_response_time_hours": 1.2,
    "p90_response_time_hours": 6.8
  },
  "by_engineer": [
    {
      "owner": "alice",
      "owner_name": "Alice Wang",
      "total_issues": 15,
      "solved": 12,
      "failed": 1,
      "in_progress": 1,
      "pending": 1,
      "solve_rate": 0.80,
      "avg_response_time_hours": 1.8,
      "avg_solve_time_hours": 12.5,
      "p50_response_time_hours": 0.8,
      "p90_response_time_hours": 4.2
    },
    {
      "owner": "bob",
      "owner_name": "Bob Li",
      "total_issues": 14,
      "solved": 10,
      "failed": 2,
      "in_progress": 2,
      "pending": 0,
      "solve_rate": 0.714,
      "avg_response_time_hours": 3.1,
      "avg_solve_time_hours": 22.0,
      "p50_response_time_hours": 1.5,
      "p90_response_time_hours": 8.0
    }
  ],
  "by_status": {
    "triaged": 3,
    "queued": 0,
    "solving": 4,
    "solved": 30,
    "failed": 5
  },
  "by_complexity": {
    "LOW": 12,
    "MEDIUM": 20,
    "HIGH": 8,
    "CRITICAL": 2
  }
}
```

#### 3.2.2 指标计算逻辑

```python
# metrics.py（新模块）

def compute_metrics(repo: str, owner: str | None, since: datetime, until: datetime) -> dict:
    """
    核心指标定义：
    
    1. solve_rate = solved / (solved + failed)
       - 不含 in_progress 和 pending，只看有最终结果的
    
    2. response_time = first_response_at - assigned_at
       - 从 issue 分配到工程师首次开始处理的时间差
       - 仅计算 first_response_at 非空的记录
    
    3. solve_time = solved_at - assigned_at
       - 从 issue 分配到解决完成的时间差
       - 仅计算 solved_at 非空的记录
    
    4. p50 / p90 = PERCENTILE_CONT(0.5/0.9) WITHIN GROUP
       - PostgreSQL 原生百分位函数
    """
```

SQL 查询核心：

```sql
-- 单次查询获取所有指标（避免 N+1）
SELECT
    assigned_to,
    COUNT(*) AS total_issues,
    COUNT(*) FILTER (WHERE status = 'solved') AS solved,
    COUNT(*) FILTER (WHERE status = 'failed') AS failed,
    COUNT(*) FILTER (WHERE status = 'solving') AS in_progress,
    COUNT(*) FILTER (WHERE status IN ('triaged', 'queued')) AS pending,
    
    -- 响应时间（小时）
    AVG(EXTRACT(EPOCH FROM (first_response_at - assigned_at)) / 3600)
        FILTER (WHERE first_response_at IS NOT NULL AND assigned_at IS NOT NULL)
        AS avg_response_hours,
    
    PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_response_at - assigned_at)) / 3600
    ) FILTER (WHERE first_response_at IS NOT NULL AND assigned_at IS NOT NULL)
        AS p50_response_hours,
    
    PERCENTILE_CONT(0.9) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (first_response_at - assigned_at)) / 3600
    ) FILTER (WHERE first_response_at IS NOT NULL AND assigned_at IS NOT NULL)
        AS p90_response_hours,
    
    -- 解决时间（小时）
    AVG(EXTRACT(EPOCH FROM (solved_at - assigned_at)) / 3600)
        FILTER (WHERE solved_at IS NOT NULL AND assigned_at IS NOT NULL)
        AS avg_solve_hours,
    
    PERCENTILE_CONT(0.5) WITHIN GROUP (
        ORDER BY EXTRACT(EPOCH FROM (solved_at - assigned_at)) / 3600
    ) FILTER (WHERE solved_at IS NOT NULL AND assigned_at IS NOT NULL)
        AS p50_solve_hours
    
FROM issue_pipeline
WHERE repo = %s
  AND (assigned_at >= %s OR created_at >= %s)
  AND (assigned_at <= %s OR created_at <= %s)
GROUP BY assigned_to
ORDER BY total_issues DESC;
```

#### 3.2.3 搜索 API

**`GET /search/pipeline/{repo}`**

> 搜索模式由后端自动选择（先 fuzzy 全文检索，若结果不足则 fallback 到 semantic），CLI 不暴露 mode 参数。

Query Parameters:

| 参数 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `q` | str | (required) | 搜索关键词（英文） |
| `owner` | str | (all) | 按工程师筛选 |
| `status` | str | (all) | 按状态筛选 |
| `limit` | int | 20 | 返回条数上限 |

后端内部搜索策略（对用户透明）：
1. 先执行 fuzzy（PostgreSQL 全文检索 + ILIKE）
2. 若 fuzzy 结果 < 3 条且 semantic 搜索可用，自动追加 semantic 结果
3. 合并去重后按 score 排序返回

Response:

```json
{
  "results": [
    {
      "issue": 30340,
      "title": "azurerm_key_vault_certificate: polling timeout during creation",
      "status": "solved",
      "assigned_to": "alice",
      "solution_summary": "Add custom poller with 30s interval in resource_key_vault_certificate.go",
      "resource_name": "azurerm_key_vault_certificate",
      "recommendation": "PROCEED",
      "match_score": 0.92,
      "match_highlight": "polling <b>timeout</b> during creation",
      "pr_url": "https://github.com/.../pull/30345",
      "solved_at": "2026-03-20T10:30:00Z"
    }
  ],
  "total": 5
}
```

#### 3.2.4 搜索实现

后端内部两种搜索引擎，自动选择，对用户透明：

**引擎 1: Fuzzy（PostgreSQL 全文检索 + ILIKE）— 默认首选**

```python
def search_pipeline_fuzzy(repo: str, query: str, owner: str | None,
                          status: str | None, limit: int) -> list[dict]:
    """
    使用 PostgreSQL ts_rank + ts_headline 实现全文搜索。
    搜索范围：title + solution_summary + triage_result::text
    仅支持英文，使用 'english' 配置。
    """
```

```sql
-- 全文检索 + ILIKE fallback
WITH fts AS (
    SELECT issue, title, status, assigned_to, solution_summary,
           resource_name, recommendation, pr_url, solved_at,
           ts_rank(
               to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(solution_summary, '')),
               plainto_tsquery('english', %s)
           ) AS rank
    FROM issue_pipeline
    WHERE repo = %s
      AND (
          to_tsvector('english', COALESCE(title, '') || ' ' || COALESCE(solution_summary, ''))
          @@ plainto_tsquery('english', %s)
          OR title ILIKE %s
          OR solution_summary ILIKE %s
      )
)
SELECT *, ts_headline('english', COALESCE(title, '') || ' ' || COALESCE(solution_summary, ''),
          plainto_tsquery('english', %s)) AS highlight
FROM fts
ORDER BY rank DESC
LIMIT %s;
```

**引擎 2: Semantic（向量语义搜索）— 自动 fallback**

```python
def search_pipeline_semantic(repo: str, query: str, owner: str | None,
                             status: str | None, limit: int) -> list[dict]:
    """
    当 fuzzy 结果不足时自动触发。
    将 query 转为 embedding，与 knowledge_embeddings 做向量相似度搜索。
    匹配后 JOIN issue_pipeline 获取状态和方案信息。
    """
```

**自动选择逻辑**：

```python
def search_pipeline(repo: str, query: str, **kwargs) -> dict:
    """统一搜索入口，自动选择搜索引擎。"""
    results = search_pipeline_fuzzy(repo, query, **kwargs)
    if len(results) < 3 and semantic_search_available():
        semantic_results = search_pipeline_semantic(repo, query, **kwargs)
        results = merge_and_deduplicate(results, semantic_results)
    return {"results": results, "total": len(results)}
```

#### 3.2.5 Solution Summary 上报 API

**`PATCH /pipeline/{repo}/{issue_number}/summary`**

```json
{ "solution_summary": "Add custom poller with 30s interval..." }
```

CLI solve 完成后自动调用，从 Phase 2 报告中提取方案摘要上报。

---

### 3.3 CLI 命令（ai-issue-cli）

#### 3.3.1 `ai-issue metrics` 命令

> ⚠️ 仅 Manager 有权限使用 `metrics` 和 `search` 命令。非 Manager 用户执行时提示权限不足。

新增 `lib/commands/metrics.js`：

```bash
# 查看全组过去 30 天的 metrics
ai-issue metrics

# 查看特定工程师
ai-issue metrics --owner alice

# 自定义时间范围
ai-issue metrics --since 7d
ai-issue metrics --since 2026-01-01 --until 2026-03-31

```

**终端输出效果**：

```
╔══════════════════════════════════════════════════════════════════════════╗
║  📊 Team Metrics (2026-03-15 ~ 2026-04-14)                            ║
╠══════════════════════════════════════════════════════════════════════════╣
║                                                                        ║
║  Total: 42 issues │ Solved: 30 │ Failed: 5 │ In Progress: 4           ║
║  Solve Rate: 71.4%  │ Avg Response: 2.5h │ Avg Solve: 18.3h          ║
║                                                                        ║
╠═══════════════╦═══════╦════════╦════════╦═══════════╦══════════════════╣
║ Engineer      ║ Total ║ Solved ║ Failed ║ Solve Rate║ Avg Response    ║
╠═══════════════╬═══════╬════════╬════════╬═══════════╬══════════════════╣
║ Alice Wang    ║   15  ║   12   ║    1   ║   80.0%   ║   1.8h          ║
║ Bob Li        ║   14  ║   10   ║    2   ║   71.4%   ║   3.1h          ║
║ Carol Chen    ║   13  ║    8   ║    2   ║   61.5%   ║   2.8h          ║
╚═══════════════╩═══════╩════════╩════════╩═══════════╩══════════════════╝

  P50 Response: 1.2h │ P90 Response: 6.8h
  P50 Solve:   10.5h │ P90 Solve:   36.2h
```

#### 3.3.2 `ai-issue search` 命令

新增 `lib/commands/search-cmd.js`：

```bash
# 搜索解决方案（搜索模式自动选择，用户无需关心）
ai-issue search "polling timeout"
ai-issue search "key vault certificate creation"

# 按工程师 / 状态筛选
ai-issue search "timeout" --owner alice --status solved

```

**终端输出效果**：

```
🔍 Search results for "polling timeout" (fuzzy, 3 matches)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

#30340  azurerm_key_vault_certificate: polling timeout during creation
        Status: solved │ Owner: alice │ Score: 0.92
        Solution: Add custom poller with 30s interval in resource_key_vault_certificate.go
        PR: https://github.com/.../pull/30345

#31205  azurerm_cosmosdb_account: timeout waiting for update
        Status: solved │ Owner: bob │ Score: 0.78
        Solution: Increase poller timeout to 60min for CosmosDB account update
        PR: https://github.com/.../pull/31210

#31890  azurerm_storage_account: creation polling fails intermittently
        Status: solving │ Owner: carol │ Score: 0.71
        Solution: (in progress)
```

#### 3.3.3 命令注册

`ai-issue.js` 注册新命令：

```javascript
program
  .command('metrics')
  .description('View team metrics (response time, solve rate, etc.)')
  .option('--owner <name>', 'Filter by engineer')
  .option('--since <period>', 'Start of time range (e.g. 7d, 30d, 2026-01-01)', '30d')
  .option('--until <date>', 'End of time range')
  .action((options) => cmdMetrics(options));

program
  .command('search <query>')
  .description('Search issues and solutions')
  .option('--owner <name>', 'Filter by engineer')
  .option('--status <status>', 'Filter by status')
  .option('--limit <n>', 'Max results', '20')
  .action((query, options) => cmdSearch(query, options));
```

---

### 3.4 Solution Summary 自动提取

#### 3.4.1 Solve 完成后自动上报

在 `lib/commands/solve.js` 的 Phase 2 完成后，自动从报告中提取摘要并上报：

```javascript
// Phase 2 完成后
if (config.serviceUrl) {
  const summary = extractSolutionSummary(reportPath);
  await serviceClient.updateSolutionSummary(repo, issueNumber, summary);
}
```

#### 3.4.2 摘要提取逻辑

从 Phase 2 报告（Markdown）中提取关键信息：

```javascript
function extractSolutionSummary(reportPath) {
  const content = fs.readFileSync(reportPath, 'utf-8');
  // 提取策略：
  // 1. 查找 "## Solution" / "## Fix" / "## Changes" 等标题下的首段
  // 2. 查找 "修改了以下文件" 类描述
  // 3. 截取前 500 字符作为摘要
  // 4. Fallback: 报告标题 + 前 200 字符
}
```

---

## 4. 实施路线（按 PR 拆分）

> 每个 PR 独立可部署、可 revert，按依赖顺序合并。标注 `[service]` = ai-issue-service 仓库，`[cli]` = ai-issue-cli 仓库。

### PR 1: DB Migration + 时间戳记录 `[service]` ✅

**目标**：为 Metrics 计算奠定数据基础，不影响现有功能。
**分支**：`phase6/pr1-db-migration-timestamps` | **测试**：87 pass

- [x] 编写 `scripts/migrations/002_add_metrics_columns.sql`（新增 `assigned_at`, `first_response_at`, `solved_at`, `solution_summary` 字段 + 索引）
- [x] 编写回填脚本：`assigned_at = created_at`（仅 queued/solving/solved/pr_created），`solved_at = updated_at`（仅 solved/pr_created）
- [x] 修改 `triage.py:upsert_pipeline_entry()` 写入 `assigned_at`（含手动分配场景：`assigned_to` 变更时更新 `assigned_at`）
- [x] 修改 `triage.py:mark_pipeline_solving()` 写入 `first_response_at`（仅首次，COALESCE 幂等）
- [x] 修改 `triage.py:mark_pipeline_solved()` 写入 `solved_at`
- [x] 修改 `webhook.py:_update_pipeline_status()` 自动设置 `assigned_at`（当 assigned_to 被设置时）
- [x] 测试（10 new + 2 fixed pre-existing）

### PR 2: Metrics API `[service]` ✅

**目标**：后端提供 Metrics 查询能力，依赖 PR 1 的字段。
**分支**：`phase6/pr2-metrics-api` | **测试**：20 new (107 total pass)

- [x] 新增 `app/metrics.py` 模块（`compute_metrics()` + `parse_since()` + 辅助函数）
- [x] 新增 `GET /metrics/{repo:path}` 端点（含 `owner`, `since`, `until` 参数）
- [x] 权限：使用现有 API key 认证（manager-only 角色系统延后）
- [x] 测试：20 tests（parse_since 6, compute_metrics 10, endpoint 4）

### PR 3: Metrics CLI `[cli]` ✅

**目标**：Manager 终端可查看团队 Metrics，依赖 PR 2 的 API。
**分支**：`phase6/pr3-metrics-cli` | **测试**：28 new (233 total pass)

- [x] 新增 `lib/commands/metrics.js`（`cmdMetrics` + `displayMetrics` + 格式化辅助函数）
- [x] 扩展 `display-helpers.js`（`renderMetricsTable` 表格渲染 + `renderMetricsList` 窄窗口降级）
- [x] `ai-issue.js` 注册 `metrics` 命令（`--owner`, `--since`, `--until`）
- [x] 测试：24 metrics tests + 4 display-helpers tests

### PR 4: Solution Summary 提取 + 上报 `[cli]` + `[service]` ✅

**目标**：Solve 完成后自动提取摘要并上报，为搜索功能提供数据。
**分支**：`phase6/pr4-solution-summary` (both repos) | **测试**：service 8 new (122 total), cli 15 new (250 total)

- [x] `[service]` 新增 `PATCH /pipeline/{repo:path}/{issue}/summary` 端点 + `SummaryUpdateRequest` 模型
- [x] `[service]` `update_solution_summary()` 函数：更新 solution_summary 字段，超 5000 字符自动截断
- [x] `[cli]` `lib/summary-extractor.js`：从 Phase 2 Markdown 报告提取摘要（## Solution/Fix/Changes/Implementation，fallback 到标题+前 200 字符，截取 500 字符）
- [x] `[cli]` `service-client.js:updateSolutionSummary()` 方法
- [x] `[cli]` `solve.js` Phase 2 完成后自动上报（non-fatal）
- [x] 测试：service 8 tests (PATCH 正常/404/400/截断 + triage update/not_found/params/truncate), cli 15 tests (提取 11 + solve 集成 3 + client 1)

### PR 5: Search API `[service]` ✅

**目标**：后端提供搜索能力，依赖 PR 1 的 FTS 索引 + PR 4 的 summary 数据。
**分支**：`phase6/pr5-search-api` | **测试**：20 new (162 total)

- [x] `app/pipeline_search.py`：
  - `search_pipeline_fuzzy()`：PostgreSQL tsvector/tsquery + ILIKE fallback，ts_rank 排序 + ts_headline 高亮
  - `search_pipeline_semantic()`：embedding → knowledge_embeddings 向量相似度搜索，score < 0.3 过滤，embedding 失败优雅降级
  - `search_pipeline()`：统一入口，fuzzy 优先，< 3 条自动 fallback semantic，`_merge_and_deduplicate` 去重 + score 排序
- [x] `GET /search/pipeline/{repo:path}` 端点（q, owner, status, limit 参数，空 query 返回 400）
- [x] 权限：使用现有 API key 认证
- [x] 测试：fuzzy 8 + semantic 3 + unified 5 + endpoint 4

### PR 6: Search CLI `[cli]` ✅

**目标**：Manager 终端可搜索历史方案，依赖 PR 5 的 API。
**分支**：`phase6/pr6-search-cli` | **测试**：15 new (265 total)

- [x] `lib/commands/search-cmd.js`：`cmdSearch` + `displaySearchResults`，status 颜色编码，solution 占位符，PR URL 条件显示，singular/plural match 语法
- [x] `ai-issue.js` 注册 `search <query>` 命令（`--owner`, `--status`, `--limit`）
- [x] 测试：API 调用 + 参数传递 5, 错误处理 5 (HTTP/403/network/no-url/no-repo), 渲染 5 (match count/PR url/empty solution/singular grammar)

### PR 7: 文档更新 `[cli]` ✅

**目标**：补全用户文档。
**分支**：`phase6/pr7-docs`

- [x] README.md: 新增 metrics/search Options 表格、CLI Cheat Sheet 补充、目录结构新增 metrics.js/search-cmd.js/summary-extractor.js
- [x] QUICKSTART.md: 命令总览新增 Phase 6 命令、CLI Cheat Sheet 补充
- [x] PHASE6_SPEC.md: 全部 7 个 PR 标记为 ✅

### PR 依赖关系

```
PR1 (DB Migration)
 ├── PR2 (Metrics API) ── PR3 (Metrics CLI)
 ├── PR4 (Solution Summary) ── PR5 (Search API) ── PR6 (Search CLI)
 └────────────────────────────────────────────────── PR7 (Docs, 最后合并)
```

---

## 5. 指标定义速查

| 指标 | 公式 | 说明 |
|------|------|------|
| **Solve Rate** | `solved / (solved + failed)` | 排除进行中的 issue |
| **Avg Response Time** | `mean(first_response_at - assigned_at)` | 从分配到开始处理 |
| **P50 Response Time** | 50th 百分位 response time | 中位数 |
| **P90 Response Time** | 90th 百分位 response time | 长尾指标 |
| **Avg Solve Time** | `mean(solved_at - assigned_at)` | 从分配到解决完成 |
| **P50 / P90 Solve Time** | 百分位 solve time | 分布指标 |
| **Total Issues** | 时间区间内 assigned 的 issue 总数 | 含所有状态 |

---

## 6. 关键风险与决策点

### 6.1 已确认的决策

1. **时间范围默认值**：✅ 30 天。合适，保持不变。
2. **搜索模式**：✅ 不暴露 `--mode` 选项给用户。Manager 只需执行简单的 `ai-issue search <query>` 命令，不需要关心底层用了哪种搜索。内部由系统（AI 辅助）自动判断使用 fuzzy 还是 semantic 搜索。
3. **Metrics 权限**：✅ 仅 Manager 有权限查看 metrics 和执行搜索。**⚠️ 当前未实施**：service 目前无角色系统，所有持有 API key 的用户均可访问。待后续实现 manager-only 权限（方案：独立 `manager_api_key` 配置项）。
4. **语言支持**：✅ 仅英文。Issue 均为英文表述，Manager 也只用英文搜索，无需中文分词支持。
5. **历史数据回填精度**：✅ 已确认。用 `assigned_at = created_at`、`solved_at = updated_at WHERE status='solved'` 回填，标注为近似值。已知局限：手动 triage 场景下 `created_at`（入 pipeline 时间）≠ 实际分配时间，会导致 response time 偏高。Phase 6 上线后通过显式记录 `assigned_at`（在 `assigned_to` 被设置/变更时写入）解决此问题，精确统计从上线日开始。

### 6.2 风险

| 风险 | 影响 | 缓解 |
|------|------|------|
| 历史数据无时间戳 | 早期 metrics 不准 | 回填 + 文档说明 "精确统计从 Phase 6 上线日开始" |
| Semantic 搜索成本 | 每次搜索调用 embedding API | 默认 fuzzy，仅当 fuzzy 结果不足时自动 fallback 到 semantic |
| 终端表格在窄窗口下错位 | 显示体验差 | 检测终端宽度，窄窗口自动切换为 list 模式 |
| solution_summary 提取质量不稳定 | 搜索结果质量下降 | 定义 Markdown heading 规范 + fallback 策略 |
