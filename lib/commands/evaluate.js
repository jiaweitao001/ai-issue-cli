/**
 * Evaluate command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { log, error, success, info, warning, colors } = require('../logger');
const { runCopilot } = require('../copilot');

// Command: evaluate
async function cmdEvaluate(issueNumber, options) {
  const config = loadConfig();
  
  if (!options.skipHeader) {
    log('📊 Phase 2: Evaluate Solution', colors.bright);
    log('');
  }
  
  const analysisFile = path.join(config.reportPath, `issue-${issueNumber}-analysis.md`);
  const evaluationFile = path.join(config.reportPath, `issue-${issueNumber}-evaluation.md`);
  
  if (!fs.existsSync(analysisFile)) {
    error(`Analysis report does not exist: ${analysisFile}`);
    error('Please run first: ai-issue solve ' + issueNumber);
    process.exit(1);
  }
  
  // Read evaluation prompt
  const evalPromptFile = path.join(__dirname, '..', '..', 'MANUAL_EVALUATION_PROMPT_EN.md');
  if (!fs.existsSync(evalPromptFile)) {
    error(`Evaluation prompt file does not exist: ${evalPromptFile}`);
    process.exit(1);
  }
  
  const evalPrompt = fs.readFileSync(evalPromptFile, 'utf8');
  const analysisContent = fs.readFileSync(analysisFile, 'utf8');
  
  const fullPrompt = `${evalPrompt}

Please evaluate the solution for Issue #${issueNumber}:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Analysis Report Content:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

${analysisContent}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

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
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.green);
      success(`Issue #${issueNumber} processing completed!`);
    }
    
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    process.exit(1);
  }
}

module.exports = {
  cmdEvaluate
};
