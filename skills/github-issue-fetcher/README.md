# GitHub Issue Fetcher

MCP Server for fetching structured GitHub issue context.

## Features

- Fetch issue title, body, state, labels
- Fetch comments (paginated, role-prioritized truncation, max 20 returned)
- Fetch timeline events
- Fetch linked PRs with code diff (truncated to 4000 chars)
- Structured rate-limit errors carry `reset_at` / `retry_after_seconds`

## Context-Budget Caps

The skill enforces caps to keep MCP tool output within the LLM context budget
(see `docs/SKILLS_ENHANCEMENT_PLAN.md`):

| Cap | Value | Notes |
|---|---|---|
| Comments returned (total) | 20 | Hard cap |
| Comments from elevated roles (OWNER / MEMBER / COLLABORATOR) | up to 15 | Surplus quota goes to other roles |
| Pagination depth | 5 pages × 100 = 500 | Beyond that, `page_limit_hit=true` and `total_comments` becomes `">N"` |
| PR diff per PR | 4000 chars | Suffix `[diff truncated...]` appended on overflow |

## Installation

```bash
cd skills/github-issue-fetcher
npm install
```

## Configuration

Set your GitHub token as an environment variable:

```bash
export GITHUB_TOKEN=your_token_here
# or
export GH_TOKEN=your_token_here
```

## Usage

### With Copilot CLI

Add to your MCP config (`~/.config/github-copilot/mcp.json`):

```json
{
  "mcpServers": {
    "github-issue-fetcher": {
      "command": "node",
      "args": ["/path/to/skills/github-issue-fetcher/index.js"],
      "env": {
        "GITHUB_TOKEN": "${GITHUB_TOKEN}"
      }
    }
  }
}
```

### Tool: get_issue_context

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| repo | string | Yes | Repository in owner/repo format |
| number | number | Yes | Issue number |
| include | string[] | No | Additional data: comments, timeline, linked_prs |

**Example:**

```json
{
  "repo": "hashicorp/terraform-provider-azurerm",
  "number": 30340,
  "include": ["comments", "linked_prs"]
}
```

**Response:**

```json
{
  "title": "Issue title",
  "body": "Issue description...",
  "state": "open",
  "labels": ["bug", "service/compute"],
  "created_at": "2024-01-15T10:00:00Z",
  "author": "username",
  "url": "https://github.com/...",
  "comments": {
    "total_comments": 42,
    "truncated_count": 22,
    "page_limit_hit": false,
    "included_associations": { "OWNER": 3, "MEMBER": 2, "NONE": 15 },
    "items": [
      {
        "author": "commenter",
        "body": "Comment content...",
        "created_at": "2024-01-16T10:00:00Z",
        "author_association": "OWNER"
      }
    ]
  },
  "linked_prs": [
    {
      "number": 30350,
      "title": "Fix #30340: ...",
      "state": "merged",
      "files_changed": ["file1.go", "file2.go"],
      "diff": "..."
    }
  ]
}
```
