#!/usr/bin/env node
/**
 * GitHub Issue Fetcher - MCP Server
 * 
 * 获取 GitHub Issue 的结构化信息，包括评论、时间线和关联 PR
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const { wrapToolHandler } = require('../../lib/skills-metrics');

// GitHub API 基础配置
const GITHUB_API_BASE = 'https://api.github.com';

// Context-budget caps (see docs/SKILLS_ENHANCEMENT_PLAN.md §3 / §上下文预算契约)
const COMMENT_CAP_TOTAL = 20;
const COMMENT_CAP_ELEVATED = 15;
const PAGINATION_PAGE_LIMIT = 5;
const PAGINATION_PER_PAGE = 100;
const DIFF_TRUNCATE_CHARS = 4000;
const ELEVATED_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

/**
 * 获取 GitHub Token
 */
function getGitHubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

/**
 * Build a structured rate-limit error from an HTTP response.
 * Returns null if the response is not a rate-limit failure.
 */
function buildRateLimitError(response, bodyText) {
  const remaining = response.headers.get('x-ratelimit-remaining');
  const isRateLimited =
    response.status === 429 ||
    (response.status === 403 && remaining === '0');
  if (!isRateLimited) return null;

  const resetUnix = response.headers.get('x-ratelimit-reset');
  const retryAfter = response.headers.get('retry-after');
  const resetAt = resetUnix
    ? new Date(parseInt(resetUnix, 10) * 1000).toISOString()
    : null;
  const retryAfterSeconds = retryAfter
    ? parseInt(retryAfter, 10)
    : (resetUnix ? Math.max(0, parseInt(resetUnix, 10) - Math.floor(Date.now() / 1000)) : null);

  // Bake the meta into the message so MCP clients (which handle the optional
  // `data` field inconsistently) still surface it to the LLM.
  const parts = [
    `GitHub API rate limit hit (status ${response.status}).`,
    resetAt ? `Reset at ${resetAt}.` : null,
    retryAfterSeconds != null ? `Retry after ${retryAfterSeconds}s.` : null,
  ].filter(Boolean);
  const err = new Error(parts.join(' '));
  err.meta = {
    rate_limited: true,
    status: response.status,
    reset_at: resetAt,
    retry_after_seconds: retryAfterSeconds,
  };
  return err;
}

/**
 * Low-level fetch wrapper that returns the Response object so callers can
 * inspect headers (needed for pagination Link header + rate-limit detection).
 *
 * `endpointOrUrl` may be either an API-relative path (e.g. `/repos/x/y/issues`)
 * or an absolute URL returned by GitHub's pagination Link header.
 */
async function githubFetch(endpointOrUrl, token, extraHeaders = {}) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ai-issue-cli-mcp-server',
    ...extraHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const url = /^https?:\/\//i.test(endpointOrUrl)
    ? endpointOrUrl
    : `${GITHUB_API_BASE}${endpointOrUrl}`;
  return fetch(url, { headers });
}

/**
 * 发送 GitHub API 请求并解析为 JSON。
 * Throws structured rate-limit error when applicable.
 */
async function githubRequest(endpoint, token) {
  const response = await githubFetch(endpoint, token);

  if (!response.ok) {
    // Read body once; we may need it both for rate-limit context and the
    // generic error path below.
    const errorBody = await response.text();
    const rlErr = buildRateLimitError(response, errorBody);
    if (rlErr) throw rlErr;
    throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
  }

  return response.json();
}

/**
 * Parse the GitHub `Link` header and return the URL marked rel="next", or null.
 */
