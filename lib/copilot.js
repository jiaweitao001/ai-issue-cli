/**
 * Copilot execution utilities
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { debug } = require('./logger');

// Execute Copilot command
function runCopilot(prompt, config, additionalArgs = [], silent = false, debugMode = false) {
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
    
    debug(`Running copilot with model: ${config.model}`);
    debug(`Log level: ${logLevel}`);
    debug(`Repository path: ${config.repoPath}`);
    debug(`Report path: ${config.reportPath}`);
    
    const args = [
      '--model', config.model,
      '--allow-all-tools',
      '--add-dir', config.repoPath,
      '--add-dir', config.reportPath,
      '--log-level', logLevel,
      '--no-color',
      '-p', promptArg,
      ...additionalArgs
    ];
    
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
  runCopilot
};
