/**
 * Configuration management
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { success, warning, error } = require('./logger');

// Version information - read from package.json
const VERSION = require('../package.json').version;

// Default configuration - no longer contains hardcoded user paths
const DEFAULT_CONFIG = {
  repoPath: process.env.AI_ISSUE_REPO_PATH || '', // Must be set by user
  reportPath: process.env.AI_ISSUE_REPORT_PATH || path.join(os.homedir(), '.ai-issue', 'reports'),
  agent: process.env.AI_ISSUE_AGENT || 'copilot',
  model: process.env.AI_ISSUE_MODEL || 'claude-sonnet-4.5',
  logLevel: process.env.AI_ISSUE_LOG_LEVEL || 'info',
  issueBaseUrl: process.env.AI_ISSUE_BASE_URL || 'https://github.com/hashicorp/terraform-provider-azurerm/issues',
  serviceUrl: process.env.AI_ISSUE_SERVICE_URL || '',
  serviceApiKey: process.env.AI_ISSUE_SERVICE_API_KEY || '',
  // updateChannel controls how `ai-issue update` resolves the upstream target.
  //   'auto' (default): link install -> branch HEAD; copy install -> latest semver release tag.
  //   'tag'           : always track latest semver release tag.
  //   'branch'        : always track current branch HEAD.
  // See docs/UPDATE_COMMAND_PROPOSAL.md §4.3.1.
  updateChannel: process.env.AI_ISSUE_UPDATE_CHANNEL || 'auto'
};

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.ai-issue');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Validate configuration
function validateConfig(config) {
  const errors = [];

  const supportedAgents = ['copilot'];
  const agent = config.agent || 'copilot';
  if (!supportedAgents.includes(agent)) {
    errors.push(`Unknown agent: ${agent}. Available agents: ${supportedAgents.join(', ')}`);
  }

  // Check repoPath
  if (!config.repoPath) {
    errors.push('repoPath is not set');
  } else if (!fs.existsSync(config.repoPath)) {
    errors.push(`repoPath does not exist: ${config.repoPath}`);
  } else {
    // Check if it's a git repository
    try {
      execSync('git rev-parse --git-dir', {
        cwd: config.repoPath,
        stdio: 'pipe'
      });
    } catch (e) {
      errors.push(`repoPath is not a git repository: ${config.repoPath}`);
    }
  }
  
  // Check issueBaseUrl
  if (!config.issueBaseUrl) {
    errors.push('issueBaseUrl is not set');
  } else if (!config.issueBaseUrl.match(/^https?:\/\/.+\/issues$/)) {
    errors.push(`issueBaseUrl format invalid (should end with /issues): ${config.issueBaseUrl}`);
  }
  
  // Check reportPath is writable
  if (config.reportPath) {
    try {
      if (!fs.existsSync(config.reportPath)) {
        fs.mkdirSync(config.reportPath, { recursive: true });
      }
      // Try to write a test file
      const testFile = path.join(config.reportPath, '.write-test');
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
    } catch (e) {
      errors.push(`reportPath is not writable: ${config.reportPath}`);
    }
  }

  // Check serviceUrl format (only when configured — service integration is optional).
  // Invariant: must be origin-only (no path component beyond '/'), http or https.
  // See docs/SERVICE_CONNECTIVITY_CHECK_PROPOSAL.md §3.0.
  if (config.serviceUrl) {
    let parsed;
    try {
      parsed = new URL(config.serviceUrl);
    } catch (_e) {
      errors.push(`serviceUrl is not a valid URL: ${config.serviceUrl}`);
    }
    if (parsed) {
      if (!['http:', 'https:'].includes(parsed.protocol)) {
        errors.push(`serviceUrl must use http:// or https:// (got ${parsed.protocol}): ${config.serviceUrl}`);
      } else if (parsed.pathname && parsed.pathname !== '/' && parsed.pathname !== '') {
        errors.push(`serviceUrl must be origin-only (no path); strip "${parsed.pathname}" from: ${config.serviceUrl}`);
      } else if (parsed.search || parsed.hash) {
        errors.push(`serviceUrl must not contain query/fragment: ${config.serviceUrl}`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

// Check if configured
function isConfigured() {
  if (!fs.existsSync(CONFIG_FILE)) return false;
  const config = loadConfig();
  const { valid } = validateConfig(config);
  return valid;
}

// Load configuration
function loadConfig() {
  let config = { ...DEFAULT_CONFIG };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = { ...config, ...userConfig };
    } catch (e) {
      warning(`Failed to parse config file, using default configuration: ${e.message}`);
    }
  }
  return config;
}

// Save configuration
function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  success(`Configuration saved to ${CONFIG_FILE}`);
}

module.exports = {
  VERSION,
  DEFAULT_CONFIG,
  CONFIG_FILE,
  loadConfig,
  saveConfig,
  isConfigured,
  validateConfig
};
