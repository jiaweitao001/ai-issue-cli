// @ts-check
/**
 * Init command implementation
 */

const fs = require('fs');
const path = require('path');
const { saveConfig, DEFAULT_CONFIG, CONFIG_FILE } = require('../config');
const { success, info, error, highlight } = require('../logger');
const { promptInput } = require('../prompts');
const { installKnowledgeBase } = require('./kb');

// Command: init
async function cmdInit() {
  info('Initializing AI Issue CLI configuration...');

  if (fs.existsSync(CONFIG_FILE)) {
    info(`Configuration file already exists at ${highlight(CONFIG_FILE)}`);
    return;
  }

  // Use defaults for now, prompts can be added if needed
  const config = { ...DEFAULT_CONFIG };

  try {
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

    const answer = await promptInput('Download local knowledge base? (Y/n) ');
    if (!/^n(o)?$/i.test(String(answer || '').trim())) {
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
  cmdInit
};
