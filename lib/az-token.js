// @ts-check

/**
 * Azure CLI token helper.
 * Retrieves an AAD access token by spawning `az account get-access-token`.
 * Requires the user to have run `az login` beforehand.
 */

const { execSync } = require('child_process');
const { debug } = require('./logger');

/** @type {{ accessToken: string, expiresOn: number } | null} */
let _cached = null;

// Consider token expired 2 minutes early to avoid edge-case failures
const EXPIRY_BUFFER_MS = 2 * 60 * 1000;

/**
 * Get an Azure AD access token via the Azure CLI.
 * Caches the token in memory until it expires.
 * @returns {string} A valid access token
 * @throws {Error} If `az` is not installed or user is not logged in
 */
function getAzAccessToken() {
  // Return cached token if still valid
  if (_cached && Date.now() < _cached.expiresOn - EXPIRY_BUFFER_MS) {
    debug('Using cached Azure CLI token');
    return _cached.accessToken;
  }

  let output;
  try {
    output = execSync('az account get-access-token --output json', {
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 15000
    });
  } catch (err) {
    const msg = err.stderr || err.message || '';
    if (msg.includes('not found') || msg.includes('not recognized') || err.code === 'ENOENT') {
      throw new Error(
        'Azure CLI is not installed. Install it from https://aka.ms/install-az-cli'
      );
    }
    if (msg.includes('az login') || msg.includes('Please run')) {
      throw new Error(
        'Not logged in to Azure CLI. Run `az login` first.'
      );
    }
    throw new Error(`Failed to get Azure CLI token: ${msg.trim()}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error('Failed to parse Azure CLI token response as JSON.');
  }

  if (!parsed.accessToken) {
    throw new Error('Azure CLI token response missing accessToken field.');
  }

  _cached = {
    accessToken: parsed.accessToken,
    expiresOn: new Date(parsed.expiresOn).getTime()
  };

  debug('Obtained fresh Azure CLI token');
  return _cached.accessToken;
}

/**
 * Clear the cached token (useful for testing).
 */
function clearAzTokenCache() {
  _cached = null;
}

module.exports = { getAzAccessToken, clearAzTokenCache };
