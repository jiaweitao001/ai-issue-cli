/**
 * General utility functions
 */

const fs = require('fs');

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

/**
 * Parse truthy string/boolean config values
 * @param {unknown} value
 * @param {boolean} defaultValue
 * @returns {boolean}
 */
function parseBoolean(value, defaultValue = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
      return true;
    }
    if (['0', 'false', 'no', 'off'].includes(normalized)) {
      return false;
    }
  }

  return defaultValue;
}

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
 * Enable debug mode if the --debug flag is set in options
 * @param {object} options - Command options
 */
function enableDebugIfRequested(options) {
  if (options && options.debug) {
    process.env.AI_ISSUE_DEBUG = 'true';
  }
}

module.exports = {
  waitForFile,
  parseBoolean,
  parseIssueType,
  enableDebugIfRequested
};
