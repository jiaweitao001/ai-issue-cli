/**
 * Configuration management
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { success, warning, error } = require('./logger');

// Version information - read from package.json
const VERSION = require('../package.json').version;

// Default configuration - no longer contains hardcoded user paths
const DEFAULT_CONFIG = {
  repoPath: process.env.AI_ISSUE_REPO_PATH || '', // Must be set by user
  reportPath: process.env.AI_ISSUE_REPORT_PATH || path.join(os.homedir(), '.ai-issue', 'reports'),
  model: process.env.AI_ISSUE_MODEL || 'claude-sonnet-4.5',
  logLevel: process.env.AI_ISSUE_LOG_LEVEL || 'info',
  issueBaseUrl: process.env.AI_ISSUE_BASE_URL || ''
};

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.ai-issue');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Check if configured
function isConfigured() {
  if (!fs.existsSync(CONFIG_FILE)) return false;
  const config = loadConfig();
  return !!(config.repoPath && config.issueBaseUrl);
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
  isConfigured
};
