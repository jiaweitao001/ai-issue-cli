/**
 * Solve command implementation
 */

const fs = require('fs');
const path = require('path');
const { loadConfig } = require('../config');
const { log, error, success, info, chalk, highlight, debug } = require('../logger');
const { runCopilot } = require('../copilot');

/**
 * Parse issue type from research report
 * @param {string} content - Research report content
 * @returns {'CODE_CHANGE' | 'GUIDANCE'}
 */
function parseIssueType(content) {
  // Match issue type from research report
  const guidanceMatch = content.match(/\*\*Type\*\*:\s*(?:📖\s*)?GUIDANCE/i) ||
    content.match(/Type:\s*(?:📖\s*)?GUIDANCE/i);

  if (guidanceMatch) {
    return 'GUIDANCE';
  }

  return 'CODE_CHANGE';
}

/**
 * Wait for file with timeout and progress feedback
 * @param {string} filePath - Path to the file to wait for
 * @param {number} timeoutMs - Timeout in milliseconds (default: 60s)
 * @param {function} onProgress - Optional callback for progress updates
 * @returns {Promise<boolean>} - True if file exists, false if timeout
 */
async function waitForFile(filePath, timeoutMs = 60000, onProgress = null) {
  const start = Date.now();
  const pollInterval = 1000; // 1 second
  let lastUpdate = start;
  
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      return true;
    }
    
    // Progress feedback every 5 seconds
    if (onProgress && Date.now() - lastUpdate >= 5000) {
      const elapsed = Math.floor((Date.now() - start) / 1000);
      onProgress(elapsed);
      lastUpdate = Date.now();
    }
    
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return false;
}

