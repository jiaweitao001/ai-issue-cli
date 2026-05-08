# similar-issue-finder

MCP server for finding similar GitHub issues via a local knowledge base or ai-issue-service.

## Usage

This skill is used by `ai-issue-cli` during Phase 1 research to find historical similar issues and their solutions.

### Tool: `find_similar_issues`

Searches for issues similar to the current one, and optionally extracts solutions from their comments.

### Environment Variables

- `AI_ISSUE_KB_PATH` — Local knowledge base directory. When present and valid, this is preferred first.
- `AI_ISSUE_KB_PREFER_LOCAL` — Set to `false` to force cloud lookup even when a local KB passes quality checks; set to `true` to prefer local when a KB is present.
- `AI_ISSUE_SERVICE_URL` — Backend service URL. Used when no preferred local KB is available.
- `AI_ISSUE_SERVICE_API_KEY` — API key for authentication

Lookup precedence is:

1. `AI_ISSUE_KB_PATH` local KB when present, loadable, and preferred.
2. `AI_ISSUE_SERVICE_URL` cloud service.
3. Deterministic empty results without making a network request.
