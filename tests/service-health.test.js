/**
 * Tests for lib/service-health.js
 */

// Mock logger first (CLAUDE.md convention).
const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());

// Mock service-client probes — service-health.js is the high-level
// aggregator and should be tested in isolation from the network layer.
const mockPingHealth = jest.fn();
const mockPingAuthenticated = jest.fn();
jest.mock('../lib/service-client', () => ({
  pingHealth: mockPingHealth,
  pingAuthenticated: mockPingAuthenticated,
  PROBE_DEFAULT_TIMEOUT_MS: 5000,
}));

const {
  checkServiceConnectivity,
  isTransportLevelFailure,
  hintsFor,
  TRANSPORT_ERROR_CODES,
} = require('../lib/service-health');

describe('service-health', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('isTransportLevelFailure', () => {
    it('should return false for ok probes', () => {
      expect(isTransportLevelFailure({ ok: true, status: 200 })).toBe(false);
    });

    it('should return false for HTTP-layer failures', () => {
      expect(isTransportLevelFailure({ ok: false, status: 401 })).toBe(false);
      expect(isTransportLevelFailure({ ok: false, status: 308 })).toBe(false);
      expect(isTransportLevelFailure({ ok: false, status: 500 })).toBe(false);
    });

    it('should return true for transport errors', () => {
      expect(isTransportLevelFailure({ ok: false, errorCode: 'ECONNREFUSED' })).toBe(true);
      expect(isTransportLevelFailure({ ok: false, errorCode: 'ENOTFOUND' })).toBe(true);
      expect(isTransportLevelFailure({ ok: false, errorCode: 'ETIMEDOUT' })).toBe(true);
    });

    it('should return true for INVALID_URL / INVALID_SCHEMA', () => {
      expect(isTransportLevelFailure({ ok: false, errorCode: 'INVALID_URL' })).toBe(true);
      expect(isTransportLevelFailure({ ok: false, errorCode: 'INVALID_SCHEMA' })).toBe(true);
    });

    it('should return true for TLS errors', () => {
      expect(isTransportLevelFailure({ ok: false, errorCode: 'CERT_HAS_EXPIRED' })).toBe(true);
      expect(isTransportLevelFailure({ ok: false, errorCode: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' })).toBe(true);
    });

    it('should be defensive against null', () => {
      expect(isTransportLevelFailure(null)).toBe(false);
    });
  });

  describe('hintsFor', () => {
    it('should produce no hints for ok probe', () => {
      expect(hintsFor({ ok: true, status: 200 }, 'reachability')).toEqual([]);
    });

    it('should hint config fix for INVALID_URL', () => {
      const hints = hintsFor({ ok: false, errorCode: 'INVALID_URL', serviceUrl: '://nope' }, 'reachability');
      expect(hints.some(h => h.includes('not a valid URL'))).toBe(true);
      expect(hints.some(h => h.includes('ai-issue config set serviceUrl'))).toBe(true);
    });

    it('should hint schema fix for INVALID_SCHEMA', () => {
      const hints = hintsFor({ ok: false, errorCode: 'INVALID_SCHEMA', serviceUrl: 'ftp://x' }, 'reachability');
      expect(hints.some(h => h.includes('http://'))).toBe(true);
    });

    it('should hint DNS for ENOTFOUND', () => {
      const hints = hintsFor({ ok: false, errorCode: 'ENOTFOUND' }, 'reachability');
      expect(hints.some(h => h.includes('DNS'))).toBe(true);
    });

    it('should hint refused for ECONNREFUSED', () => {
      const hints = hintsFor({ ok: false, errorCode: 'ECONNREFUSED' }, 'reachability');
      expect(hints.some(h => h.includes('refused'))).toBe(true);
    });

    it('should hint VPN/timeout for ETIMEDOUT', () => {
      const hints = hintsFor({ ok: false, errorCode: 'ETIMEDOUT' }, 'reachability');
      expect(hints.some(h => h.includes('timed out'))).toBe(true);
    });

    it('should hint TLS for cert errors', () => {
      const hints = hintsFor({ ok: false, errorCode: 'CERT_HAS_EXPIRED' }, 'reachability');
      expect(hints.some(h => h.includes('TLS'))).toBe(true);
    });

    it('should hint redirect for 3xx', () => {
      const hints = hintsFor({ ok: false, status: 308 }, 'reachability');
      expect(hints.some(h => h.includes('redirect'))).toBe(true);
      expect(hints.some(h => h.includes('schema'))).toBe(true);
    });

    it('should hint az login for auth 401 with Bearer', () => {
      const hints = hintsFor({ ok: false, status: 401, credentialSent: 'Bearer' }, 'auth');
      expect(hints.some(h => h.includes('az login'))).toBe(true);
    });

    it('should hint API key check for auth 401 with X-Api-Key', () => {
      const hints = hintsFor({ ok: false, status: 401, credentialSent: 'X-Api-Key' }, 'auth');
      expect(hints.some(h => h.includes('API key rejected'))).toBe(true);
      expect(hints.some(h => h.includes('serviceApiKey'))).toBe(true);
    });

    it('should hint no-credential and surface azError for auth 401 with credentialSent=none', () => {
      const hints = hintsFor({
        ok: false,
        status: 401,
        credentialSent: 'none',
        azError: 'Not logged in to Azure CLI',
      }, 'auth');
      expect(hints.some(h => h.includes('No credential'))).toBe(true);
      expect(hints.some(h => h.includes('Not logged in to Azure CLI'))).toBe(true);
      expect(hints.some(h => h.includes('az login'))).toBe(true);
    });

    it('should warn 401 on /health is unexpected', () => {
      const hints = hintsFor({ ok: false, status: 401 }, 'reachability');
      expect(hints.some(h => h.includes('unexpected'))).toBe(true);
    });

    it('should hint proxy/WAF for 403', () => {
      const hints = hintsFor({ ok: false, status: 403, credentialSent: 'Bearer' }, 'auth');
      expect(hints.some(h => h.includes('proxy') || h.includes('WAF'))).toBe(true);
    });

    it('should hint backend logs for 5xx', () => {
      const hints = hintsFor({ ok: false, status: 503 }, 'reachability');
      expect(hints.some(h => h.includes('backend logs') || h.includes('Container Apps'))).toBe(true);
    });

    it('should hint reverse-proxy for unexpectedShape on reachability', () => {
      const hints = hintsFor({
        ok: false, status: 200, unexpectedShape: true, body: '<html>portal</html>',
      }, 'reachability');
      expect(hints.some(h => h.includes('reverse proxy') || h.includes('portal'))).toBe(true);
      expect(hints.some(h => h.includes('First bytes'))).toBe(true);
    });

    it('should hint envelope for unexpectedShape on auth', () => {
      const hints = hintsFor({
        ok: false, status: 200, unexpectedShape: true, body: '{"detail":"fail"}',
      }, 'auth');
      expect(hints.some(h => h.includes('JSON array'))).toBe(true);
    });
  });

  describe('checkServiceConnectivity', () => {
    it('should return not_configured when serviceUrl is empty', async () => {
      const result = await checkServiceConnectivity({ serviceUrl: '', serviceApiKey: '' });
      expect(result.configured).toBe(false);
      expect(result.mismatch).toBe(false);
      expect(result.reachability).toBeNull();
      expect(result.auth).toBeNull();
      expect(result.hints).toEqual([]);
      expect(mockPingHealth).not.toHaveBeenCalled();
      expect(mockPingAuthenticated).not.toHaveBeenCalled();
    });

    it('should flag mismatch when apiKey set but url empty', async () => {
      const result = await checkServiceConnectivity({ serviceUrl: '', serviceApiKey: 'k' });
      expect(result.configured).toBe(false);
      expect(result.mismatch).toBe(true);
    });

    it('should report all green when both probes succeed', async () => {
      mockPingHealth.mockResolvedValue({ ok: true, status: 200, latencyMs: 100 });
      mockPingAuthenticated.mockResolvedValue({ ok: true, status: 200, latencyMs: 200, credentialSent: 'Bearer' });

      const result = await checkServiceConnectivity({ serviceUrl: 'https://svc.example.com' });
      expect(result.configured).toBe(true);
      expect(result.reachability.ok).toBe(true);
      expect(result.auth.ok).toBe(true);
      expect(result.hints).toEqual([]);
      expect(result.authSkipReason).toBeNull();
    });

    it('should short-circuit auth when reachability has transport error', async () => {
      mockPingHealth.mockResolvedValue({ ok: false, errorCode: 'ETIMEDOUT', latencyMs: 5000 });

      const result = await checkServiceConnectivity({ serviceUrl: 'https://svc.example.com' });
      expect(result.reachability.ok).toBe(false);
      expect(result.auth).toBeNull();
      expect(result.authSkipReason).toContain('transport-level failure');
      expect(mockPingAuthenticated).not.toHaveBeenCalled();
      expect(result.hints.some(h => h.includes('timed out'))).toBe(true);
    });

    it('should still run auth when reachability has HTTP-layer failure (308)', async () => {
      mockPingHealth.mockResolvedValue({ ok: false, status: 308, latencyMs: 80 });
      mockPingAuthenticated.mockResolvedValue({ ok: false, status: 308, latencyMs: 90, credentialSent: 'Bearer' });

      const result = await checkServiceConnectivity({ serviceUrl: 'https://svc.example.com' });
      expect(result.reachability.ok).toBe(false);
      expect(result.auth.ok).toBe(false);
      expect(mockPingAuthenticated).toHaveBeenCalled();
      // both probes contribute redirect hints
      const redirectHints = result.hints.filter(h => h.includes('redirect'));
      expect(redirectHints.length).toBeGreaterThanOrEqual(1);
    });

    it('should short-circuit auth on INVALID_URL', async () => {
      mockPingHealth.mockResolvedValue({ ok: false, errorCode: 'INVALID_URL', serviceUrl: '://nope' });

      const result = await checkServiceConnectivity({ serviceUrl: '://nope' });
      expect(result.auth).toBeNull();
      expect(mockPingAuthenticated).not.toHaveBeenCalled();
      expect(result.hints.some(h => h.includes('not a valid URL'))).toBe(true);
    });

    it('should pass timeoutMs through to probes', async () => {
      mockPingHealth.mockResolvedValue({ ok: true, status: 200 });
      mockPingAuthenticated.mockResolvedValue({ ok: true, status: 200, credentialSent: 'Bearer' });

      await checkServiceConnectivity({ serviceUrl: 'https://svc.example.com' }, { timeoutMs: 1500 });
      expect(mockPingHealth).toHaveBeenCalledWith(1500);
      expect(mockPingAuthenticated).toHaveBeenCalledWith(1500);
    });

    it('should produce both reachability and auth hints when reachability is HTTP-layer fail', async () => {
      mockPingHealth.mockResolvedValue({ ok: false, status: 500 });
      mockPingAuthenticated.mockResolvedValue({ ok: false, status: 500, credentialSent: 'Bearer' });

      const result = await checkServiceConnectivity({ serviceUrl: 'https://svc.example.com' });
      // 5xx hints from both probes
      const fiveHundredHints = result.hints.filter(h => h.includes('500'));
      expect(fiveHundredHints.length).toBeGreaterThanOrEqual(2);
    });

    it('should be defensive against undefined config', async () => {
      const result = await checkServiceConnectivity(undefined);
      expect(result.configured).toBe(false);
    });
  });

  describe('TRANSPORT_ERROR_CODES', () => {
    it('should be a Set containing common transport errors', () => {
      expect(TRANSPORT_ERROR_CODES).toBeInstanceOf(Set);
      expect(TRANSPORT_ERROR_CODES.has('ENOTFOUND')).toBe(true);
      expect(TRANSPORT_ERROR_CODES.has('ECONNREFUSED')).toBe(true);
      expect(TRANSPORT_ERROR_CODES.has('ETIMEDOUT')).toBe(true);
    });
  });
});
