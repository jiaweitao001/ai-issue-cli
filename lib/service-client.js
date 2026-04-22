/**
 * Service client — HTTP helper for calling ai-issue-service REST APIs.
 * Uses Node built-in https/http modules (no external dependencies).
 */

const http = require('http');
const https = require('https');
const { loadConfig } = require('./config');
const { debug } = require('./logger');
const { getAzAccessToken } = require('./az-token');

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
 * Resolve authentication headers.
 * Priority: Azure CLI Bearer token > API key fallback.
 * @returns {object} Headers object with auth header if available
 */
function resolveAuthHeaders() {
  try {
    const token = getAzAccessToken();
    debug('Using Azure CLI Bearer token for service auth');
    return { 'Authorization': `Bearer ${token}` };
  } catch (err) {
    debug(`Azure CLI token unavailable: ${err.message}`);
  }

  const apiKey = getServiceApiKey();
  if (apiKey) {
    debug('Falling back to API key for service auth');
    return { 'X-Api-Key': apiKey };
  }

  return {};
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

  const authHeaders = resolveAuthHeaders();
  const headers = { 'Content-Type': 'application/json', ...authHeaders };

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

/**
 * Update the solution summary for a pipeline entry.
 * @param {string} repo - e.g. "owner/repo"
 * @param {string|number} issueNumber
 * @param {string} summary - Extracted solution summary text
 * @returns {Promise<{status: number, data: any}>}
 */
function updateSolutionSummary(repo, issueNumber, summary) {
  return serviceRequest('PATCH', `/pipeline/${repo}/${issueNumber}/summary`, {
    solution_summary: summary,
  });
}

/**
 * Make a streaming HTTP request, parsing NDJSON lines.
 * @param {string} method - HTTP method
 * @param {string} path - URL path
 * @param {object} [queryParams] - Query parameters
 * @param {function} onLine - Callback for each parsed NDJSON line
 * @returns {Promise<object|null>} Resolves with the last 'summary' line, or null
 */
function serviceRequestStream(method, path, queryParams = {}, onLine = () => {}) {
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

  const authHeaders = resolveAuthHeaders();
  const headers = { 'Accept': 'application/x-ndjson', ...authHeaders };

  const client = url.protocol === 'https:' ? https : http;

  debug(`Service stream request: ${method} ${url.toString()}`);

  return new Promise((resolve, reject) => {
    const req = client.request(url, { method, headers, timeout: 600000 }, (res) => {
      if (res.statusCode >= 400) {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
        });
        return;
      }

      let buffer = '';
      let lastSummary = null;

      res.on('data', (chunk) => {
        buffer += chunk;
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep incomplete last line in buffer
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const parsed = JSON.parse(line);
            if (parsed.type === 'summary') lastSummary = parsed;
            onLine(parsed);
          } catch {
            // skip non-JSON lines
          }
        }
      });

      res.on('end', () => {
        // Process any remaining buffer
        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.type === 'summary') lastSummary = parsed;
            onLine(parsed);
          } catch {
            // skip
          }
        }
        resolve(lastSummary);
      });
    });

    req.on('error', (err) => reject(err));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Service stream request timed out'));
    });

    req.end();
  });
}

module.exports = {
  getServiceUrl,
  getServiceApiKey,
  resolveAuthHeaders,
  serviceRequest,
  serviceRequestStream,
  updateSolutionSummary,
};
