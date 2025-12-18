/**
 * Configuration management
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { success, warning } = require('./logger');

// Version information
const VERSION = '2.0.0'; // Two-Phase Approach

// Default configuration
const DEFAULT_CONFIG = {
  repoPath: process.env.AI_ISSUE_REPO_PATH || path.join(os.homedir(), 'Work/terraform-provider-azurerm'),
  reportPath: process.env.AI_ISSUE_REPORT_PATH || path.join(os.homedir(), 'Work/AI_Issue_Experiment'),
  model: process.env.AI_ISSUE_MODEL || 'claude-sonnet-4.5',
  logLevel: process.env.AI_ISSUE_LOG_LEVEL || 'info',
  issueBaseUrl: process.env.AI_ISSUE_BASE_URL || 'https://github.com/hashicorp/terraform-provider-azurerm/issues'
};

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.ai-issue');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Load configuration
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...DEFAULT_CONFIG, ...userConfig };
    } catch (e) {
      warning(`Failed to parse config file, using default configuration: ${e.message}`);
    }
  }
  return DEFAULT_CONFIG;
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
  saveConfig
};
