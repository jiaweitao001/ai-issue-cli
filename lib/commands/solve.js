/**
 * Solve command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { log, error, success, info, colors } = require('../logger');
const { runCopilot } = require('../copilot');

// Command: solve (Two-Phase Approach)
async function cmdSolve(issueNumber, options) {
  const config = loadConfig();
  
  if (!options.skipHeader) {
    log('', colors.bright);
    log('🚀 AI Issue Solver (Two-Phase Approach)', colors.cyan);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
  }
  
  info(`Processing Issue #${issueNumber}`);
  
  const issueUrl = `${config.issueBaseUrl}/${issueNumber}`;
  const researchFile = path.join(config.reportPath, `issue-${issueNumber}-research.md`);
  const analysisFile = path.join(config.reportPath, `issue-${issueNumber}-analysis.md`);
  const logDir = path.join(config.reportPath, 'logs');
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  try {
    // ========================================
    // Phase 1: Deep Research
    // ========================================
    if (!options.silent) {
      log('');
      log('📚 Phase 1: Deep Research', colors.bright);
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.blue);
      log('');
      info('Conducting comprehensive technical research...');
    }
    
    const phase1PromptFile = path.join(__dirname, '..', '..', 'PHASE1_RESEARCH_PROMPT.md');
    if (!fs.existsSync(phase1PromptFile)) {
      const errMsg = `Issue #${issueNumber}: Phase 1 prompt file does not exist: ${phase1PromptFile}`;
      error(errMsg);
      throw new Error(errMsg);
    }
    
    const phase1Prompt = fs.readFileSync(phase1PromptFile, 'utf8');
    const researchPrompt = `${phase1Prompt}

---

**Issue URL**: ${issueUrl}

**Repository Path**: ${config.repoPath}

**Task**: Conduct deep research for Issue #${issueNumber}

**IMPORTANT INSTRUCTIONS**:
1. Do NOT propose solutions in this phase
2. Focus on thorough investigation and data collection
3. Find similar implementations as references
4. Search for existing SDK tools
5. Analyze code history with git
6. Identify all affected locations

**Output**: Save research report to: ${researchFile}

Start research now.
`;

    await runCopilot(researchPrompt, config, [], options.silent || false);
    
    if (!fs.existsSync(researchFile)) {
      const errMsg = `Issue #${issueNumber}: Research report not generated at ${researchFile}`;
      error(errMsg);
      error('Phase 1 failed - cannot proceed to Phase 2');
      throw new Error(errMsg);
    }
    
    if (!options.silent) {
      success('Research report generated');
      info(`File: ${researchFile}`);
    }
    
    // Small delay to ensure file is fully written
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Log file status before Phase 2 (for debugging)
    if (!options.silent) {
      info('Phase 1 completed, checking files before Phase 2...');
      info(`Research file exists: ${fs.existsSync(researchFile)}`);
      info(`Analysis file exists (should be false): ${fs.existsSync(analysisFile)}`);
    }
    
    // ========================================
    // Phase 2: Solution Implementation
    // ========================================
    if (!options.silent) {
      log('');
      log('🔧 Phase 2: Solution Implementation', colors.bright);
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.green);
      log('');
      info('Designing and implementing solution based on research...');
    }
    
    const phase2PromptFile = path.join(__dirname, '..', '..', 'PHASE2_SOLUTION_PROMPT.md');
    if (!fs.existsSync(phase2PromptFile)) {
      const errMsg = `Issue #${issueNumber}: Phase 2 prompt file does not exist: ${phase2PromptFile}`;
      error(errMsg);
      throw new Error(errMsg);
    }
    
    const phase2Prompt = fs.readFileSync(phase2PromptFile, 'utf8');
    const researchContent = fs.readFileSync(researchFile, 'utf8');
    
    const solutionPrompt = `${phase2Prompt}

---

**Issue URL**: ${issueUrl}

**Repository Path**: ${config.repoPath}

**Phase 1 Research Report**:

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
${researchContent}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Task**: Based on the above research, design and implement solution for Issue #${issueNumber}

**CRITICAL REQUIREMENTS**:
1. You MUST create a git branch: issue-${issueNumber} if code changes are needed
2. If code changes are needed, you MUST implement them
3. If code changes are needed, you MUST update test files
4. If code changes are needed, you MUST commit all changes
5. You MUST save analysis report to: ${analysisFile}

**IMPORTANT CONTEXT**:
- You are working in a LOCAL repository at: ${config.repoPath}
- This is MY working directory with FULL write permissions
- You MUST create branches, commit changes, and modify files directly
- This is NOT a read-only environment - you have complete access

**Quality Standards**:
- Solve root cause, not symptoms
- Follow similar implementations found in research
- Use SDK functions found in research
- Ensure completeness (all CRUD operations)
- Keep code simple and clean

Start implementation now.
`;

    await runCopilot(solutionPrompt, config, [], options.silent || false);
    
    // Add delay to ensure file is written
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check file with detailed logging
    const fileExists = fs.existsSync(analysisFile);
    if (!options.silent) {
      info(`Checking for analysis file: ${analysisFile}`);
      info(`File exists: ${fileExists}`);
      if (fileExists) {
        const stats = fs.statSync(analysisFile);
        info(`File size: ${stats.size} bytes`);
        info(`File modified: ${stats.mtime.toISOString()}`);
      }
    }
    
    if (!fileExists) {
      const errMsg = `Issue #${issueNumber}: Analysis report not generated at ${analysisFile}`;
      error(errMsg);
      error('Phase 2 completed but report is missing');
      throw new Error(errMsg);
    }
    
    if (!options.silent) {
      success('Analysis report generated');
      info(`File: ${analysisFile}`);
    }
    
    // Skip evaluation if --no-eval is specified
    if (options.noEval) {
      if (!options.silent) {
        log('');
        log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.green);
        success('Two-phase processing completed! (Evaluation skipped)');
      }
      return;
    }
    
    // Automatically proceed to evaluation phase
    const { cmdEvaluate } = require('./evaluate');
    if (!options.silent) {
      log('');
      log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
      log('');
    }
    await cmdEvaluate(issueNumber, { ...options, skipHeader: true });
    
  } catch (err) {
    if (!options.silent) {
      error(`Execution failed: ${err.message}`);
    }
    // Re-throw the error with original message (already contains issue number)
    throw err;
  }
}

module.exports = {
  cmdSolve
};
