/**
 * Tests for lib/service-client.js
 */
const http = require('http');
const https = require('https');

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));
jest.mock('fs');
jest.mock('child_process');

// Mock logger
const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());

// Mock config module directly so loadConfig returns a clean, controllable config
// This avoids pollution from real ~/.ai-issue/config.json and env vars
const mockLoadConfig = jest.fn();
jest.mock('../lib/config', () => ({
  loadConfig: mockLoadConfig,
  DEFAULT_CONFIG: {},
  CONFIG_FILE: '/mock/home/.ai-issue/config.json',
  saveConfig: jest.fn(),
  isConfigured: jest.fn(),
  validateConfig: jest.fn(),
  VERSION: '0.0.0-test',
}));

const fs = require('fs');
const { getServiceUrl, getServiceApiKey, serviceRequest } = require('../lib/service-client');

function mockHttpsRequest(statusCode, responseBody) {
  const mockRes = {
    statusCode,
    on: jest.fn((event, cb) => {
      if (event === 'data') cb(typeof responseBody === 'string' ? responseBody : JSON.stringify(responseBody));
      if (event === 'end') cb();
      return mockRes;
    }),
  };
  const mockReq = {
    on: jest.fn().mockReturnThis(),
    write: jest.fn(),
    end: jest.fn(),
    destroy: jest.fn(),
  };
  jest.spyOn(https, 'request').mockImplementation((url, opts, callback) => {
    callback(mockRes);
    return mockReq;
  });
  return { mockReq, mockRes };
}

/** Default empty config — no service URL, no API key */
const EMPTY_CONFIG = {
  repoPath: '/test/repo',
  reportPath: '/test/reports',
  issueBaseUrl: 'https://github.com/test/repo/issues',
};

