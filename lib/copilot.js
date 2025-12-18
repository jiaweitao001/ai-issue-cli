/**
 * Copilot execution utilities
 */

const { spawn } = require('child_process');

// Execute Copilot command
function runCopilot(prompt, config, additionalArgs = [], silent = false) {
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
    // In silent mode, suppress output
    const copilot = spawn('copilot', args, {
      stdio: silent ? 'ignore' : 'inherit',
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

module.exports = {
  runCopilot
};
