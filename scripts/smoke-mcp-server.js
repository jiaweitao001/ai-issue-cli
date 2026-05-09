#!/usr/bin/env node
// @ts-check
/**
 * Tiny MCP server used by scripts/claude-mcp-smoke.js to verify that claude's
 * --strict-mcp-config + --permission-mode plan combo actually starts the server
 * AND that the server inherits env vars from the claude process.
 *
 * Behavior:
 *   1. On startup, write { AI_ISSUE_SMOKE_MARKER, pid } to AI_ISSUE_SMOKE_MARKER_FILE.
 *      This proves the env-passing chain (ai-issue → claude → server) AND that
 *      claude actually spawned us in --permission-mode plan.
 *   2. Speak just enough MCP stdio to respond to listTools so claude can discover
 *      a single fake tool. We never need to handle calls — the marker file is the
 *      smoke evidence.
 *
 * The MCP SDK is not a root devDep of ai-issue-cli; we borrow the copy installed
 * under skills/similar-issue-finder/node_modules via createRequire. Run
 * `npm run skills:install` first if the SDK is missing.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

function recordEnv() {
  const file = process.env.AI_ISSUE_SMOKE_MARKER_FILE;
  if (!file) return;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({
      AI_ISSUE_SMOKE_MARKER: process.env.AI_ISSUE_SMOKE_MARKER || null,
      pid: process.pid,
      ts: Date.now()
    }, null, 2));
  } catch (err) {
    process.stderr.write(`[smoke-mcp-server] failed to write marker: ${err.message}\n`);
  }
}

async function main() {
  recordEnv();

  const skillEntry = path.join(__dirname, '..', 'skills', 'similar-issue-finder', 'package.json');
  if (!fs.existsSync(skillEntry)) {
    process.stderr.write(
      '[smoke-mcp-server] cannot find skills/similar-issue-finder/package.json. ' +
      'Run `npm run skills:install` first.\n'
    );
    process.exit(1);
  }
  const skillRequire = createRequire(skillEntry);

  let sdkServer, sdkStdio, sdkTypes;
  try {
    sdkServer = skillRequire('@modelcontextprotocol/sdk/server/index.js');
    sdkStdio = skillRequire('@modelcontextprotocol/sdk/server/stdio.js');
    sdkTypes = skillRequire('@modelcontextprotocol/sdk/types.js');
  } catch (err) {
    process.stderr.write(
      `[smoke-mcp-server] missing @modelcontextprotocol/sdk: ${err.message}\n` +
      'Run `npm run skills:install` first.\n'
    );
    process.exit(1);
  }

  const server = new sdkServer.Server(
    { name: 'env-marker', version: '0.0.1' },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(sdkTypes.ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'env_marker_ping',
        description: 'Smoke-test marker tool — never called, only used to verify discovery.',
        inputSchema: { type: 'object', properties: {} }
      }
    ]
  }));

  server.setRequestHandler(sdkTypes.CallToolRequestSchema, async () => ({
    content: [{ type: 'text', text: 'pong' }]
  }));

  const transport = new sdkStdio.StdioServerTransport();
  await server.connect(transport);
}

main().catch(err => {
  process.stderr.write(`[smoke-mcp-server] fatal: ${err && err.stack || err}\n`);
  process.exit(1);
});
