# similar-issue-finder

MCP server for finding similar GitHub issues via ai-issue-service.

## Usage

This skill is used by `ai-issue-cli` during Phase 1 research to find historical similar issues and their solutions.

### Tool: `find_similar_issues`

Searches the ai-issue-service backend for issues similar to the current one, and optionally extracts solutions from their comments.

### Environment Variables

- `AI_ISSUE_SERVICE_URL` — Backend service URL. When unset, the skill returns empty results without making a network request.
- `AI_ISSUE_SERVICE_API_KEY` — API key for authentication
