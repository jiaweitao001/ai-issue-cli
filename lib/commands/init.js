// @ts-check
/**
 * Init command implementation
 */

const fs = require('fs');
const { saveConfig, loadConfig, DEFAULT_CONFIG, CONFIG_FILE } = require('../config');
const { success, info, error, highlight } = require('../logger');
const uiPrompts = require('../ui/prompts');
const { runWizard } = require('../ui/components/wizard');
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

function isInteractiveInit() {
  return process.env.CI !== 'true' && !!process.stdout.isTTY && !!process.stdin.isTTY;
}

function looksLikeIssueBaseUrl(value) {
  return /^https?:\/\/.+\/issues$/i.test(String(value || ''));
}

function buildInitSummary(config, installKb) {
  return [
    `Agent: ${config.agent}`,
    `Repository path: ${config.repoPath || '(not set)'}`,
    `Issue base URL: ${config.issueBaseUrl || '(not set)'}`,
    `Report path: ${config.reportPath || '(not set)'}`,
    `Download local knowledge base: ${installKb ? 'yes' : 'no'}`
  ].join('\n');
}

async function runInitWizard(initialConfig) {
  const config = { ...initialConfig };
  const steps = [
    {
      id: 'agent',
      prompt: () => uiPrompts.select(buildAgentChoices(), {
        initialIndex: Math.max(0, buildAgentChoices().findIndex((choice) => choice.name === (config.agent || 'copilot'))),
        message: '? Choose default agent:'
      }),
      validate: (value) => (REGISTRY[value] ? null : 'Unsupported agent')
    },
    {
      id: 'repoPath',
      prompt: () => uiPrompts.input({
        message: 'Repository path:',
        initial: config.repoPath || process.cwd()
      }),
      validate: (value) => (fs.existsSync(String(value || '')) ? null : 'Repository path does not exist')
    },
    {
      id: 'issueBaseUrl',
      prompt: () => uiPrompts.input({
        message: 'Issue base URL:',
        initial: config.issueBaseUrl || DEFAULT_CONFIG.issueBaseUrl
      }),
      validate: (value) => (looksLikeIssueBaseUrl(value) ? null : 'Issue base URL must end with /issues')
    },
    {
      id: 'installKnowledgeBase',
      prompt: () => uiPrompts.confirm({
        message: 'Download local knowledge base?',
        default: true
      })
    }
  ];

  const result = await runWizard(steps);
  if (result.cancelled) return { cancelled: true, config, installKnowledgeBase: false };

  config.agent = result.values.agent;
  config.repoPath = result.values.repoPath;
  config.issueBaseUrl = result.values.issueBaseUrl;
  const installKb = !!result.values.installKnowledgeBase;

  const confirmed = await uiPrompts.confirm({
    message: `Review configuration:\n${buildInitSummary(config, installKb)}\nWrite configuration?`,
    default: true
  });
  if (!confirmed) return { cancelled: true, config, installKnowledgeBase: installKb };
  return { cancelled: false, config, installKnowledgeBase: installKb };
}

async function promptReconfigureAction() {
  return uiPrompts.select([
    { name: 'edit', label: 'Edit configuration' },
    { name: 'keep', label: 'Keep current configuration' },
    { name: 'cancel', label: 'Cancel' }
  ], {
    initialIndex: 0,
    message: '? Existing configuration found:'
  });
}

async function maybeInstallKnowledgeBase(accepted) {
  if (process.env.CI === 'true') {
    info('CI mode: skipping local knowledge base download prompt.');
    return;
  }
  if (!accepted) return;
  try {
    await installKnowledgeBase({ source: 'jiaweitao001/ai-issue-cli' });
  } catch (downloadErr) {
    error(`Knowledge base download failed: ${downloadErr.message}`);
  }
}

function ensureReportDirectory(config) {
  if (config.reportPath && !fs.existsSync(config.reportPath)) {
    fs.mkdirSync(config.reportPath, { recursive: true });
    success(`Created report directory at ${highlight(config.reportPath)}`);
  }
}

async function runLinearInit(config) {
  const selectedAgent = await pickDefaultAgent();
  config.agent = selectedAgent;
  info(`Default agent set to ${highlight(selectedAgent)}.`);
  if (selectedAgent !== 'copilot') {
    info(`To override the model later: ${highlight(`ai-issue config set agents.${selectedAgent}.model <model-id>`)}`);
  }

  saveConfig(config);
  ensureReportDirectory(config);

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
  await maybeInstallKnowledgeBase(!!accepted);
}

// Command: init
async function cmdInit(options = {}) {
  info('Initializing AI Issue CLI configuration...');

  if (fs.existsSync(CONFIG_FILE)) {
    if (!options.reconfigure) {
      info(`Configuration file already exists at ${highlight(CONFIG_FILE)}. Use --reconfigure to edit.`);
      return;
    }
    if (!isInteractiveInit()) {
      info(`Configuration file already exists at ${highlight(CONFIG_FILE)}. Reconfigure requires an interactive terminal.`);
      return;
    }
    const action = await promptReconfigureAction();
    if (action !== 'edit') {
      info('Keeping existing configuration unchanged.');
      return;
    }
    const existingConfig = loadConfig();
    const wizardResult = await runInitWizard(existingConfig);
    if (wizardResult.cancelled) {
      info('Initialization cancelled. Configuration unchanged.');
      return;
    }
    saveConfig(wizardResult.config);
    ensureReportDirectory(wizardResult.config);
    success('Configuration updated!');
    await maybeInstallKnowledgeBase(wizardResult.installKnowledgeBase);
    return;
  }

  const config = { ...DEFAULT_CONFIG };

  try {
    if (isInteractiveInit()) {
      const wizardResult = await runInitWizard(config);
      if (wizardResult.cancelled) {
        info('Initialization cancelled. No configuration written.');
        return;
      }
      saveConfig(wizardResult.config);
      ensureReportDirectory(wizardResult.config);
      success('Initialization complete!');
      await maybeInstallKnowledgeBase(wizardResult.installKnowledgeBase);
      return;
    }

    await runLinearInit(config);
  } catch (err) {
    error(`Failed to initialize: ${err.message}`);
  }
}

module.exports = {
  cmdInit,
  // Exported for testing
  _internal: {
    pickDefaultAgent,
    buildAgentChoices,
    runInitWizard,
    buildInitSummary,
    looksLikeIssueBaseUrl,
    isInteractiveInit
  }
};
