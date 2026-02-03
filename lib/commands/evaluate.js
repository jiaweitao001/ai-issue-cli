/**
 * Evaluate command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { log, error, success, info, warning, chalk, debug } = require('../logger');
const { runCopilot } = require('../copilot');

// Command: evaluate
async function cmdEvaluate(issueNumber, options) {
  const config = loadConfig();
  
  // Enable debug mode if --debug flag is set
  if (options.debug) {
    process.env.AI_ISSUE_DEBUG = 'true';
    debug('Debug mode enabled for evaluation');
  }
  
  if (!options.skipHeader) {
    log(chalk.bold('📊 Phase 3: Evaluate Solution'));
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

**EXECUTION CONSTRAINTS** (MUST FOLLOW):

1. **PR Search Limit**: 
   - Search for related PRs at most 2 times
   - If no directly linked PR is found after 2 searches, STOP searching
   - Do NOT exhaustively search with different keywords

2. **PR Content Limit** (if PR found):
   - Only get PR metadata (title, body, state, changed files list)
   - Do NOT read full diff content of all files
   - Only examine specific file changes that are directly related to the AI solution's modified files

3. **Evaluation Without PR**:
   - If no related PR exists, evaluate based on solution quality alone
   - Score based on: technical correctness, completeness, clarity, and feasibility
   - Note in the report: "No reference PR available for comparison"

4. **Git Show Usage**:
   - If the solution report contains a Commit Hash, use \`git show <hash>\` to view actual code changes

Please provide a detailed evaluation according to the above evaluation criteria and save the result to:
${evaluationFile}
`;
  
  try {
    debug('Starting evaluation phase');
    debug(`Evaluation file: ${evaluationFile}`);
    debug(`Analysis file: ${analysisFile}`);
    await runCopilot(fullPrompt, config, [], options.silent || false, options.debug || false, { phase: 'evaluate' });
    
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
