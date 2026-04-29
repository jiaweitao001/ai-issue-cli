// @ts-check

/**
 * Service connectivity health check.
 *
 * Aggregates lib/service-client.js#pingHealth + #pingAuthenticated into a
 * single structured result with human-readable fix-it hints. Used by
 * `ai-issue check` to verify the optional ai-issue-service backend.
 *
 * Design: see docs/SERVICE_CONNECTIVITY_CHECK_PROPOSAL.md
 *
 * Short-circuit policy (rubber-duck §3.1):
 *   - Transport-level failure on /health → skip auth probe (same physical
 *     path can't possibly succeed; result would be noise).
 *   - HTTP-level failure on /health (3xx/4xx/5xx) → still run auth probe;
 *     it helps distinguish "wrong path" from "wrong credential".
 *
 * IMPORTANT: this module never throws; it always resolves to a structured
 * result so commands/check.js can render uniformly.
 */

const { pingHealth, pingAuthenticated, PROBE_DEFAULT_TIMEOUT_MS } = require('./service-client');

/** @typedef {import('./types').Config} Config */
/** @typedef {import('./types').ServiceProbeResult} ServiceProbeResult */
/** @typedef {import('./types').ServiceConnectivityResult} ServiceConnectivityResult */

/**
 * Error codes that indicate a transport-level failure (no HTTP response
 * was received). Auth probe is short-circuited for these.
 */
const TRANSPORT_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  // TLS layer failures
  'CERT_HAS_EXPIRED',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN',
  // Pre-flight URL validation also short-circuits — there is no possible
  // recovery from an invalid URL.
  'INVALID_URL',
  'INVALID_SCHEMA',
]);

/**
 * @param {ServiceProbeResult} probe
 * @returns {boolean}
 */
function isTransportLevelFailure(probe) {
  if (!probe || probe.ok) return false;
  if (probe.errorCode && TRANSPORT_ERROR_CODES.has(probe.errorCode)) return true;
  return false;
}

/**
 * Build a list of human-readable hints from a probe result.
 * @param {ServiceProbeResult} probe
 * @param {'reachability'|'auth'} kind
 * @returns {string[]}
 */
function hintsFor(probe, kind) {
  if (!probe || probe.ok) return [];
  const hints = [];

  // INVALID_URL / INVALID_SCHEMA — independent of HTTP layer.
  if (probe.errorCode === 'INVALID_URL') {
    hints.push(`serviceUrl is not a valid URL: ${probe.serviceUrl || '(unknown)'}`);
    hints.push('Fix: ai-issue config set serviceUrl https://your-service.example.com');
    return hints;
  }
  if (probe.errorCode === 'INVALID_SCHEMA') {
    hints.push(`serviceUrl must use http:// or https:// (got: ${probe.serviceUrl || '(unknown)'})`);
    return hints;
  }

  // Transport-level failures.
  switch (probe.errorCode) {
    case 'ENOTFOUND':
      hints.push('DNS resolution failed. Check serviceUrl spelling, corporate DNS, or VPN.');
      return hints;
    case 'ECONNREFUSED':
      hints.push('Connection refused. The backend process may be down, or the port is wrong.');
      return hints;
    case 'ETIMEDOUT':
      hints.push('Connection timed out. Check VPN/firewall; backend may be slow or cold-starting.');
      return hints;
    case 'CERT_HAS_EXPIRED':
    case 'UNABLE_TO_VERIFY_LEAF_SIGNATURE':
    case 'DEPTH_ZERO_SELF_SIGNED_CERT':
    case 'SELF_SIGNED_CERT_IN_CHAIN':
      hints.push('TLS certificate problem. Verify serviceUrl protocol; do NOT disable cert verification in production.');
      return hints;
    default:
      // fall through to HTTP-layer / unexpected-shape handling
      break;
  }

  // HTTP-layer outcomes.
  if (probe.status && probe.status >= 300 && probe.status < 400) {
    hints.push(`Backend returned HTTP ${probe.status} (redirect). Check the schema in serviceUrl (http:// vs https://).`);
    return hints;
  }
  if (probe.status === 401) {
    if (kind === 'auth') {
      if (probe.credentialSent === 'Bearer') {
        hints.push('Azure CLI Bearer token rejected. Try: az login');
      } else if (probe.credentialSent === 'X-Api-Key') {
        hints.push('API key rejected. Verify serviceApiKey value.');
      } else {
        // credentialSent === 'none'
        const azPart = probe.azError ? `Azure CLI: ${probe.azError}` : 'Azure CLI: not attempted';
        hints.push('No credential could be resolved on the client side.');
        hints.push(`  • ${azPart}`);
        hints.push('  • API key: not configured');
        hints.push('Run `az login`, or `ai-issue config set serviceApiKey <key>`.');
      }
    } else {
      hints.push('Got 401 on /health (unexpected — /health should be unauthenticated). Backend may be misconfigured.');
    }
    return hints;
  }
  if (probe.status === 403) {
    hints.push('Request rejected (403). May be an upstream proxy / WAF; backend does not currently implement fine-grained ACL.');
    return hints;
  }
  if (probe.status && probe.status >= 500) {
    hints.push(`Backend error (HTTP ${probe.status}). Check backend logs / Azure Container Apps status.`);
    return hints;
  }

  if (probe.unexpectedShape) {
    if (kind === 'reachability') {
      hints.push('Got HTTP 200 but body is not {"status":"ok"} — may be a reverse proxy / portal page.');
    } else {
      hints.push('Got HTTP 200 but body is not a JSON array — backend may have returned an error envelope.');
    }
    if (probe.body) {
      hints.push(`First bytes of response: ${probe.body.slice(0, 100)}`);
    }
    return hints;
  }

  // Fallback.
  if (probe.error) {
    hints.push(`Probe error: ${probe.error}`);
  } else if (probe.errorCode) {
    hints.push(`Probe error code: ${probe.errorCode}`);
  } else if (probe.status) {
    hints.push(`Unexpected HTTP status: ${probe.status}`);
  }
  return hints;
}

/**
 * Run the two-stage connectivity check against ai-issue-service.
 *
 * @param {Config} config
 * @param {{ timeoutMs?: number }} [opts]
 * @returns {Promise<ServiceConnectivityResult>}
 */
async function checkServiceConnectivity(config, opts = {}) {
  const timeoutMs = opts.timeoutMs || PROBE_DEFAULT_TIMEOUT_MS;
  const serviceUrl = (config && config.serviceUrl) || '';
  const serviceApiKey = (config && config.serviceApiKey) || '';

  // Not configured — skip both probes.
  if (!serviceUrl) {
    return {
      configured: false,
      mismatch: Boolean(serviceApiKey),
      reachability: null,
      auth: null,
      authSkipReason: 'service not configured',
      hints: [],
    };
  }

  // Stage 1: reachability.
  const reachability = await pingHealth(timeoutMs);

  // Stage 2: auth — short-circuit only on transport-level failures.
  let auth = null;
  let authSkipReason = null;
  if (isTransportLevelFailure(reachability)) {
    authSkipReason = 'transport-level failure on /health';
  } else {
    auth = await pingAuthenticated(timeoutMs);
  }

  // Aggregate hints.
  const hints = [
    ...hintsFor(reachability, 'reachability'),
    ...(auth ? hintsFor(auth, 'auth') : []),
  ];

  return {
    configured: true,
    mismatch: false,
    reachability,
    auth,
    authSkipReason,
    hints,
  };
}

module.exports = {
  checkServiceConnectivity,
  isTransportLevelFailure,
  hintsFor,
  TRANSPORT_ERROR_CODES,
};
