// @ts-check
/**
 * Configuration management
 */

/** @typedef {import('./types').Config} Config */

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
  agents: {},
  rubberDuckAgent: process.env.AI_ISSUE_RUBBER_DUCK_AGENT || '',
  model: process.env.AI_ISSUE_MODEL || 'claude-sonnet-4.5',
  logLevel: process.env.AI_ISSUE_LOG_LEVEL || 'info',
  issueBaseUrl: process.env.AI_ISSUE_BASE_URL || 'https://github.com/hashicorp/terraform-provider-azurerm/issues',
  serviceUrl: process.env.AI_ISSUE_SERVICE_URL || '',
  serviceApiKey: process.env.AI_ISSUE_SERVICE_API_KEY || '',
  knowledgeBasePath: process.env.AI_ISSUE_KB_PATH || '',
  knowledgeBaseEnabled: process.env.AI_ISSUE_KB_ENABLED !== 'false',
  knowledgeBaseAutoUpdate: process.env.AI_ISSUE_KB_AUTO_UPDATE === 'true',
  // skillsMetricsEnabled gates per-skill local metrics collection
  // (SKILLS_ENHANCEMENT_PLAN §C2). Default OFF for privacy + disk hygiene.
  // When true, lib/agents/env-builder.js sets AI_ISSUE_SKILLS_METRICS_PATH on
  // the agent subprocess env; each skill appends one JSON line per tool call
  // via lib/skills-metrics.js wrapToolHandler().
  skillsMetricsEnabled: process.env.AI_ISSUE_SKILLS_METRICS_ENABLED === 'true',
  skillsMetricsPath:
    process.env.AI_ISSUE_SKILLS_METRICS_PATH ||
    path.join(os.homedir(), '.ai-issue', 'metrics', 'skills.jsonl'),
  // updateChannel controls how `ai-issue update` resolves the upstream target.
  //   'auto' (default): link install -> branch HEAD; copy install -> latest semver release tag.
  //   'tag'           : always track latest semver release tag.
  //   'branch'        : always track current branch HEAD.
  // See docs/UPDATE_COMMAND_PROPOSAL.md §4.3.1.
  updateChannel: process.env.AI_ISSUE_UPDATE_CHANNEL || 'auto',
  // uiMode selects renderer at command invocation time.
  //   'auto'  (default): capability-detect (TTY + CI + stdin) → tui or plain.
  //   'plain'          : always plain text output (today's behavior).
  //   'tui'            : force TUI; exit 22 if unsupported.
  // See docs/TUI_UX_REDESIGN_PROPOSAL.md §3.2 / §4.2.
  uiMode: process.env.AI_ISSUE_UI_MODE || 'auto'
};

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.ai-issue');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

function expandHome(value) {
  if (!value) return value;
  if (value === '~') return os.homedir();
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2));
  return value;
}

// Validate configuration
function validateConfig(config) {
  const errors = [];
  const warnings = [];

  const supportedAgents = ['copilot', 'claude-code'];
  const agent = config.agent || 'copilot';
  if (!supportedAgents.includes(agent)) {
    errors.push(`Unknown agent: ${agent}. Available agents: ${supportedAgents.join(', ')}`);
  }

  if (config.rubberDuckAgent && !supportedAgents.includes(config.rubberDuckAgent)) {
    errors.push(`Unknown rubberDuckAgent: ${config.rubberDuckAgent}. Available agents: ${supportedAgents.join(', ')}`);
  }

  if (config.agents !== undefined) {
    if (!config.agents || typeof config.agents !== 'object' || Array.isArray(config.agents)) {
      errors.push('agents must be an object');
    } else {
      for (const [name, agentConfig] of Object.entries(config.agents)) {
        if (!supportedAgents.includes(name)) {
          errors.push(`Unknown agents.${name}. Available agents: ${supportedAgents.join(', ')}`);
          continue;
        }
        if (!agentConfig || typeof agentConfig !== 'object' || Array.isArray(agentConfig)) {
          errors.push(`agents.${name} must be an object`);
          continue;
        }
        if (agentConfig.model !== undefined && (typeof agentConfig.model !== 'string' || agentConfig.model.trim() === '')) {
          errors.push(`agents.${name}.model must be a non-empty string`);
        }
      }
    }
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

  if (config.knowledgeBaseEnabled !== undefined && typeof config.knowledgeBaseEnabled !== 'boolean') {
    errors.push('knowledgeBaseEnabled must be a boolean');
  }

  if (config.knowledgeBaseAutoUpdate !== undefined && typeof config.knowledgeBaseAutoUpdate !== 'boolean') {
    errors.push('knowledgeBaseAutoUpdate must be a boolean');
  }

  if (config.skillsMetricsEnabled !== undefined && typeof config.skillsMetricsEnabled !== 'boolean') {
    errors.push('skillsMetricsEnabled must be a boolean');
  }
  if (config.skillsMetricsPath !== undefined && typeof config.skillsMetricsPath !== 'string') {
    errors.push('skillsMetricsPath must be a string');
  }

  // uiMode (TUI proposal §4.2 v1.1 N7): warn-only — bad values fall back to
  // 'auto' at capability detection time, so we don't fail validation on a
  // hand-edited config typo. Set-time validation in config-cmd.js is strict.
  if (config.uiMode !== undefined && config.uiMode !== null) {
    const { UI_MODE_VALUES } = require('./ui/config-keys');
    if (typeof config.uiMode !== 'string' || !UI_MODE_VALUES.includes(/** @type {any} */ (config.uiMode))) {
      warnings.push(`uiMode "${config.uiMode}" is not one of ${UI_MODE_VALUES.join(', ')}; falling back to 'auto'`);
    }
  }

  if (config.knowledgeBasePath) {
    const kbPath = expandHome(config.knowledgeBasePath);
    if (!fs.existsSync(kbPath)) {
      warnings.push(`knowledgeBasePath does not exist yet: ${kbPath}`);
    } else {
      let isDirectory = true;
      try {
        const stat = fs.statSync(kbPath);
        isDirectory = typeof stat.isDirectory === 'function' ? stat.isDirectory() : true;
      } catch (_e) {
        isDirectory = false;
      }
      if (!isDirectory) {
        warnings.push(`knowledgeBasePath is not a directory: ${kbPath}`);
      } else if (!fs.existsSync(path.join(kbPath, 'manifest.json'))) {
        warnings.push(`knowledgeBasePath is missing manifest.json: ${kbPath}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

// Check if configured
function isConfigured() {
  if (!fs.existsSync(CONFIG_FILE)) return false;
  const config = loadConfig();
  const { valid } = validateConfig(config);
  return valid;
}

// Load configuration
/** @returns {Config} */
function loadConfig() {
  /** @type {Config} */
  let config = { ...DEFAULT_CONFIG, agents: { ...DEFAULT_CONFIG.agents } };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      config = {
        ...config,
        ...userConfig,
        agents: {
          ...(config.agents || {}),
          ...(userConfig.agents || {})
        }
      };
    } catch (e) {
      warning(`Failed to parse config file, using default configuration: ${e.message}`);
    }
  }
  config.repoPath = expandHome(config.repoPath);
  config.reportPath = expandHome(config.reportPath);
  config.knowledgeBasePath = expandHome(config.knowledgeBasePath);
  config.skillsMetricsPath = expandHome(config.skillsMetricsPath);
  return config;
}

// Save configuration
/** @param {Config} config */
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
  validateConfig,
  expandHome
};
