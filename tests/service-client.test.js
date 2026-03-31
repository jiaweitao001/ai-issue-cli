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
jest.mock('../lib/logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  highlight: jest.fn(s => s),
  chalk: {
    bold: { cyan: jest.fn(s => s), blue: jest.fn(s => s), green: jest.fn(s => s), grey: jest.fn(s => s) },
    cyan: jest.fn(s => s), grey: jest.fn(s => s)
  }
}));

const fs = require('fs');
const { getServiceUrl, getServiceApiKey, serviceRequest } = require('../lib/service-client');

function mockConfig(overrides = {}) {
  const config = {
    repoPath: '/test/repo',
    reportPath: '/test/reports',
    issueBaseUrl: 'https://github.com/test/repo/issues',
    ...overrides,
  };
  fs.existsSync.mockReturnValue(true);
  fs.readFileSync.mockReturnValue(JSON.stringify(config));
}

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

describe('service-client', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete process.env.AI_ISSUE_SERVICE_URL;
    delete process.env.AI_ISSUE_SERVICE_API_KEY;
    fs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('getServiceUrl', () => {
    it('should read from config', () => {
      mockConfig({ serviceUrl: 'https://my-service.example.com' });
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
      mockConfig({ serviceApiKey: 'my-secret-key' });
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
      mockConfig({ serviceUrl: 'https://service.example.com', serviceApiKey: 'test-key' });
      mockHttpsRequest(200, { status: 'ok' });

      const result = await serviceRequest('GET', '/health');
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ status: 'ok' });

      const callArgs = https.request.mock.calls[0];
      expect(callArgs[1].headers['X-Api-Key']).toBe('test-key');
    });

    it('should send JSON body for POST requests', async () => {
      mockConfig({ serviceUrl: 'https://service.example.com' });
      const { mockReq } = mockHttpsRequest(200, { ok: true });

      await serviceRequest('POST', '/triage', { issue_number: 123 });

      expect(mockReq.write).toHaveBeenCalledWith(
        expect.stringContaining('"issue_number":123')
      );
    });

    it('should append query params to URL', async () => {
      mockConfig({ serviceUrl: 'https://service.example.com' });

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
      mockConfig({ serviceUrl: 'https://service.example.com' });

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
      mockConfig({ serviceUrl: 'https://service.example.com' });

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
      mockConfig({ serviceUrl: 'https://service.example.com' });
      mockHttpsRequest(500, 'Internal Server Error');

      const result = await serviceRequest('GET', '/health');
      expect(result.status).toBe(500);
      expect(result.data).toBe('Internal Server Error');
    });
  });
});
