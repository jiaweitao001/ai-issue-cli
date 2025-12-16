#!/usr/bin/env node
/**
 * AI Issue CLI - Automated Issue Resolution and Evaluation Tool
 * Based on GitHub Copilot CLI
 */

const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Version information
const VERSION = '1.0.0';

// Default configuration
const DEFAULT_CONFIG = {
  repoPath: process.env.AI_ISSUE_REPO_PATH || path.join(os.homedir(), 'Work/terraform-provider-azurerm'),
  reportPath: process.env.AI_ISSUE_REPORT_PATH || path.join(os.homedir(), 'Work/AI_Issue_Experiment'),
  model: process.env.AI_ISSUE_MODEL || 'claude-sonnet-4.5',
  logLevel: process.env.AI_ISSUE_LOG_LEVEL || 'info',
  issueBaseUrl: process.env.AI_ISSUE_BASE_URL || 'https://github.com/hashicorp/terraform-provider-azurerm/issues'
};

// Configuration file path
const CONFIG_DIR = path.join(os.homedir(), '.ai-issue');
const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');

// Color output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function error(message) {
  log(`❌ ${message}`, colors.red);
}

function success(message) {
  log(`✅ ${message}`, colors.green);
}

function info(message) {
  log(`ℹ️  ${message}`, colors.blue);
}

function warning(message) {
  log(`⚠️  ${message}`, colors.yellow);
}

// Load configuration
function loadConfig() {
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const userConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
      return { ...DEFAULT_CONFIG, ...userConfig };
    } catch (e) {
      warning(`Failed to parse config file, using default configuration: ${e.message}`);
    }
  }
  return DEFAULT_CONFIG;
}

// Save configuration
function saveConfig(config) {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
  success(`Configuration saved to ${CONFIG_FILE}`);
}

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
  const initPromptFile = path.join(__dirname, 'AI_Issue_Resolution_Experiment.md');
  const evalPromptFile = path.join(__dirname, 'MANUAL_EVALUATION_PROMPT.md');
  
  checks.push({
    name: 'Initialization Prompt',
    status: fs.existsSync(initPromptFile),
    help: `Required file: ${initPromptFile}`
  });
  
  checks.push({
    name: 'Evaluation Prompt',
    status: fs.existsSync(evalPromptFile),
    help: `Required file: ${evalPromptFile}`
  });
  
  return checks;
}

// Execute Copilot command
function runCopilot(prompt, config, additionalArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      '--model', config.model,
      '--allow-all-tools',
      '--add-dir', config.repoPath,
      '--add-dir', config.reportPath,
      '--log-level', config.logLevel,
      '--no-color',
      '-p', prompt,
      ...additionalArgs
    ];
    
    // Don't use shell to avoid special character issues
    const copilot = spawn('copilot', args, {
      stdio: 'inherit',
      shell: false  // Set to false
    });
    
    copilot.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Copilot exit code: ${code}`));
      }
    });
    
    copilot.on('error', (err) => {
      reject(err);
    });
  });
}

// Command: solve
async function cmdSolve(issueNumber, options) {
  const config = loadConfig();
  
  log('', colors.bright);
  log('🚀 AI Issue Solver', colors.cyan);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('');
  
  info(`Processing Issue #${issueNumber}`);
  
  const issueUrl = `${config.issueBaseUrl}/${issueNumber}`;
  const analysisFile = path.join(config.reportPath, `issue-${issueNumber}-analysis.md`);
  const logDir = path.join(config.reportPath, 'logs');
  
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  
  // Read initialization prompt
  const initPromptFile = path.join(__dirname, 'AI_Issue_Resolution_Experiment.md');
  if (!fs.existsSync(initPromptFile)) {
    error(`Initialization prompt file does not exist: ${initPromptFile}`);
    process.exit(1);
  }
  
  const initPrompt = fs.readFileSync(initPromptFile, 'utf8');
  const solvePrompt = `${initPrompt}

---

Issue URL: ${issueUrl}

IMPORTANT CONTEXT:
- You are working in a LOCAL repository at: ${config.repoPath}
- This is MY working directory with FULL write permissions
- You MUST create branches, commit changes, and modify files directly
- This is NOT a read-only environment - you have complete access
- DO NOT treat this as an external or restricted repository

This is an Issue that needs to be handled. Please start immediately:
1. Do not ask for confirmation, start analysis directly
2. I'm not sure about the status of this Issue, you need to determine if it's already resolved (if resolved, don't check PR and comments)
3. Complete all steps according to specifications INCLUDING creating git branch and committing changes
4. **CRITICAL**: You MUST save the analysis report to this EXACT path: ${analysisFile}
   - Use the create_file tool to save the report
   - The file MUST be created at the specified path
   - Do NOT skip this step - the report is required

Start execution now.
`;

  
  try {
    log('');
    log('🔧 Phase 1: Solve Issue', colors.bright);
    log('');
    
    await runCopilot(solvePrompt, config);
    
    if (!fs.existsSync(analysisFile)) {
      error('Analysis report not generated');
      process.exit(1);
    }
    
    success('Analysis report generated');
    info(`File: ${analysisFile}`);
    
    // Skip evaluation if --no-eval is specified
    if (options.noEval) {
      log('');
      success('Completed! (Evaluation skipped)');
      return;
    }
    
    // Automatically proceed to evaluation phase
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
    await cmdEvaluate(issueNumber, options);
    
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    process.exit(1);
  }
}

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
  const evalPromptFile = path.join(__dirname, 'MANUAL_EVALUATION_PROMPT.md');
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
    await runCopilot(fullPrompt, config);
    
    if (fs.existsSync(evaluationFile)) {
      success('Evaluation report generated');
      info(`File: ${evaluationFile}`);
    } else {
      warning('Evaluation report may not have been generated automatically, please check output');
    }
    
    log('');
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.green);
    success(`Issue #${issueNumber} processing completed!`);
    
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    process.exit(1);
  }
}

