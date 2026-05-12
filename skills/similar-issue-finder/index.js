#!/usr/bin/env node
// @ts-check
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const { LocalKnowledgeBase } = require('../../lib/local-knowledge-base');
const { wrapToolHandler } = require('../../lib/skills-metrics');

const KB_PATH = process.env.AI_ISSUE_KB_PATH || '';
const SERVICE_URL = process.env.AI_ISSUE_SERVICE_URL || '';
const API_KEY = process.env.AI_ISSUE_SERVICE_API_KEY || '';

let localKb = null;
let localKbLoadPromise = null;

function warnLocalKbFailure(error) {
  const code = error && error.code ? error.code : 'UNKNOWN';
  const message = error && error.message ? error.message : String(error);
  console.error(`[similar-issue-finder] local knowledge base disabled (${code}): ${message}`);
}

if (KB_PATH && fs.existsSync(KB_PATH)) {
  try {
    localKb = new LocalKnowledgeBase(KB_PATH, { env: process.env });
  } catch (error) {
    warnLocalKbFailure(error);
    localKb = null;
  }
}

function deterministicEmpty() {
  return {
    content: [{
      type: 'text',
      text: 'No knowledge base or service URL configured. Skipping similar-issue lookup.'
    }]
  };
}

/**
 * @returns {Promise<any>}
 */
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

async function getLocalKb() {
  if (!localKb) return null;

  try {
    if (!localKb.manifest || !localKb.entries) {
      if (!localKbLoadPromise) {
        localKbLoadPromise = localKb.load();
      }
      await localKbLoadPromise;
    }
    return localKb;
  } catch (error) {
    warnLocalKbFailure(error);
    localKb = null;
    return null;
  } finally {
    localKbLoadPromise = null;
  }
}

function detectResourceType(title, body) {
  const match = `${title || ''}\n${body || ''}`.match(/\bazurerm_[a-z0-9_]+\b/i);
  return match ? match[0].toLowerCase() : undefined;
}

function detectService(labels) {
  if (!Array.isArray(labels)) return undefined;
  const serviceLabel = labels.find(label => /^service\//.test(String(label)));
  return serviceLabel ? String(serviceLabel).slice('service/'.length) : undefined;
}

function formatLocalResults(results) {
  if (!Array.isArray(results) || results.length === 0) {
    return {
      content: [{ type: 'text', text: 'No similar issues found in local knowledge base.' }]
    };
  }

  let output = `## Similar Issues Found in Local Knowledge Base: ${results.length}\n\n`;
  for (const result of results) {
    output += `### Issue #${result.issue_number}: ${result.title} (score: ${result.score})\n`;
    if (result.pr_url) output += `- **PR**: ${result.pr_url}\n`;
    if (result.solution_summary) output += `- **Solution**: ${result.solution_summary}\n`;
    if (result.resource_type) output += `- **Resource**: ${result.resource_type}\n`;
    if (result.service) output += `- **Service**: ${result.service}\n`;
    output += '\n';
  }

  return { content: [{ type: 'text', text: output }] };
}

async function tryLocalResults(args, action) {
  const kb = await getLocalKb();
  if (!kb || !kb.shouldPreferLocal()) return null;

  try {
    return formatLocalResults(await action(kb));
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    console.error(`[similar-issue-finder] local knowledge base lookup failed: ${message}`);
    return null;
  }
}

const server = new Server(
  { name: 'similar-issue-finder', version: '0.9.0' },
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

async function checkExistingResearch(args) {
  const localResult = await tryLocalResults(args, kb => kb.checkExistingResearch(args.title, args.body));
  if (localResult) return localResult;

  if (!SERVICE_URL) return deterministicEmpty();

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

async function findSimilarIssues(args) {
  const localResult = await tryLocalResults(args, kb => kb.findSimilarIssues(`${args.title || ''}\n${args.body || ''}`, {
    resourceType: detectResourceType(args.title, args.body),
    service: detectService(args.labels),
    labels: args.labels,
    limit: args.top_k || 5,
  }));
  if (localResult) return localResult;

  if (!SERVICE_URL) return deterministicEmpty();

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

async function handleToolRequest(request) {
  const toolName = request.params.name;
  const args = request.params.arguments;

  if (toolName === 'check_existing_research') {
    return checkExistingResearch(args);
  }

  if (toolName === 'find_similar_issues') {
    return findSimilarIssues(args);
  }

  throw new Error(`Unknown tool: ${toolName}`);
}

server.setRequestHandler(CallToolRequestSchema, wrapToolHandler(handleToolRequest, 'similar-issue-finder'));

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  handlers: {
    checkExistingResearch,
    findSimilarIssues,
    handleToolRequest
  },
  deterministicEmpty,
  formatLocalResults
};
