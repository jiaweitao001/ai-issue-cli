// @ts-check

/**
 * @param {NodeJS.Platform} [platform]
 * @returns {{ supported: boolean, reason?: string }}
 */
function detectSupportedPlatform(platform = process.platform) {
  if (platform === 'win32') {
    return { supported: false, reason: 'verify-loop skipped: HashiCorp PR-CI gates require Linux/macOS/WSL shell tooling.' };
  }
  return { supported: true };
}

module.exports = {
  detectSupportedPlatform
};