// Command: batch
async function cmdBatch(issues, options) {
  log('', colors.bright);
  log('📦 Batch Processing Mode (Parallel)', colors.cyan);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('');
  
  // Concurrency limit (default: 3 parallel instances)
  const concurrency = options.concurrency || 3;
  
  info(`Total ${issues.length} Issues to process (${concurrency} concurrent)`);
  log('');
  
  const results = {
    success: [],
    failed: [],
    processing: new Set(),
    completed: 0
  };
  
  // Process issue with progress tracking
  async function processIssue(issue) {
    results.processing.add(issue);
    const startTime = Date.now();
    
    try {
      log('');
      log(`[${results.completed + 1}/${issues.length}] 🚀 Starting Issue #${issue}`, colors.bright);
      
      await cmdSolve(issue, { ...options, skipHeader: true, quiet: true });
      
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      results.success.push(issue);
      success(`Issue #${issue} completed in ${duration}s`);
    } catch (err) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      error(`Issue #${issue} failed after ${duration}s: ${err.message}`);
      results.failed.push(issue);
    } finally {
      results.processing.delete(issue);
      results.completed++;
      
      // Show progress
      const activeIssues = Array.from(results.processing).join(', #');
      if (results.processing.size > 0) {
        info(`Progress: ${results.completed}/${issues.length} | Active: #${activeIssues}`);
      }
    }
  }
  
  // Process issues with concurrency limit
  const queue = [...issues];
  const activePromises = new Set();
  
  while (queue.length > 0 || activePromises.size > 0) {
    // Start new tasks up to concurrency limit
    while (queue.length > 0 && activePromises.size < concurrency) {
      const issue = queue.shift();
      const promise = processIssue(issue)
        .then(() => activePromises.delete(promise))
        .catch(() => activePromises.delete(promise));
      activePromises.add(promise);
    }
    
    // Wait for at least one task to complete
    if (activePromises.size > 0) {
      await Promise.race(activePromises);
    }
  }
  
  // Statistics
  log('');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.bright);
  log('📊 Batch Processing Statistics', colors.cyan);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.bright);
  log('');
  log(`Total: ${issues.length}`);
  log(`Success: ${results.success.length}`, colors.green);
  log(`Failed: ${results.failed.length}`, colors.red);
  log(`Concurrency: ${concurrency}`);
  
  if (results.failed.length > 0) {
    log('');
    error('Failed Issues:');
    results.failed.forEach(issue => log(`   - #${issue}`, colors.red));
  }
  
  if (results.success.length > 0) {
    log('');
    success('Successful Issues:');
    results.success.forEach(issue => log(`   - #${issue}`, colors.green));
  }
  
  log('');
}

// Command: config
function cmdConfig(action, key, value) {
  const config = loadConfig();
  
  if (action === 'show') {
    log('');
    log('⚙️  Current Configuration', colors.cyan);
    log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
    log('');
    Object.entries(config).forEach(([k, v]) => {
      log(`${k}: ${v}`);
    });
    log('');
    info(`Config file: ${CONFIG_FILE}`);
    log('');
    
  } else if (action === 'set') {
    if (!key || value === undefined) {
      error('Usage: ai-issue config set <key> <value>');
      process.exit(1);
    }
    config[key] = value;
    saveConfig(config);
    
  } else if (action === 'get') {
    if (!key) {
      error('Usage: ai-issue config get <key>');
      process.exit(1);
    }
    log(config[key] || '');
    
  } else if (action === 'reset') {
    saveConfig(DEFAULT_CONFIG);
    success('Configuration reset to default values');
    
  } else {
    error(`Unknown action: ${action}`);
    error('Available actions: show, set, get, reset');
    process.exit(1);
  }
}

