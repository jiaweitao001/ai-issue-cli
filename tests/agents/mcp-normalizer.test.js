const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  normalizeMcpConfigForClaude,
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

  it('removes Copilot-only fields and resolves relative args', () => {
    const sourcePath = path.join(tempDir, 'mcp.json');
    fs.writeFileSync(sourcePath, JSON.stringify({
      mcpServers: {
        server: {
          command: 'node',
          args: ['../skills/server.js', '--flag'],
          tools: ['*'],
          env: { TOKEN: '${TOKEN}' }
        }
      }
    }));

    const normalized = normalizeMcpConfigForClaude(sourcePath);

    expect(normalized).toEqual({
      mcpServers: {
        server: {
          command: 'node',
          args: [path.resolve(tempDir, '../skills/server.js'), '--flag']
        }
      }
    });
    expect(normalized.mcpServers.server).not.toHaveProperty('tools');
    expect(normalized.mcpServers.server).not.toHaveProperty('env');
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