// Command: solve (Two-Phase Approach)
async function cmdSolve(issueNumber, options) {
  const config = loadConfig();
  
  // Enable debug mode if --debug flag is set
  if (options.debug) {
    process.env.AI_ISSUE_DEBUG = 'true';
    debug('Debug mode enabled');
    debug(`Options: ${JSON.stringify(options, null, 2)}`);
    debug(`Config: ${JSON.stringify(config, null, 2)}`);
  }

  if (!options.silent) {
    log('');
    log(chalk.bold.cyan('🚀 AI Issue Solver (Two-Phase Approach)'));
    log(chalk.cyan('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
    log('');
  }

  info(`Processing Issue #${issueNumber}`);

  const issueUrl = `${config.issueBaseUrl}/${issueNumber}`;
  const researchFile = path.join(config.reportPath, `issue-${issueNumber}-research.md`);
  const analysisFile = path.join(config.reportPath, `issue-${issueNumber}-analysis-and-solution.md`);

  if (!fs.existsSync(config.reportPath)) {
    fs.mkdirSync(config.reportPath, { recursive: true });
  }

  try {
    // ========================================
    // Phase 1: Deep Research
    // ========================================
    if (!options.silent) {
      log('');
      log(chalk.bold.blue('📚 Phase 1: Deep Research'));
      log(chalk.blue('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      log('');
      info('Conducting comprehensive technical research...');
    }

    // Check if prompt file is in root or lib (supporting multiple structures)
    let phase1PromptFile = path.join(__dirname, '..', '..', 'PHASE1_RESEARCH_PROMPT.md');
    if (!fs.existsSync(phase1PromptFile)) {
      phase1PromptFile = path.join(__dirname, '..', 'PHASE1_RESEARCH_PROMPT.md');
    }

    if (!fs.existsSync(phase1PromptFile)) {
      throw new Error(`Phase 1 prompt file not found`);
    }

    const phase1Prompt = fs.readFileSync(phase1PromptFile, 'utf8');
    const researchPrompt = `${phase1Prompt}

---

**Issue URL**: ${issueUrl}
**Repository Path**: ${config.repoPath}
**Task**: Conduct deep research for Issue #${issueNumber}
**Output**: Save research report to: ${researchFile}

Start research now.
`;

    debug('Starting Phase 1: Research');
    debug(`Research file: ${researchFile}`);
    await runCopilot(researchPrompt, config, [], options.silent || false, options.debug || false, { phase: 'phase1' });

    // Wait for research file with progress feedback
    const researchExists = await waitForFile(researchFile, 60000, (elapsed) => {
      if (!options.silent) {
        info(`⏳ Waiting for research report... ${elapsed}s elapsed`);
      }
    });
    
    if (!researchExists) {
      throw new Error(`Research report not generated at ${researchFile} after 60s timeout`);
    }

    const researchContent = fs.readFileSync(researchFile, 'utf8');
    const issueType = parseIssueType(researchContent);

    if (!options.silent) {
      success('Research report generated');
      info(`Type: ${issueType === 'GUIDANCE' ? '📖 GUIDANCE' : '🔧 CODE_CHANGE'}`);
    }

    // ========================================
    // Phase 2: Solution Implementation
    // ========================================
    if (!options.silent) {
      log('');
      const phase2Title = issueType === 'GUIDANCE' ? '📖 Phase 2: Guidance & Explanation' : '🔧 Phase 2: Solution Implementation';
      log(chalk.bold.green(phase2Title));
      log(chalk.green('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━'));
      log('');
      info(issueType === 'GUIDANCE'
        ? 'Preparing guidance and explanation...'
        : 'Designing and implementing solution...');
    }

    const phase2PromptFileName = issueType === 'GUIDANCE'
      ? 'PHASE2_GUIDANCE_PROMPT.md'
      : 'PHASE2_SOLUTION_PROMPT.md';

    let phase2PromptFile = path.join(__dirname, '..', '..', phase2PromptFileName);
    if (!fs.existsSync(phase2PromptFile)) {
      phase2PromptFile = path.join(__dirname, '..', phase2PromptFileName);
    }

    if (!fs.existsSync(phase2PromptFile)) {
      throw new Error(`Phase 2 prompt file not found: ${phase2PromptFileName}`);
    }

    const phase2Prompt = fs.readFileSync(phase2PromptFile, 'utf8');

    let solutionPrompt = `${phase2Prompt}

---

**Issue URL**: ${issueUrl}
**Repository Path**: ${config.repoPath}
**Phase 1 Research Report**:
${researchContent}

**Task**: ${issueType === 'GUIDANCE' ? 'Provide guidance' : 'Implement solution'} for Issue #${issueNumber}
**Output**: Save analysis report to: ${analysisFile}

Start now.
`;

    debug('Starting Phase 2: Solution');
    debug(`Analysis file: ${analysisFile}`);
    debug(`Issue type: ${issueType}`);
    await runCopilot(solutionPrompt, config, [], options.silent || false, options.debug || false, { phase: 'phase2' });

    // Wait for analysis file with progress feedback
    const analysisExists = await waitForFile(analysisFile, 60000, (elapsed) => {
      if (!options.silent) {
        info(`⏳ Waiting for solution report... ${elapsed}s elapsed`);
      }
    });
    
    if (!analysisExists) {
      throw new Error(`Analysis report not generated at ${analysisFile} after 60s timeout`);
    }

    if (!options.silent) {
      success('Analysis and solution report generated');
      info(`File: ${highlight(analysisFile)}`);
    }

    // Clean up
    if (fs.existsSync(researchFile)) {
      fs.unlinkSync(researchFile);
    }

    // Evaluation
    if (!options.noEval) {
      const { cmdEvaluate } = require('./evaluate');
      await cmdEvaluate(issueNumber, { ...options, skipHeader: true });
    } else if (!options.silent) {
      log('');
      success('Processing completed! (Evaluation skipped)');
    }

  } catch (err) {
    error(`Execution failed: ${err.message}`);
    throw err;
  }
}

module.exports = {
  cmdSolve
};