describe('service-client', () => {
  const savedEnv = {};

  beforeEach(() => {
    jest.clearAllMocks();
    // Save and delete env vars to prevent leaking into tests
    savedEnv.AI_ISSUE_SERVICE_URL = process.env.AI_ISSUE_SERVICE_URL;
    savedEnv.AI_ISSUE_SERVICE_API_KEY = process.env.AI_ISSUE_SERVICE_API_KEY;
    delete process.env.AI_ISSUE_SERVICE_URL;
    delete process.env.AI_ISSUE_SERVICE_API_KEY;
    // Default: loadConfig returns empty config (no serviceUrl, no serviceApiKey)
    mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG });
  });

  afterEach(() => {
    jest.restoreAllMocks();
    // Restore env vars
    if (savedEnv.AI_ISSUE_SERVICE_URL !== undefined) {
      process.env.AI_ISSUE_SERVICE_URL = savedEnv.AI_ISSUE_SERVICE_URL;
    }
    if (savedEnv.AI_ISSUE_SERVICE_API_KEY !== undefined) {
      process.env.AI_ISSUE_SERVICE_API_KEY = savedEnv.AI_ISSUE_SERVICE_API_KEY;
    }
  });

  describe('getServiceUrl', () => {
    it('should read from config', () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://my-service.example.com' });
      expect(getServiceUrl()).toBe('https://my-service.example.com');
    });

    it('should fall back to env var', () => {
      process.env.AI_ISSUE_SERVICE_URL = 'https://env-service.example.com';
      expect(getServiceUrl()).toBe('https://env-service.example.com');
    });

    it('should return empty string when not configured', () => {
      expect(getServiceUrl()).toBe('');
    });
  });

  describe('getServiceApiKey', () => {
    it('should read from config', () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceApiKey: 'my-secret-key' });
      expect(getServiceApiKey()).toBe('my-secret-key');
    });

    it('should fall back to env var', () => {
      process.env.AI_ISSUE_SERVICE_API_KEY = 'env-key';
      expect(getServiceApiKey()).toBe('env-key');
    });
  });

  describe('serviceRequest', () => {
    it('should reject when no service URL configured', async () => {
      await expect(serviceRequest('GET', '/health')).rejects.toThrow('Service URL not configured');
    });

    it('should make HTTPS request with correct headers', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com', serviceApiKey: 'test-key' });
      mockHttpsRequest(200, { status: 'ok' });

      const result = await serviceRequest('GET', '/health');
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ status: 'ok' });

      const callArgs = https.request.mock.calls[0];
      expect(callArgs[1].headers['X-Api-Key']).toBe('test-key');
    });

    it('should send JSON body for POST requests', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      const { mockReq } = mockHttpsRequest(200, { ok: true });

      await serviceRequest('POST', '/triage', { issue_number: 123 });

      expect(mockReq.write).toHaveBeenCalledWith(
        expect.stringContaining('"issue_number":123')
      );
    });

    it('should append query params to URL', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });

      jest.spyOn(https, 'request').mockImplementation((url, opts, callback) => {
        expect(url.searchParams.get('owner')).toBe('alice');
        expect(url.searchParams.get('status')).toBe('queued');
        const mockRes = {
          statusCode: 200,
          on: jest.fn((event, cb) => {
            if (event === 'data') cb('[]');
            if (event === 'end') cb();
            return mockRes;
          }),
        };
        callback(mockRes);
        return { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
      });

      await serviceRequest('GET', '/pipeline', null, { owner: 'alice', status: 'queued' });
    });

    it('should skip empty query params', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });

      jest.spyOn(https, 'request').mockImplementation((url, opts, callback) => {
        expect(url.searchParams.has('empty')).toBe(false);
        expect(url.searchParams.has('nullVal')).toBe(false);
        const mockRes = {
          statusCode: 200,
          on: jest.fn((event, cb) => {
            if (event === 'data') cb('[]');
            if (event === 'end') cb();
            return mockRes;
          }),
        };
        callback(mockRes);
        return { on: jest.fn().mockReturnThis(), write: jest.fn(), end: jest.fn(), destroy: jest.fn() };
      });

      await serviceRequest('GET', '/pipeline', null, { empty: '', nullVal: null });
    });

    it('should handle network errors', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });

      jest.spyOn(https, 'request').mockImplementation(() => {
        const mockReq = {
          on: jest.fn((event, cb) => {
            if (event === 'error') {
              setTimeout(() => cb(new Error('ECONNREFUSED')), 0);
            }
            return mockReq;
          }),
          write: jest.fn(),
          end: jest.fn(),
          destroy: jest.fn(),
        };
        return mockReq;
      });

      await expect(serviceRequest('GET', '/health')).rejects.toThrow('ECONNREFUSED');
    });

    it('should handle non-JSON responses', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsRequest(500, 'Internal Server Error');

      const result = await serviceRequest('GET', '/health');
      expect(result.status).toBe(500);
      expect(result.data).toBe('Internal Server Error');
    });
  });

  describe('updateSolutionSummary', () => {
    it('should call serviceRequest with PATCH and correct body', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsRequest(200, { ok: true, issue: 123 });

      const { updateSolutionSummary } = require('../lib/service-client');
      const result = await updateSolutionSummary('test/repo', 123, 'Fix timeout');

      expect(result.status).toBe(200);
      // Verify the request was a PATCH with correct path
      const reqCall = https.request.mock.calls[0];
      const url = reqCall[0];
      expect(url.pathname).toBe('/pipeline/test/repo/123/summary');
      expect(reqCall[1].method).toBe('PATCH');
    });
  });

  describe('serviceRequestStream', () => {
    function mockHttpsStreamRequest(statusCode, ndjsonLines) {
      const mockRes = {
        statusCode,
        on: jest.fn((event, cb) => {
          if (event === 'data') {
            // Send each line as a chunk
            for (const line of ndjsonLines) {
              cb(line + '\n');
            }
          }
          if (event === 'end') cb();
          return mockRes;
        }),
      };
      const mockReq = {
        on: jest.fn().mockReturnThis(),
        write: jest.fn(),
        end: jest.fn(),
        destroy: jest.fn(),
      };
      jest.spyOn(https, 'request').mockImplementation((url, opts, callback) => {
        callback(mockRes);
        return mockReq;
      });
      return { mockReq, mockRes };
    }

    it('should parse NDJSON lines and call onLine', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsStreamRequest(200, [
        '{"type":"progress","current":0,"total":10}',
        '{"type":"issue","number":100,"status":"solved"}',
        '{"type":"summary","imported":1,"skipped":0}',
      ]);

      const { serviceRequestStream } = require('../lib/service-client');
      const lines = [];
      const result = await serviceRequestStream('POST', '/import/test/repo', {}, (line) => {
        lines.push(line);
      });

      expect(lines).toHaveLength(3);
      expect(lines[0].type).toBe('progress');
      expect(lines[1].type).toBe('issue');
      expect(lines[2].type).toBe('summary');
      // Returns last summary
      expect(result).toEqual({ type: 'summary', imported: 1, skipped: 0 });
    });

    it('should reject on HTTP error status', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsStreamRequest(409, ['Already running']);

      const { serviceRequestStream } = require('../lib/service-client');
      await expect(serviceRequestStream('POST', '/import/test/repo', {}))
        .rejects.toThrow('HTTP 409');
    });

    it('should reject when service URL not configured', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG });

      const { serviceRequestStream } = require('../lib/service-client');
      await expect(serviceRequestStream('POST', '/import/test/repo', {}))
        .rejects.toThrow('Service URL not configured');
    });

    it('should skip non-JSON lines gracefully', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsStreamRequest(200, [
        '{"type":"summary","imported":0}',
        'not valid json',
        '',
      ]);

      const { serviceRequestStream } = require('../lib/service-client');
      const lines = [];
      await serviceRequestStream('POST', '/import/test/repo', {}, (line) => lines.push(line));
      expect(lines).toHaveLength(1);
    });

    it('should pass query params in URL', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsStreamRequest(200, ['{"type":"summary","imported":0}']);

      const { serviceRequestStream } = require('../lib/service-client');
      await serviceRequestStream('POST', '/import/test/repo', { mode: 'full', state: 'open' });

      const url = https.request.mock.calls[0][0];
      expect(url.searchParams.get('mode')).toBe('full');
      expect(url.searchParams.get('state')).toBe('open');
    });

    it('should set Accept header to application/x-ndjson', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsStreamRequest(200, ['{"type":"summary","imported":0}']);

      const { serviceRequestStream } = require('../lib/service-client');
      await serviceRequestStream('POST', '/import/test/repo', {});

      const opts = https.request.mock.calls[0][1];
      expect(opts.headers['Accept']).toBe('application/x-ndjson');
    });

    it('should include API key in headers', async () => {
      mockLoadConfig.mockReturnValue({
        ...EMPTY_CONFIG,
        serviceUrl: 'https://service.example.com',
        serviceApiKey: 'my-secret',
      });
      mockHttpsStreamRequest(200, ['{"type":"summary","imported":0}']);

      const { serviceRequestStream } = require('../lib/service-client');
      await serviceRequestStream('POST', '/import/test/repo', {});

      const opts = https.request.mock.calls[0][1];
      expect(opts.headers['X-Api-Key']).toBe('my-secret');
    });

    it('should return null when no summary line', async () => {
      mockLoadConfig.mockReturnValue({ ...EMPTY_CONFIG, serviceUrl: 'https://service.example.com' });
      mockHttpsStreamRequest(200, ['{"type":"progress","current":0}']);

      const { serviceRequestStream } = require('../lib/service-client');
      const result = await serviceRequestStream('POST', '/import/test/repo', {});
      expect(result).toBeNull();
    });
  });
});