// Command: check
function cmdCheck() {
  const config = loadConfig();
  
  log('');
  log('🔍 Environment Check', colors.cyan);
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', colors.cyan);
  log('');
  
  const checks = checkEnvironment(config);
  let allOk = true;
  
  checks.forEach((check, index) => {
    const prefix = check.status ? '✅' : '❌';
    const color = check.status ? colors.green : colors.red;
    log(`${index + 1}. ${prefix} ${check.name}`, color);
    if (!check.status && check.help) {
      log(`   💡 ${check.help}`, colors.yellow);
    }
    allOk = allOk && check.status;
  });
  
  log('');
  log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', allOk ? colors.green : colors.red);
  
  if (allOk) {
    success('All checks passed!');
  } else {
    error('Some checks failed, please fix the above issues');
    process.exit(1);
  }
  
  log('');
}

// Show help
function showHelp() {
  log('');
  log('🤖 AI Issue CLI - Automated Issue Resolution and Evaluation Tool', colors.cyan);
  log('');
  log('Usage: ai-issue <command> [options]', colors.bright);
  log('');
  log('Commands:', colors.bright);
  log('  solve <number>          Solve specified Issue');
  log('  evaluate <number>       Evaluate solved Issue');
  log('  batch <numbers...>      Batch process multiple Issues');
  log('  config <action>         Manage configuration');
  log('  check                   Check environment configuration');
  log('  version                 Show version information');
  log('  help                    Show this help message');
  log('');
  log('Options:', colors.bright);
  log('  --no-eval               Only solve Issue, do not evaluate');
  log('  --model <model>         Specify AI model (gpt-5 or claude-sonnet-4.5)');
  log('  --concurrency <number>  Parallel instances for batch (default: 3)');
  log('');
  log('Examples:', colors.bright);
  log('  ai-issue solve 30340');
  log('  ai-issue solve 30340 --no-eval');
  log('  ai-issue evaluate 30340');
  log('  ai-issue batch 30340 31316 31500');
  log('  ai-issue batch 30340 31316 31500 --concurrency 5');
  log('  ai-issue config show');
  log('  ai-issue config set model gpt-5');
  log('  ai-issue check');
  log('');
  log('Configuration:', colors.bright);
  log('  Config file: ~/.ai-issue/config.json');
  log('  Environment variables:');
  log('    AI_ISSUE_REPO_PATH      Repository path');
  log('    AI_ISSUE_REPORT_PATH    Report path');
  log('    AI_ISSUE_MODEL          AI model');
  log('    AI_ISSUE_LOG_LEVEL      Log level');
  log('');
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    showHelp();
    process.exit(0);
  }
  
  const command = args[0];
  const options = {
    noEval: args.includes('--no-eval'),
    model: args.includes('--model') ? args[args.indexOf('--model') + 1] : null,
    concurrency: args.includes('--concurrency') ? parseInt(args[args.indexOf('--concurrency') + 1]) : 3
  };
  
  // Update config if model is specified
  if (options.model) {
    const config = loadConfig();
    config.model = options.model;
  }
  
  try {
    switch (command) {
      case 'solve':
        if (args.length < 2) {
          error('Usage: ai-issue solve <issue_number>');
          process.exit(1);
        }
        await cmdSolve(args[1], options);
        break;
        
      case 'evaluate':
      case 'eval':
        if (args.length < 2) {
          error('Usage: ai-issue evaluate <issue_number>');
          process.exit(1);
        }
        await cmdEvaluate(args[1], options);
        break;
        
      case 'batch':
        if (args.length < 2) {
          error('Usage: ai-issue batch <issue1> [issue2] [issue3] ...');
          process.exit(1);
        }
        const issues = args.slice(1).filter(arg => !arg.startsWith('--'));
        await cmdBatch(issues, options);
        break;
        
      case 'config':
        if (args.length < 2) {
          cmdConfig('show');
        } else {
          cmdConfig(args[1], args[2], args[3]);
        }
        break;
        
      case 'check':
        cmdCheck();
        break;
        
      case 'version':
      case '--version':
      case '-v':
        log(`ai-issue v${VERSION}`);
        break;
        
      case 'help':
      case '--help':
      case '-h':
        showHelp();
        break;
        
      default:
        error(`Unknown command: ${command}`);
        log('Run "ai-issue help" to see available commands');
        process.exit(1);
    }
  } catch (err) {
    error(`Execution failed: ${err.message}`);
    if (err.stack && process.env.DEBUG) {
      console.error(err.stack);
    }
    process.exit(1);
  }
}

// Run
if (require.main === module) {
  main().catch(err => {
    error(`Fatal error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { main };
