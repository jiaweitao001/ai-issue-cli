// @ts-check

const fs = require('fs');
const os = require('os');
const path = require('path');
const { getMcpConfigPath } = require('../copilot');

const TEMP_CONFIGS = new Map();

/**
 * @param {string} arg
 * @param {string} configDir
 * @returns {string}
 */
function normalizeArg(arg, configDir) {
  if (arg.startsWith('./') || arg.startsWith('../')) {
    return path.resolve(configDir, arg);
  }
  return arg;
}

/**
 * @param {string} sourcePath
 * @returns {{ mcpServers: Record<string, { command: string, args?: string[] }> }}
 */
function normalizeMcpConfigForClaude(sourcePath) {
  const configDir = path.dirname(sourcePath);
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const normalized = { mcpServers: {} };

  for (const [name, server] of Object.entries(source.mcpServers || {})) {
    normalized.mcpServers[name] = {
      command: server.command
    };
    if (Array.isArray(server.args)) {
      normalized.mcpServers[name].args = server.args.map(arg => normalizeArg(arg, configDir));
    }
  }

  return normalized;
}

/**
 * @param {string} filePath
 */
function safeUnlink(filePath) {
  try {
    fs.unlinkSync(filePath);
  } catch (_err) {}
}

/**
 * @param {string} dirPath
 */
function safeRmdir(dirPath) {
  try {
    fs.rmdirSync(dirPath);
  } catch (_err) {}
}

/**
 * @param {string} filePath
 */
function cleanupTempMcpConfig(filePath) {
  const dirPath = TEMP_CONFIGS.get(filePath) || path.dirname(filePath);
  safeUnlink(filePath);
  safeRmdir(dirPath);
  TEMP_CONFIGS.delete(filePath);
}

/**
 * @param {string} filePath
 * @param {string} dirPath
 */
function registerCleanup(filePath, dirPath) {
  TEMP_CONFIGS.set(filePath, dirPath);
}

process.once('exit', () => {
  for (const filePath of Array.from(TEMP_CONFIGS.keys())) {
    cleanupTempMcpConfig(filePath);
  }
});

/**
 * @param {object} normalized
 * @returns {string}
 */
function writeClaudeMcpConfig(normalized, options = {}) {
  const dirPath = fs.mkdtempSync(path.join(os.tmpdir(), 'ai-issue-mcp-'));
  try {
    fs.chmodSync(dirPath, 0o700);
  } catch (_err) {}

  const filePath = path.join(dirPath, 'mcp.json');
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx'
  });
  if (options.registerForExit !== false) {
    registerCleanup(filePath, dirPath);
  }
  return filePath;
}

/**
 * @param {'phase1'|'phase2'|'evaluate'|null} mcpProfile
 * @param {{ debugMode?: boolean }} [options]
 * @returns {string|null}
 */
function toClaudeMcpConfigFile(mcpProfile, options = {}) {
  const sourcePath = getMcpConfigPath(mcpProfile);
  if (!sourcePath) return null;
  return writeClaudeMcpConfig(normalizeMcpConfigForClaude(sourcePath), {
    registerForExit: !options.debugMode
  });
}

module.exports = {
  normalizeMcpConfigForClaude,
  writeClaudeMcpConfig,
  toClaudeMcpConfigFile,
  cleanupTempMcpConfig
};
