/**
 * Copilot execution utilities
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Execute Copilot command
function runCopilot(prompt, config, additionalArgs = [], silent = false) {
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
    
    const args = [
      '--model', config.model,
      '--allow-all-tools',
      '--add-dir', config.repoPath,
      '--add-dir', config.reportPath,
      '--log-level', config.logLevel,
      '--no-color',
      '-p', promptArg,
      ...additionalArgs
    ];
    
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
