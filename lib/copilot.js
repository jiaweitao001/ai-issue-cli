/**
 * Copilot execution utilities
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { debug } = require('./logger');

// Phase-specific MCP config mapping
const PHASE_CONFIG_MAP = {
  'phase1': 'mcp-config-phase1.json',
  'research': 'mcp-config-phase1.json',
  'phase2': 'mcp-config-phase2.json',
  'solution': 'mcp-config-phase2.json',
  'evaluate': 'mcp-config-evaluate.json',
  'evaluation': 'mcp-config-evaluate.json',
};

/**
 * Get MCP config file path for a specific phase
 * @param {string} phase - The phase name (phase1, phase2, evaluate, or null for default)
 * @returns {string|null} - The config file path or null if not found
 */
function getMcpConfigPath(phase = null) {
  const baseDir = path.join(__dirname, '..');
  const userConfigDir = path.join(os.homedir(), '.config', 'ai-issue-cli');
  
  // If phase is specified, look for phase-specific config
  if (phase) {
    const configFileName = PHASE_CONFIG_MAP[phase.toLowerCase()];
    if (configFileName) {
      // Check project-local first
      const localPhaseConfig = path.join(baseDir, configFileName);
      if (fs.existsSync(localPhaseConfig)) {
        debug(`Using phase-specific config: ${configFileName}`);
        return localPhaseConfig;
      }
      
      // Check user config directory
      const userPhaseConfig = path.join(userConfigDir, configFileName);
      if (fs.existsSync(userPhaseConfig)) {
        debug(`Using user phase-specific config: ${configFileName}`);
        return userPhaseConfig;
      }
    }
  }
  
  // Fallback to default config
  const localConfig = path.join(baseDir, 'mcp-config.json');
  if (fs.existsSync(localConfig)) {
    return localConfig;
  }
  
  const userConfig = path.join(userConfigDir, 'mcp-config.json');
  if (fs.existsSync(userConfig)) {
    return userConfig;
  }
  
  return null;
}

/**
 * Execute Copilot command
 * @param {string} prompt - The prompt to send to Copilot
 * @param {object} config - Configuration object
 * @param {string[]} additionalArgs - Additional command line arguments
 * @param {boolean} silent - Whether to suppress output
 * @param {boolean} debugMode - Whether to enable debug mode
 * @param {object} options - Additional options
 * @param {string} options.phase - The current phase (phase1, phase2, evaluate)
 */
function runCopilot(prompt, config, additionalArgs = [], silent = false, debugMode = false, options = {}) {
  return new Promise((resolve, reject) => {
    const isWindows = os.platform() === 'win32';
    
    // On Windows, use temp file to avoid command-line argument parsing issues
    // On Unix systems, we can pass prompt directly
    let promptFile = null;
    let promptArg;
    
    if (isWindows) {
      // Write prompt to a temporary file for Windows
      const tempDir = os.tmpdir();
      promptFile = path.join(tempDir, `copilot-prompt-${Date.now()}.txt`);
      
      try {
        fs.writeFileSync(promptFile, prompt, 'utf8');
        promptArg = `@${promptFile}`;  // Use @ prefix to read from file
      } catch (err) {
        return reject(new Error(`Failed to write prompt file: ${err.message}`));
      }
    } else {
      // On Unix, pass prompt directly
      promptArg = prompt;
    }
    
    // Use debug log level if debugMode is enabled
    const logLevel = debugMode ? 'debug' : config.logLevel;
    
    // Get phase from options
    const phase = options.phase || null;
    
    debug(`Running copilot with model: ${config.model}`);
    debug(`Log level: ${logLevel}`);
    debug(`Repository path: ${config.repoPath}`);
    debug(`Report path: ${config.reportPath}`);
    debug(`Phase: ${phase || 'default'}`);
    
    // Build base args
    const args = [
      '--model', config.model,
      '--allow-all-tools',
      '--add-dir', config.repoPath,
      '--add-dir', config.reportPath,
      '--log-level', logLevel,
      '--no-color',
    ];
    
    // Add MCP config based on phase
    const mcpConfigPath = getMcpConfigPath(phase);
    
    if (mcpConfigPath) {
      args.push('--mcp-config', mcpConfigPath);
      debug(`MCP config: ${mcpConfigPath}`);
    } else {
      debug('MCP config not found, running without skills');
    }
    
    // Add prompt and additional args
    args.push('-p', promptArg, ...additionalArgs);
    
    debug(`Copilot command: copilot ${args.join(' ').substring(0, 200)}...`);
    debug(`Prompt length: ${prompt.length} characters`);
    debug(`Additional args: ${additionalArgs.join(' ')}`);
    debug(`Silent mode: ${silent}`);
    debug(`Platform: ${isWindows ? 'Windows' : 'Unix'}`);
    if (isWindows) {
      debug(`Using temp file: ${promptFile}`);
    }
    
    // Only use shell on Windows (required for .cmd/.bat files)
    const spawnOptions = {
      stdio: silent ? 'ignore' : 'inherit',
      shell: isWindows
    };
    
    const copilot = spawn('copilot', args, spawnOptions);
    
    copilot.on('close', (code) => {
      // Clean up temp file (Windows only)
      if (promptFile) {
        try {
          if (fs.existsSync(promptFile)) {
            fs.unlinkSync(promptFile);
          }
        } catch (err) {
          // Ignore cleanup errors
        }
      }
      
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Copilot exit code: ${code}`));
      }
    });
    
    copilot.on('error', (err) => {
      // Clean up temp file on error (Windows only)
      if (promptFile) {
        try {
          if (fs.existsSync(promptFile)) {
            fs.unlinkSync(promptFile);
          }
        } catch (cleanupErr) {
          // Ignore cleanup errors
        }
      }
      reject(err);
    });
  });
}

module.exports = {
  runCopilot,
  getMcpConfigPath
};
