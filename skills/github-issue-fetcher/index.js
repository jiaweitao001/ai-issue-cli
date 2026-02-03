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

// GitHub API 基础配置
const GITHUB_API_BASE = 'https://api.github.com';

/**
 * 获取 GitHub Token
 */
function getGitHubToken() {
  return process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
}

/**
 * 发送 GitHub API 请求
 */
async function githubRequest(endpoint, token) {
  const headers = {
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'ai-issue-cli-mcp-server',
  };
  
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  
  const response = await fetch(`${GITHUB_API_BASE}${endpoint}`, { headers });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`GitHub API error: ${response.status} - ${error}`);
  }
  
  return response.json();
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
 */
async function fetchComments(repo, number, token) {
  const data = await githubRequest(`/repos/${repo}/issues/${number}/comments`, token);
  
  return data.map(comment => ({
    author: comment.user.login,
    body: comment.body,
    created_at: comment.created_at,
  }));
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
            // 限制 diff 大小，避免上下文过长
            if (diff.length > 10000) {
              diff = diff.substring(0, 10000) + '\n\n... [diff truncated, total length: ' + diff.length + ' characters]';
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
server.setRequestHandler(CallToolRequestSchema, async (request) => {
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
});

// 启动服务器
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('GitHub Issue Fetcher MCP Server running on stdio');
}

main().catch(console.error);