function parseNextPageUrl(linkHeader) {
  if (!linkHeader) return null;
  // Link: <https://api.github.com/...?page=2>; rel="next", <...>; rel="last"
  const parts = linkHeader.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

/**
 * Apply role-based truncation per docs/SKILLS_ENHANCEMENT_PLAN.md §3 +
 * plan.md A1.1 v3 algorithm.
 *
 * @param {Array<{author_association: string, created_at: string}>} comments raw comments
 * @returns {{kept: Array, total: number, truncated: number, included_associations: object}}
 */
function applyCommentTruncation(comments) {
  const total = comments.length;
  const sortedDesc = [...comments].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const elevated = sortedDesc.filter((c) =>
    ELEVATED_ASSOCIATIONS.has(c.author_association)
  );
  const others = sortedDesc.filter(
    (c) => !ELEVATED_ASSOCIATIONS.has(c.author_association)
  );

  const elevatedTaken = elevated.slice(0, Math.min(COMMENT_CAP_ELEVATED, elevated.length));
  const remainingQuota = COMMENT_CAP_TOTAL - elevatedTaken.length;
  const othersTaken = others.slice(0, Math.min(remainingQuota, others.length));

  const merged = [...elevatedTaken, ...othersTaken].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const includedAssociations = {};
  for (const c of merged) {
    const key = c.author_association || 'NONE';
    includedAssociations[key] = (includedAssociations[key] || 0) + 1;
  }

  return {
    kept: merged,
    total,
    truncated: Math.max(0, total - merged.length),
    included_associations: includedAssociations,
  };
}

/**
 * 获取 Issue 基本信息
 */
async function fetchIssue(repo, number, token) {
  const data = await githubRequest(`/repos/${repo}/issues/${number}`, token);
  
  return {
    title: data.title,
    body: data.body || '',
    state: data.state,
    labels: data.labels.map(l => l.name),
    created_at: data.created_at,
    author: data.user.login,
    url: data.html_url,
  };
}

/**
 * 获取 Issue 评论
 *
 * - 翻页：以 ?per_page=100 起拉，跟 Link rel="next" 翻页直到无 next
 * - 上限：最多翻 PAGINATION_PAGE_LIMIT 页（默认 5 = 500 条），超过则停止；total 标注 ">N"
 * - 截断：客户端按 author_association 角色优先策略保留 ≤ COMMENT_CAP_TOTAL（默认 20）
 */
async function fetchComments(repo, number, token) {
  const collected = [];
  let nextEndpoint = `/repos/${repo}/issues/${number}/comments?per_page=${PAGINATION_PER_PAGE}`;
  let pageCount = 0;
  let hitPageLimit = false;

  while (nextEndpoint && pageCount < PAGINATION_PAGE_LIMIT) {
    const response = await githubFetch(nextEndpoint, token);
    if (!response.ok) {
      const errorBody = await response.text();
      const rlErr = buildRateLimitError(response, errorBody);
      if (rlErr) throw rlErr;
      throw new Error(`GitHub API error: ${response.status} - ${errorBody}`);
    }
    const pageData = await response.json();
    collected.push(...pageData);
    pageCount += 1;

    const nextUrl = parseNextPageUrl(response.headers.get('link'));
    if (!nextUrl) {
      nextEndpoint = null;
    } else if (pageCount >= PAGINATION_PAGE_LIMIT) {
      hitPageLimit = true;
      nextEndpoint = null;
    } else {
      // githubFetch accepts both relative endpoints and absolute URLs
      nextEndpoint = nextUrl;
    }
  }

  const raw = collected.map((comment) => ({
    author: comment.user?.login,
    body: comment.body,
    created_at: comment.created_at,
    author_association: comment.author_association || 'NONE',
  }));

  const truncation = applyCommentTruncation(raw);

  return {
    total_comments: hitPageLimit ? `>${collected.length}` : truncation.total,
    truncated_count: truncation.truncated + (hitPageLimit ? 1 : 0),
    included_associations: truncation.included_associations,
    page_limit_hit: hitPageLimit,
    items: truncation.kept,
  };
}

/**
 * 获取 Issue 时间线
 */
async function fetchTimeline(repo, number, token) {
  try {
    const data = await githubRequest(`/repos/${repo}/issues/${number}/timeline`, token);
    
    const events = data
      .filter(event => event.event) // 过滤掉没有 event 类型的
      .map(event => ({
        type: event.event,
        actor: event.actor?.login || 'unknown',
        created_at: event.created_at,
        details: getEventDetails(event),
      }));
    
    return {
      total_events: events.length,
      events: events,
    };
  } catch (err) {
    // Timeline API 可能需要特殊权限
    return {
      total_events: 0,
      events: [],
      error: err.message,
    };
  }
}

/**
 * 提取事件详情
 */
function getEventDetails(event) {
  switch (event.event) {
    case 'referenced':
      return event.commit_id ? `Commit: ${event.commit_id.substring(0, 7)}` : null;
    case 'closed':
      return event.commit_id ? `Closed by commit: ${event.commit_id.substring(0, 7)}` : 'Closed';
    case 'labeled':
    case 'unlabeled':
      return event.label?.name;
    case 'cross-referenced':
      return event.source?.issue?.html_url;
    default:
      return null;
  }
}

/**
 * 获取关联的 PR
 */
async function fetchLinkedPRs(repo, number, token) {
  // 通过时间线获取关联的 PR
  const timeline = await githubRequest(`/repos/${repo}/issues/${number}/timeline`, token);
  
  const prNumbers = new Set();
  
  // 从时间线中提取 PR 引用
  for (const event of timeline) {
    if (event.event === 'cross-referenced' && event.source?.issue?.pull_request) {
      prNumbers.add(event.source.issue.number);
    }
  }
  
  // 也检查 Issue body 中的 PR 引用
  const issue = await githubRequest(`/repos/${repo}/issues/${number}`, token);
  const prPattern = /#(\d+)|pull\/(\d+)/g;
  let match;
  while ((match = prPattern.exec(issue.body || '')) !== null) {
    const prNum = match[1] || match[2];
    if (prNum) prNumbers.add(parseInt(prNum));
  }
  
  // 获取每个 PR 的详细信息
  const linkedPRs = [];
  
  for (const prNum of prNumbers) {
    try {
      const pr = await githubRequest(`/repos/${repo}/pulls/${prNum}`, token);
      
      // 只处理真正的 PR（不是 Issue）
      if (pr.merged_at !== undefined) {
        const prInfo = {
          number: pr.number,
          title: pr.title,
          state: pr.merged_at ? 'merged' : pr.state,
          files_changed: [],
        };
        
        // 获取 PR 的文件变更
        try {
          const files = await githubRequest(`/repos/${repo}/pulls/${prNum}/files`, token);
          prInfo.files_changed = files.map(f => f.filename);
          
          // 获取 diff（限制大小）
          const diffResponse = await fetch(`${GITHUB_API_BASE}/repos/${repo}/pulls/${prNum}`, {
            headers: {
              'Accept': 'application/vnd.github.v3.diff',
              'Authorization': token ? `Bearer ${token}` : undefined,
              'User-Agent': 'ai-issue-cli-mcp-server',
            },
          });
          
          if (diffResponse.ok) {
            let diff = await diffResponse.text();
            // 限制 diff 大小，避免上下文过长（plan A1.2: 10000 → 4000）
            if (diff.length > DIFF_TRUNCATE_CHARS) {
              diff = diff.substring(0, DIFF_TRUNCATE_CHARS) + '\n\n... [diff truncated, total length: ' + diff.length + ' characters]';
            }
            prInfo.diff = diff;
          }
        } catch (err) {
          // 忽略文件获取错误
        }
        
        linkedPRs.push(prInfo);
      }
    } catch (err) {
      // 可能是 Issue 而不是 PR，忽略
    }
  }
  
  return linkedPRs;
}

/**
 * 主工具：获取 Issue 上下文
 */
async function getIssueContext(args) {
  const { repo, number, include = [] } = args;
  const token = getGitHubToken();
  
  // 获取基本 Issue 信息
  const issueContext = await fetchIssue(repo, number, token);
  
  // 根据 include 参数获取额外信息
  if (include.includes('comments')) {
    issueContext.comments = await fetchComments(repo, number, token);
  }
  
  if (include.includes('timeline')) {
    issueContext.timeline = await fetchTimeline(repo, number, token);
  }
  
  if (include.includes('linked_prs')) {
    issueContext.linked_prs = await fetchLinkedPRs(repo, number, token);
  }
  
  return issueContext;
}

// 创建 MCP Server
const server = new Server(
  {
    name: 'github-issue-fetcher',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 注册工具列表
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'get_issue_context',
        description: `获取 GitHub Issue 的结构化信息。

功能：
- 获取 Issue 标题、正文、状态、标签等基本信息
- 可选：获取所有评论内容
- 可选：获取时间线事件
- 可选：获取关联 PR 的代码变更

使用场景：
- 研究阶段：获取 Issue 完整上下文
- 评估阶段：获取关联 PR 代码用于对比`,
        inputSchema: {
          type: 'object',
          properties: {
            repo: {
              type: 'string',
              description: '仓库名称，格式为 owner/repo，例如 "hashicorp/terraform-provider-azurerm"',
            },
            number: {
              type: 'number',
              description: 'Issue 编号',
            },
            include: {
              type: 'array',
              items: { type: 'string' },
              description: '可选的额外信息：comments（评论）、timeline（时间线）、linked_prs（关联PR及代码）',
            },
          },
          required: ['repo', 'number'],
        },
      },
    ],
  };
});

// 处理工具调用
async function handleToolRequest(request) {
  const { name, arguments: args } = request.params;

  if (name === 'get_issue_context') {
    try {
      const result = await getIssueContext(args);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text',
            text: `Error fetching issue context: ${error.message}`,
          },
        ],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${name}`);
}

server.setRequestHandler(CallToolRequestSchema, wrapToolHandler(handleToolRequest, 'github-issue-fetcher'));

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GitHub Issue Fetcher MCP Server running on stdio');
}

if (require.main === module) {
  main().catch(console.error);
}

// Exports for unit tests (not used by MCP runtime)
module.exports = {
  applyCommentTruncation,
  parseNextPageUrl,
  buildRateLimitError,
  fetchComments,
  __constants: {
    COMMENT_CAP_TOTAL,
    COMMENT_CAP_ELEVATED,
    PAGINATION_PAGE_LIMIT,
    PAGINATION_PER_PAGE,
    DIFF_TRUNCATE_CHARS,
  },
};
