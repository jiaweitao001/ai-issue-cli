/**
 * Environment checking utilities
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Verify environment
function checkEnvironment(config) {
  const checks = [];
  
  // Check Copilot CLI
  try {
    execSync('copilot --version', { stdio: 'pipe' });
    checks.push({ name: 'Copilot CLI', status: true });
  } catch {
    checks.push({ name: 'Copilot CLI', status: false, help: 'npm install -g @github/copilot' });
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
  const phase1PromptFile = path.join(__dirname, '..', 'PHASE1_RESEARCH_PROMPT.md');
  const phase2PromptFile = path.join(__dirname, '..', 'PHASE2_SOLUTION_PROMPT.md');
  const evalPromptFile = path.join(__dirname, '..', 'MANUAL_EVALUATION_PROMPT.md');
  
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
