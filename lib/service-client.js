/**
 * Service client — HTTP helper for calling ai-issue-service REST APIs.
 * Uses Node built-in https/http modules (no external dependencies).
 */

const http = require('http');
const https = require('https');
const { loadConfig } = require('./config');
const { debug } = require('./logger');

/**
 * Get service URL from config or environment variable.
 * @returns {string}
 */
function getServiceUrl() {
  const config = loadConfig();
  return config.serviceUrl || process.env.AI_ISSUE_SERVICE_URL || '';
}

/**
 * Get service API key from config or environment variable.
 * @returns {string}
 */
function getServiceApiKey() {
  const config = loadConfig();
  return config.serviceApiKey || process.env.AI_ISSUE_SERVICE_API_KEY || '';
}

/**
 * Make an HTTP request to the ai-issue-service.
 * @param {string} method - HTTP method
 * @param {string} path - URL path (e.g., "/triage")
 * @param {object|null} body - Request body (will be JSON-encoded)
 * @param {object} [queryParams] - Optional query parameters
 * @returns {Promise<{status: number, data: any}>}
 */
function serviceRequest(method, path, body = null, queryParams = {}) {
  const serviceUrl = getServiceUrl();
  if (!serviceUrl) {
    return Promise.reject(new Error(
      'Service URL not configured. Set serviceUrl in config or AI_ISSUE_SERVICE_URL env var.'
    ));
  }

  const url = new URL(path, serviceUrl);
  for (const [key, value] of Object.entries(queryParams)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const apiKey = getServiceApiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) {
    headers['X-Api-Key'] = apiKey;
  }

  const payload = body ? JSON.stringify(body) : null;
  if (payload) {
    headers['Content-Length'] = Buffer.byteLength(payload);
  }

  const client = url.protocol === 'https:' ? https : http;

  debug(`Service request: ${method} ${url.toString()}`);

  return new Promise((resolve, reject) => {
    const req = client.request(url, { method, headers, timeout: 90000 }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Service request timed out'));
    });

    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

module.exports = {
  getServiceUrl,
  getServiceApiKey,
  serviceRequest,
};
