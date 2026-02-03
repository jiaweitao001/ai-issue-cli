# GitHub Issue Fetcher

MCP Server for fetching structured GitHub issue context.

## Features

- Fetch issue title, body, state, labels
- Fetch all comments
- Fetch timeline events
- Fetch linked PRs with code diff

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
  "comments": [
    {
      "author": "commenter",
      "body": "Comment content...",
      "created_at": "2024-01-16T10:00:00Z"
    }
  ],
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
