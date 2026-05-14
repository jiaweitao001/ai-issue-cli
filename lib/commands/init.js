// @ts-check
/**
 * Init command implementation
 */

const fs = require('fs');
const path = require('path');
const { saveConfig, DEFAULT_CONFIG, CONFIG_FILE } = require('../config');
const { success, info, error, highlight } = require('../logger');
const uiPrompts = require('../ui/prompts');
const { REGISTRY } = require('../agents');
const { installKnowledgeBase } = require('./kb');

const AGENT_METADATA = {
  copilot: {
    label: 'copilot     (recommended; install: npm i -g @github/copilot)',
    recommended: true
  },
  'claude-code': {
    label: 'claude-code (install: npm i -g @anthropic-ai/claude-code)'
  }
};

function buildAgentChoices() {
  const names = Object.keys(REGISTRY);
  names.sort((a, b) => {
    const ra = AGENT_METADATA[a] && AGENT_METADATA[a].recommended ? 0 : 1;
    const rb = AGENT_METADATA[b] && AGENT_METADATA[b].recommended ? 0 : 1;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
  return names.map(name => ({
    name,
    label: (AGENT_METADATA[name] && AGENT_METADATA[name].label) || name
  }));
}

async function pickDefaultAgent() {
  if (process.env.CI === 'true') {
    info('CI mode: defaulting agent to copilot.');
    return 'copilot';
  }
  if (!process.stdout.isTTY) {
    info('Non-TTY environment: defaulting agent to copilot.');
    return 'copilot';
  }
  const choices = buildAgentChoices();
  if (choices.length <= 1) {
    return choices[0] ? choices[0].name : 'copilot';
  }
  const chosen = await uiPrompts.select(choices, {
    initialIndex: 0,
    message: '? Choose default agent:'
  });
  if (chosen == null) {
    info('No agent selected; defaulting to copilot.');
    return 'copilot';
  }
  return chosen;
}

// Command: init
async function cmdInit() {
  info('Initializing AI Issue CLI configuration...');

  if (fs.existsSync(CONFIG_FILE)) {
    info(`Configuration file already exists at ${highlight(CONFIG_FILE)}`);
    return;
  }

  const config = { ...DEFAULT_CONFIG };

  try {
    const selectedAgent = await pickDefaultAgent();
    config.agent = selectedAgent;
    info(`Default agent set to ${highlight(selectedAgent)}.`);
    if (selectedAgent !== 'copilot') {
      info(`To override the model later: ${highlight(`ai-issue config set agents.${selectedAgent}.model <model-id>`)}`);
    }

    saveConfig(config);

    // Create report directory if it doesn't exist
    if (config.reportPath && !fs.existsSync(config.reportPath)) {
      fs.mkdirSync(config.reportPath, { recursive: true });
      success(`Created report directory at ${highlight(config.reportPath)}`);
    }

    success('Initialization complete!');
    info(`Please edit ${highlight(CONFIG_FILE)} to set your ${highlight('repoPath')} and ${highlight('issueBaseUrl')}.`);
    info('Or use: ai-issue config set repoPath <path>');

    if (process.env.CI === 'true') {
      info('CI mode: skipping local knowledge base download prompt.');
      return;
    }

    const accepted = await uiPrompts.confirm({
      message: 'Download local knowledge base?',
      default: true
    });
    if (accepted) {
      try {
        await installKnowledgeBase({ source: 'jiaweitao001/ai-issue-cli' });
      } catch (downloadErr) {
        error(`Knowledge base download failed: ${downloadErr.message}`);
      }
    }

  } catch (err) {
    error(`Failed to initialize: ${err.message}`);
  }
}

module.exports = {
  cmdInit,
  // Exported for testing
  _internal: {
    pickDefaultAgent,
    buildAgentChoices
  }
};
