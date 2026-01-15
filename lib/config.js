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
  model: process.env.AI_ISSUE_MODEL || 'claude-sonnet-4.5',
  logLevel: process.env.AI_ISSUE_LOG_LEVEL || 'info',
  issueBaseUrl: process.env.AI_ISSUE_BASE_URL || 'https://github.com/hashicorp/terraform-provider-azurerm/issues'
};

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.ai-issue');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Validate configuration
function validateConfig(config) {
  const errors = [];
  
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
