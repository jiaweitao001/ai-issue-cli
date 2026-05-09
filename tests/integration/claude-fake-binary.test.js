// @ts-check
/**
 * Integration test (PHASE5B_SPEC §4.3 line 600 + §13.3=A):
 *
 * Writes a fake `claude` binary onto PATH and runs ClaudeCodeAgent against it
 * WITHOUT mocking child_process. Asserts that the binary is invoked with the
 * full args / cwd / stdin / env contract documented in the spec. Also reads
 * the on-disk MCP config file from inside the fake binary to verify the
 * mcp-normalizer wrote absolute paths and stripped Copilot-only fields.
 *
 * This file complements (does not replace) tests/agents/claude-code-agent.test.js
 * — that one uses jest.mock('child_process') and exercises the agent's
 * code paths in isolation; this one exercises the actual cross-process boundary.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { ClaudeCodeAgent } = require('../../lib/agents/claude-code-agent');

describe('integration: ClaudeCodeAgent against PATH-installed fake claude', () => {
  let scratchDir;
  let invocationLog;
  let originalPath;
  let originalServiceUrl;
  let originalServiceApiKey;
  let originalKbPath;
  let repoPath;

  beforeAll(() => {
    scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-fake-claude-'));
    invocationLog = path.join(scratchDir, 'invocation.json');

    // Fake `claude` binary: a Node script that captures args / stdin / cwd /
    // selected env vars / mcp-config contents into a JSON file. Written to a
    // temp dir that gets prepended to PATH, so spawn('claude', ...) resolves
    // here instead of any system-installed Claude binary.
    const fakeClaude = `#!/usr/bin/env node
const fs = require('fs');
let stdin = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { stdin += d; });
process.stdin.on('end', () => {
  const args = process.argv.slice(2);
  const mcpIdx = args.indexOf('--mcp-config');
  let mcpConfigContent = null;
  if (mcpIdx >= 0 && args[mcpIdx + 1]) {
    try {
      mcpConfigContent = fs.readFileSync(args[mcpIdx + 1], 'utf8');
    } catch (e) {
      mcpConfigContent = 'read-error: ' + e.message;
    }
  }
  const dump = {
    args,
    stdin,
    cwd: process.cwd(),
    env: {
      AI_ISSUE_SERVICE_URL: process.env.AI_ISSUE_SERVICE_URL || null,
      AI_ISSUE_SERVICE_API_KEY: process.env.AI_ISSUE_SERVICE_API_KEY || null,
      AI_ISSUE_KB_PATH: process.env.AI_ISSUE_KB_PATH || null,
      GITHUB_TOKEN: process.env.GITHUB_TOKEN || null
    },
    mcpConfigContent
  };
  fs.writeFileSync(process.env.AI_ISSUE_FAKE_CLAUDE_LOG, JSON.stringify(dump, null, 2));
  process.stdout.write('<artifact path="stdout">fake-claude-stdout</artifact>');
  process.exit(0);
});
`;
    const fakeBinary = path.join(scratchDir, 'claude');
    fs.writeFileSync(fakeBinary, fakeClaude, { mode: 0o755 });

    originalPath = process.env.PATH;
    process.env.PATH = `${scratchDir}${path.delimiter}${originalPath}`;

    originalServiceUrl = process.env.AI_ISSUE_SERVICE_URL;
    originalServiceApiKey = process.env.AI_ISSUE_SERVICE_API_KEY;
    originalKbPath = process.env.AI_ISSUE_KB_PATH;
    delete process.env.AI_ISSUE_SERVICE_URL;
    delete process.env.AI_ISSUE_SERVICE_API_KEY;
    delete process.env.AI_ISSUE_KB_PATH;
    process.env.AI_ISSUE_FAKE_CLAUDE_LOG = invocationLog;

    // Real git repo: git-policy snapshot calls real git via runGitArgs.
    repoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-fake-claude-repo-'));
    execSync(
      'git init -q && git config user.email t@t && git config user.name t && git commit --allow-empty -q -m init',
      { cwd: repoPath, shell: '/bin/bash' }
    );
  });

  afterAll(() => {
    process.env.PATH = originalPath;
    if (originalServiceUrl === undefined) delete process.env.AI_ISSUE_SERVICE_URL;
    else process.env.AI_ISSUE_SERVICE_URL = originalServiceUrl;
    if (originalServiceApiKey === undefined) delete process.env.AI_ISSUE_SERVICE_API_KEY;
    else process.env.AI_ISSUE_SERVICE_API_KEY = originalServiceApiKey;
    if (originalKbPath === undefined) delete process.env.AI_ISSUE_KB_PATH;
    else process.env.AI_ISSUE_KB_PATH = originalKbPath;
    delete process.env.AI_ISSUE_FAKE_CLAUDE_LOG;
    fs.rmSync(scratchDir, { recursive: true, force: true });
    fs.rmSync(repoPath, { recursive: true, force: true });
  });

  beforeEach(() => {
    if (fs.existsSync(invocationLog)) fs.unlinkSync(invocationLog);
  });

  function readCaptured() {
    expect(fs.existsSync(invocationLog)).toBe(true);
    return JSON.parse(fs.readFileSync(invocationLog, 'utf8'));
  }

  it('passes the documented args / cwd / stdin / env contract (no mcp profile)', async () => {
    const agent = new ClaudeCodeAgent({
      agent: 'claude-code',
      serviceUrl: 'https://service.example.com',
      serviceApiKey: 'service-secret-from-config',
      knowledgeBasePath: '/var/kb',
      agents: { 'claude-code': { model: 'sonnet' } }
    });

    const result = await agent.runTask({
      taskType: 'research',
      prompt: 'Hello Claude from integration test',
      repoPath,
      reportPath: repoPath, // same → no --add-dir
      mcpProfile: null,
      permissionProfile: 'read-only',
      gitPolicy: { commitBehavior: 'no-commit' },
      expectedArtifacts: [{ kind: 'stdout', path: 'stdout' }],
      silent: true
    });

    const captured = readCaptured();

    expect(captured.args).toContain('--print');
    const modelIdx = captured.args.indexOf('--model');
    expect(modelIdx).toBeGreaterThanOrEqual(0);
    expect(captured.args[modelIdx + 1]).toBe('sonnet');

    const permIdx = captured.args.indexOf('--permission-mode');
    expect(permIdx).toBeGreaterThanOrEqual(0);
    expect(captured.args[permIdx + 1]).toBe('plan');

    expect(captured.args).not.toContain('--mcp-config');
    expect(captured.args).not.toContain('--strict-mcp-config');

    expect(captured.cwd).toBe(fs.realpathSync(repoPath));
    expect(captured.stdin).toContain('Hello Claude from integration test');

    expect(captured.env.AI_ISSUE_SERVICE_URL).toBe('https://service.example.com');
    expect(captured.env.AI_ISSUE_SERVICE_API_KEY).toBe('service-secret-from-config');
    expect(captured.env.AI_ISSUE_KB_PATH).toBe('/var/kb');

    expect(result.success).toBe(true);
    expect(result.artifacts.stdout).toContain('fake-claude-stdout');
  });

  it('passes --mcp-config <abspath> + --strict-mcp-config and writes a normalized MCP config', async () => {
    const agent = new ClaudeCodeAgent({
      agent: 'claude-code',
      agents: { 'claude-code': { model: 'sonnet' } }
    });

    const result = await agent.runTask({
      taskType: 'research',
      prompt: 'verify mcp wiring',
      repoPath,
      reportPath: repoPath,
      mcpProfile: 'phase1',
      permissionProfile: 'read-only',
      gitPolicy: { commitBehavior: 'no-commit' },
      expectedArtifacts: [{ kind: 'stdout', path: 'stdout' }],
      silent: true
    });

    const captured = readCaptured();
    const mcpIdx = captured.args.indexOf('--mcp-config');
    expect(mcpIdx).toBeGreaterThanOrEqual(0);
    const mcpPath = captured.args[mcpIdx + 1];
    expect(path.isAbsolute(mcpPath)).toBe(true);
    expect(captured.args).toContain('--strict-mcp-config');

    // The fake binary read the MCP config file before the agent's finally
    // block deleted it. Verify the content invariants the spec requires:
    //   - tools: ['*'] is stripped (Copilot-only field)
    //   - relative ../skills/... paths are resolved to absolute paths
    expect(captured.mcpConfigContent).toBeTruthy();
    const mcp = JSON.parse(captured.mcpConfigContent);
    expect(mcp.mcpServers).toBeTruthy();
    for (const [name, server] of Object.entries(mcp.mcpServers)) {
      expect(server).not.toHaveProperty('tools');
      if (Array.isArray(server.args)) {
        for (const arg of server.args) {
          if (typeof arg === 'string' && (arg.startsWith('./') || arg.startsWith('../'))) {
            throw new Error(`MCP server ${name} has unresolved relative arg: ${arg}`);
          }
        }
      }
    }

    expect(result.success).toBe(true);
  });

  it('uses --add-dir when reportPath differs from repoPath', async () => {
    const reportPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-fake-claude-reports-'));
    try {
      const agent = new ClaudeCodeAgent({
        agent: 'claude-code',
        agents: { 'claude-code': { model: 'sonnet' } }
      });

      await agent.runTask({
        taskType: 'research',
        prompt: 'x',
        repoPath,
        reportPath,
        mcpProfile: null,
        permissionProfile: 'read-only',
        gitPolicy: { commitBehavior: 'no-commit' },
        expectedArtifacts: [{ kind: 'stdout', path: 'stdout' }],
        silent: true
      });

      const captured = readCaptured();
      const idx = captured.args.indexOf('--add-dir');
      expect(idx).toBeGreaterThanOrEqual(0);
      expect(captured.args[idx + 1]).toBe(reportPath);
    } finally {
      fs.rmSync(reportPath, { recursive: true, force: true });
    }
  });

  it('uses bypassPermissions for noninteractive-full-auto profile', async () => {
    const agent = new ClaudeCodeAgent({
      agent: 'claude-code',
      agents: { 'claude-code': { model: 'sonnet' } }
    });

    await agent.runTask({
      taskType: 'research',
      prompt: 'x',
      repoPath,
      reportPath: repoPath,
      mcpProfile: null,
      permissionProfile: 'noninteractive-full-auto',
      gitPolicy: { commitBehavior: 'no-commit' },
      expectedArtifacts: [{ kind: 'stdout', path: 'stdout' }],
      silent: true
    });

    const captured = readCaptured();
    const permIdx = captured.args.indexOf('--permission-mode');
    expect(permIdx).toBeGreaterThanOrEqual(0);
    expect(captured.args[permIdx + 1]).toBe('bypassPermissions');
  });
});
