/**
 * Evaluate command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { log, error, success, info, warning, chalk } = require('../logger');
const { runCopilot } = require('../copilot');

// Command: evaluate
async function cmdEvaluate(issueNumber, options) {
  const config = loadConfig();
  
  if (!options.skipHeader) {
    log(chalk.bold('📊 Phase 2: Evaluate Solution'));
    log('');
  }
  
  const analysisFile = path.join(config.reportPath, `issue-${issueNumber}-analysis-and-solution.md`);
  const evaluationFile = path.join(config.reportPath, `issue-${issueNumber}-evaluation.md`);
  
  if (!fs.existsSync(analysisFile)) {
    throw new Error(`Analysis and solution report does not exist: ${analysisFile}. Please run first: ai-issue solve ${issueNumber}`);
  }
  
  // Read evaluation prompt (with fallback for different directory structures)
  let evalPromptFile = path.join(__dirname, '..', '..', 'MANUAL_EVALUATION_PROMPT.md');
  if (!fs.existsSync(evalPromptFile)) {
    evalPromptFile = path.join(__dirname, '..', 'MANUAL_EVALUATION_PROMPT.md');
  }
  if (!fs.existsSync(evalPromptFile)) {
    throw new Error(`Evaluation prompt file not found`);
  }
  
  const evalPrompt = fs.readFileSync(evalPromptFile, 'utf8');
  const analysisContent = fs.readFileSync(analysisFile, 'utf8');
  
  const fullPrompt = `${evalPrompt}

Please evaluate the solution for Issue #${issueNumber}:

**Repository Path**: ${config.repoPath}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analysis Report Content:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${analysisContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**IMPORTANT**: If the solution report contains a Commit Hash, use \`git show <hash>\` in the repository path above to view the actual code changes before scoring.

Please provide a detailed evaluation according to the above evaluation criteria and save the result to:
${evaluationFile}
`;
  
  try {
    await runCopilot(fullPrompt, config, [], options.silent || false);
    
    if (fs.existsSync(evaluationFile)) {
      if (!options.silent) {
        success('Evaluation report generated');
        info(`File: ${evaluationFile}`);
      }
    } else {
      if (!options.silent) {
        warning('Evaluation report may not have been generated automatically, please check output');
      }
    }
    
    if (!options.silent) {
      log('');
      log(chalk.green('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      success(`Issue #${issueNumber} processing completed!`);
    }
    
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  cmdEvaluate
};
