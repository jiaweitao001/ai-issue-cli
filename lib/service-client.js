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

// ─────────────────────────────────────────────────────────────────────────
// Connectivity probes (used by `ai-issue check`).
// See docs/SERVICE_CONNECTIVITY_CHECK_PROPOSAL.md for the full design.
// Probes deliberately do NOT throw; they map every error to a structured
// result so the diagnostic command can render uniformly without try/catch.
// ─────────────────────────────────────────────────────────────────────────

const PROBE_DEFAULT_TIMEOUT_MS = 5000;

/**
 * @typedef {import('./types').ServiceProbeResult} ServiceProbeResult
 */

/**
 * Resolve a credential for the connectivity check probe.
 *
 * Unlike resolveAuthHeaders() which silently swallows Azure CLI failures,
 * this version surfaces the failure reason so the diagnostic command can
 * tell users WHY no Bearer token was sent (e.g. "az not logged in").
 *
 * @returns {{
 *   headers: object,
 *   credentialSent: 'Bearer'|'X-Api-Key'|'none',
 *   sourcesTried: string[],
 *   azError: string|null,
 * }}
 */
function resolveCredentialForCheck() {
  const sourcesTried = [];
  let azError = null;

  sourcesTried.push('azure-cli');
  try {
    const token = getAzAccessToken();
    debug('Probe using Azure CLI Bearer token');
    return {
      headers: { 'Authorization': `Bearer ${token}` },
      credentialSent: 'Bearer',
      sourcesTried,
      azError: null,
    };
  } catch (err) {
    azError = err && err.message ? err.message : String(err);
    debug(`Probe: Azure CLI token unavailable: ${azError}`);
  }

  sourcesTried.push('api-key');
  const apiKey = getServiceApiKey();
  if (apiKey) {
    debug('Probe falling back to API key');
    return {
      headers: { 'X-Api-Key': apiKey },
      credentialSent: 'X-Api-Key',
      sourcesTried,
      azError,
    };
  }

  return { headers: {}, credentialSent: 'none', sourcesTried, azError };
}

/**
 * Validate serviceUrl and build the probe target URL.
 * Returns either { url } on success or { errorCode, error } on failure.
 *
 * @param {string} serviceUrl
 * @param {string} pathname  e.g. '/health'
 * @param {object} [searchParams] optional query-string params
 * @returns {{ url: URL } | { errorCode: string, error: string }}
 */
function buildProbeUrl(serviceUrl, pathname, searchParams) {
  let parsed;
  try {
    parsed = new URL(serviceUrl);
  } catch (err) {
    return { errorCode: 'INVALID_URL', error: err.message };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { errorCode: 'INVALID_SCHEMA', error: `Unsupported schema: ${parsed.protocol}` };
  }
  // Build target URL by replacing pathname/search (origin-only invariant
  // is enforced by validateConfig; we still rebuild defensively here).
  const target = new URL(parsed.origin);
  target.pathname = pathname;
  if (searchParams) {
    for (const [k, v] of Object.entries(searchParams)) {
      target.searchParams.set(k, String(v));
    }
  }
  return { url: target };
}

/**
 * Issue a probe request and resolve to a structured ServiceProbeResult.
 *
 * @param {URL} url
 * @param {object} headers
 * @param {number} timeoutMs
 * @param {(parsed: any, raw: string) => boolean} shapeCheck
 *        Returns true when an HTTP-200 body matches the expected shape.
 * @returns {Promise<ServiceProbeResult>}
 */
function executeProbe(url, headers, timeoutMs, shapeCheck) {
  const client = url.protocol === 'https:' ? https : http;
  const start = Date.now();

  return new Promise((resolve) => {
    let settled = false;
    const finalize = (result) => {
      if (settled) return; // Defend against timeout/error race.
      settled = true;
      resolve(result);
    };

    let req;
    try {
      req = client.request(url, { method: 'GET', headers, timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          let parsed = null;
          try { parsed = JSON.parse(data); } catch { /* leave parsed=null */ }
          const bodyOk = Boolean(shapeCheck(parsed, data));
          finalize({
            ok: res.statusCode === 200 && bodyOk,
            status: res.statusCode,
            latencyMs: Date.now() - start,
            unexpectedShape: res.statusCode === 200 && !bodyOk,
            body: data.slice(0, 200),
          });
        });
      });
    } catch (err) {
      // Synchronous failure (e.g. invalid options).
      finalize({
        ok: false,
        errorCode: err && err.code ? err.code : 'REQUEST_ERROR',
        error: err && err.message ? err.message : String(err),
        latencyMs: Date.now() - start,
      });
      return;
    }

    req.on('error', (err) => finalize({
      ok: false,
      errorCode: err && err.code ? err.code : 'REQUEST_ERROR',
      error: err && err.message ? err.message : String(err),
      latencyMs: Date.now() - start,
    }));
    req.on('timeout', () => {
      req.destroy();
      finalize({ ok: false, errorCode: 'ETIMEDOUT', latencyMs: timeoutMs });
    });
    req.end();
  });
}

/**
 * Probe `GET /health` (no auth). Verifies DNS / TCP / TLS / routing /
 * backend process. Body must parse as JSON with status === 'ok'.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<ServiceProbeResult>}
 */
function pingHealth(timeoutMs = PROBE_DEFAULT_TIMEOUT_MS) {
  const serviceUrl = getServiceUrl();
  if (!serviceUrl) {
    return Promise.resolve({ ok: false, reason: 'not_configured' });
  }

  const built = buildProbeUrl(serviceUrl, '/health');
  if ('errorCode' in built) {
    return Promise.resolve({ ...built, ok: false, serviceUrl });
  }

  debug(`Probe: GET ${built.url.toString()}`);
  return executeProbe(
    built.url,
    {},
    timeoutMs,
    (parsed) => parsed && parsed.status === 'ok'
  ).then((result) => ({ ...result, url: built.url.toString() }));
}

/**
 * Probe `GET /pipeline?limit=1` with credentials. Verifies whether the
 * client-supplied credential is accepted by the backend.
 *
 * @param {number} [timeoutMs]
 * @returns {Promise<ServiceProbeResult>}
 */
function pingAuthenticated(timeoutMs = PROBE_DEFAULT_TIMEOUT_MS) {
  const serviceUrl = getServiceUrl();
  if (!serviceUrl) {
    return Promise.resolve({ ok: false, reason: 'not_configured' });
  }

  const built = buildProbeUrl(serviceUrl, '/pipeline', { limit: 1 });
  if ('errorCode' in built) {
    return Promise.resolve({ ...built, ok: false, serviceUrl });
  }

  const credential = resolveCredentialForCheck();
  debug(`Probe: GET ${built.url.toString()} (credentialSent=${credential.credentialSent})`);

  return executeProbe(
    built.url,
    credential.headers,
    timeoutMs,
    (parsed) => Array.isArray(parsed)
  ).then((result) => ({
    ...result,
    url: built.url.toString(),
    credentialSent: credential.credentialSent,
    sourcesTried: credential.sourcesTried,
    azError: credential.azError,
  }));
}

module.exports = {
  getServiceUrl,
  getServiceApiKey,
  resolveAuthHeaders,
  resolveCredentialForCheck,
  serviceRequest,
  serviceRequestStream,
  updateSolutionSummary,
  pingHealth,
  pingAuthenticated,
  PROBE_DEFAULT_TIMEOUT_MS,
};
