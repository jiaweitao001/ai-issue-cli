# Code Similarity Finder

MCP Server for finding similar code implementations in a repository.

## Features

- Analyze Go file structure (CRUD functions, Schema fields, imports)
- Calculate similarity scores between files
- Identify key differences
- Configurable search scope

## Installation

```bash
cd skills/code-similarity-finder
npm install
```

## Usage

### With Copilot CLI

Add to your MCP config (`~/.config/github-copilot/mcp.json`):

```json
{
  "mcpServers": {
    "code-similarity-finder": {
      "command": "node",
      "args": ["/path/to/skills/code-similarity-finder/index.js"]
    }
  }
}
```

### Tool: find_similar_implementations

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| file_path | string | Yes | Absolute path to the target file |
| scope | string | No | Search scope: directory, service, repo |
| limit | number | No | Maximum results to return (default: 5) |

**Example:**

```json
{
  "file_path": "/path/to/internal/services/compute/virtual_machine_resource.go",
  "scope": "service",
  "limit": 5
}
```

**Response:**

```json
{
  "target_file": "/path/to/virtual_machine_resource.go",
  "target_features": {
    "resource_type": "virtual_machine",
    "has_crud": {
      "create": true,
      "read": true,
      "update": true,
      "delete": true
    },
    "schema_fields_count": 25
  },
  "search_scope": "service",
  "files_analyzed": 42,
  "similar_files": [
    {
      "path": "/path/to/virtual_machine_scale_set_resource.go",
      "similarity_score": 0.85,
      "summary": "virtual_machine_scale_set resource with 30 schema fields",
      "key_differences": [
        "Fields only in similar: instances, upgrade_policy"
      ]
    }
  ],
  "recommendation": "Recommend referencing /path/to/virtual_machine_scale_set_resource.go (similarity: 85%)"
}
```

## Similarity Scoring

The similarity score is calculated based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| CRUD pattern | 20% | Presence of Create/Read/Update/Delete functions |
| Schema fields | 30% | Overlap of schema field names |
| Imports | 20% | Shared import packages |
| Function names | 15% | Common function naming patterns |
| Resource type | 15% | Same service/resource family |

## Supported Languages

Currently supports:
- Go (.go files)

Future support planned for:
- HCL (Terraform configurations)
- TypeScript
