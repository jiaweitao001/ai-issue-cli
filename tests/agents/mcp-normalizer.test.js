const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeMcpConfigForClaude,
  expandMcpEnv,
  writeClaudeMcpConfig,
  cleanupTempMcpConfig
} = require('../../lib/agents/mcp-normalizer');

describe('mcp-normalizer', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('removes Copilot-only fields, resolves relative args, and expands env', () => {
    const sourcePath = path.join(tempDir, 'mcp.json');
    fs.writeFileSync(sourcePath, JSON.stringify({
      mcpServers: {
        server: {
          command: 'node',
          args: ['../skills/server.js', '--flag'],
          tools: ['*'],
          env: {
            TOKEN: '${TOKEN}',
            INLINE: 'prefix-${TOKEN}',
            MISSING: '${MISSING}'
          }
        }
      }
    }));

    const normalized = normalizeMcpConfigForClaude(sourcePath, {
      runtimeEnv: { TOKEN: 'secret' }
    });

    expect(normalized).toEqual({
      mcpServers: {
        server: {
          command: 'node',
          args: [path.resolve(tempDir, '../skills/server.js'), '--flag'],
          env: {
            TOKEN: 'secret',
            INLINE: 'prefix-secret',
            MISSING: ''
          }
        }
      }
    });
    expect(normalized.mcpServers.server).not.toHaveProperty('tools');
    expect(normalized.mcpServers.server.env.MISSING).not.toBe('undefined');
  });

  it('keeps env isolated per server and omits missing env field', () => {
    const sourcePath = path.join(tempDir, 'mcp.json');
    fs.writeFileSync(sourcePath, JSON.stringify({
      mcpServers: {
        withEnv: {
          command: 'node',
          env: { A: '${A}' }
        },
        withoutEnv: {
          command: 'node'
        }
      }
    }));

    const normalized = normalizeMcpConfigForClaude(sourcePath, {
      runtimeEnv: { A: 'one' }
    });

    expect(normalized.mcpServers.withEnv.env).toEqual({ A: 'one' });
    expect(normalized.mcpServers.withoutEnv).not.toHaveProperty('env');
  });

  it('expands MCP env values without producing undefined strings', () => {
    const expanded = expandMcpEnv({
      EXACT: '${A}',
      INLINE: '${A}-${B}',
      MISSING: '${MISSING}',
      NUMBER: 42,
      BOOL: false,
      NULLISH: null,
      UNDEFINED: undefined
    }, {
      A: 'alpha',
      B: 'beta'
    });

    expect(expanded).toEqual({
      EXACT: 'alpha',
      INLINE: 'alpha-beta',
      MISSING: '',
      NUMBER: '42',
      BOOL: 'false',
      NULLISH: '',
      UNDEFINED: ''
    });
    expect(expanded.MISSING).not.toBe('undefined');
  });

  it('writes temp config with private file permissions and cleans it up', () => {
    const filePath = writeClaudeMcpConfig({ mcpServers: {} });
    const dirPath = path.dirname(filePath);

    expect(fs.existsSync(filePath)).toBe(true);
    expect(path.basename(filePath)).toBe('mcp.json');
    expect((fs.statSync(filePath).mode & 0o777)).toBe(0o600);

    cleanupTempMcpConfig(filePath);

    expect(fs.existsSync(filePath)).toBe(false);
    expect(fs.existsSync(dirPath)).toBe(false);
  });
});
