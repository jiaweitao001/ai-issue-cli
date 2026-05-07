/**
 * Environment checking utilities
 */

const fs = require('fs');
const path = require('path');
const { createAgent } = require('./agents');

// Verify environment
function checkEnvironment(config) {
  const checks = [];
  
  // Check GITHUB_TOKEN
  checks.push({
    name: 'GITHUB_TOKEN',
    status: !!process.env.GITHUB_TOKEN,
    help: 'Set GITHUB_TOKEN environment variable. Create a PAT at https://github.com/settings/tokens (repo or public_repo scope)'
  });

  // Check configured agent CLI
  try {
    const agent = createAgent(config);
    const installation = agent.validateInstallationSync();
    checks.push({
      name: agent.displayName || `${agent.name} Agent`,
      status: installation.installed,
      help: installation.errors && installation.errors.length > 0
        ? installation.errors.join('; ')
        : undefined
    });
  } catch (err) {
    checks.push({ name: 'Agent CLI', status: false, help: err.message });
  }
  
  // Check repository path
  checks.push({
    name: 'Repository Path',
    status: fs.existsSync(config.repoPath),
    help: `Set correct path: ai-issue config set repoPath <path>`
  });
  
  // Check report path
  checks.push({
    name: 'Report Path',
    status: fs.existsSync(config.reportPath),
    help: `Create directory: mkdir -p ${config.reportPath}`
  });
  
  // Check prompt files
  const phase1PromptFile = path.join(__dirname, '..', 'prompts', 'PHASE1_RESEARCH_PROMPT.md');
  const phase2PromptFile = path.join(__dirname, '..', 'prompts', 'PHASE2_SOLUTION_PROMPT.md');
  const evalPromptFile = path.join(__dirname, '..', 'prompts', 'MANUAL_EVALUATION_PROMPT.md');
  
  checks.push({
    name: 'Phase 1 Prompt (Research)',
    status: fs.existsSync(phase1PromptFile),
    help: `Required file: ${phase1PromptFile}`
  });
  
  checks.push({
    name: 'Phase 2 Prompt (Solution)',
    status: fs.existsSync(phase2PromptFile),
    help: `Required file: ${phase2PromptFile}`
  });
  
  checks.push({
    name: 'Evaluation Prompt',
    status: fs.existsSync(evalPromptFile),
    help: `Required file: ${evalPromptFile}`
  });
  
  return checks;
}

module.exports = {
  checkEnvironment
};
