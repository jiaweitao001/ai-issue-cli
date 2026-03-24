#!/usr/bin/env node
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');

const SERVICE_URL = process.env.AI_ISSUE_SERVICE_URL || 'http://localhost:8000';
const API_KEY = process.env.AI_ISSUE_SERVICE_API_KEY || '';

async function callService(endpoint, body) {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (API_KEY) {
    headers['X-Api-Key'] = API_KEY;
  }

  const response = await fetch(`${SERVICE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Service error ${response.status}: ${text}`);
  }

  return response.json();
}

const server = new Server(
  { name: 'similar-issue-finder', version: '2.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'check_existing_research',
      description: `Check the knowledge base for verified historical solutions from merged PRs.

Use this as the VERY FIRST step in research to see if similar issues have been solved before.
Returns solutions that are verified — they come from actual merged PRs, not AI guesses.

When to use:
- As the first step before any other research
- To find proven fix patterns for similar problems
- To identify which files were changed in similar fixes`,
      inputSchema: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'GitHub repo (e.g., "hashicorp/terraform-provider-azurerm")',
          },
          issue_number: {
            type: 'integer',
            description: 'Current issue number (excluded from results)',
          },
          title: {
            type: 'string',
            description: 'Issue title for semantic search',
          },
          body: {
            type: 'string',
            description: 'Issue body text for semantic search',
          },
          top_k: {
            type: 'integer',
            description: 'Number of results to return (default: 3)',
            default: 3,
          },
        },
        required: ['repo', 'title'],
      },
    },
    {
      name: 'find_similar_issues',
      description: `Search historical GitHub issues to find similar problems and their solutions.

Use this FIRST in research phase to check if the problem has been reported before.
Returns similar issues ranked by similarity score, plus extracted solutions from comments.

When to use:
- At the start of Issue research (Phase 1)
- When you want to find how similar problems were solved before
- When you suspect the issue might be a duplicate or regression`,
      inputSchema: {
        type: 'object',
        properties: {
          repo: {
            type: 'string',
            description: 'GitHub repo (e.g., "hashicorp/terraform-provider-azurerm")',
          },
          issue_number: {
            type: 'integer',
            description: 'Issue number. If the issue is already in the database, uses its stored embedding.',
          },
          title: {
            type: 'string',
            description: 'Issue title. Required if issue_number is not in the database.',
          },
          body: {
            type: 'string',
            description: 'Issue body text.',
          },
          top_k: {
            type: 'integer',
            description: 'Number of similar issues to return (default: 5)',
            default: 5,
          },
          include_solutions: {
            type: 'boolean',
            description: 'Whether to extract solutions from similar issue comments (default: true)',
            default: true,
          },
        },
        required: ['repo'],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const toolName = request.params.name;
  const args = request.params.arguments;

  if (toolName === 'check_existing_research') {
    try {
      const result = await callService('/knowledge/find', {
        repo: args.repo,
        issue_number: args.issue_number,
        title: args.title,
        body: args.body,
        top_k: args.top_k || 3,
      });

      let output = '';
      if (!Array.isArray(result) || result.length === 0) {
        output = 'No verified historical solutions found for similar issues.\n';
      } else {
        output = `## Verified Historical Solutions Found: ${result.length}\n\n`;
        for (const r of result) {
          output += `### Issue #${r.issue}: ${r.issue_title} (relevance: ${r.score})\n`;
          output += `- **PR**: ${r.pr_url}\n`;
          output += `- **Changed files**: ${r.changed_files.join(', ')}\n`;
          output += `- **Matched on**: ${r.matched_text}\n\n`;
        }
        output += `\n> These are verified solutions from merged PRs. Use them as reference for your implementation.\n`;
      }

      return { content: [{ type: 'text', text: output }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `⚠️ Knowledge base search failed: ${error.message}\nProceeding without historical knowledge.` }],
        isError: true,
      };
    }
  }

  if (toolName === 'find_similar_issues') {
    try {
      const result = await callService('/search', {
        repo: args.repo,
        issue_number: args.issue_number,
        title: args.title,
        body: args.body,
        top_k: args.top_k || 5,
        include_solutions: args.include_solutions !== false,
      });

      // 格式化为可读文本
      let output = `## Similar Issues Found: ${result.similar_issues.length}\n\n`;

      if (result.similar_issues.length === 0) {
        output += 'No similar issues found above the similarity threshold.\n';
      } else {
        for (const issue of result.similar_issues) {
          output += `### #${issue.issue} (score: ${issue.score})\n`;
          output += `- **Title**: ${issue.title}\n`;
          output += `- **URL**: ${issue.url}\n`;
          output += `- **State**: ${issue.state}\n`;
          output += `- **Labels**: ${issue.labels.join(', ') || 'none'}\n`;
          output += `- **Created**: ${issue.created_at}\n\n`;
        }
      }

      if (result.solutions && result.solutions.length > 0) {
        output += `## Extracted Solutions\n\n`;
        for (let i = 0; i < result.solutions.length; i++) {
          const sol = result.solutions[i];
          output += `### Solution ${i + 1}\n${sol.solution}\n`;
          if (sol.reference.length > 0) {
            output += `**References**: ${sol.reference.join(', ')}\n`;
          }
          output += '\n';
        }
      }

      return { content: [{ type: 'text', text: output }] };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `⚠️ Similar issue search failed: ${error.message}\nProceeding without historical issue context.` }],
        isError: true,
      };
    }
  }

  throw new Error(`Unknown tool: ${toolName}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
