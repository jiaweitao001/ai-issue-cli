// @ts-check

/**
 * Tests for lib/az-token.js
 */

const { mockCreateLogger } = require('./helpers/mock-logger');
jest.mock('../lib/logger', () => mockCreateLogger());

const { execSync } = require('child_process');
jest.mock('child_process');

const { getAzAccessToken, clearAzTokenCache } = require('../lib/az-token');

describe('az-token', () => {
  const validResponse = JSON.stringify({
    accessToken: 'eyJ0eXAi.test-token',
    expiresOn: new Date(Date.now() + 3600 * 1000).toISOString(),
    subscription: 'sub-id',
    tenant: 'tenant-id'
  });

  beforeEach(() => {
    jest.clearAllMocks();
    clearAzTokenCache();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should return access token on success', () => {
    execSync.mockReturnValue(validResponse);

    const token = getAzAccessToken();

    expect(token).toBe('eyJ0eXAi.test-token');
    expect(execSync).toHaveBeenCalledWith(
      'az account get-access-token --output json',
      expect.objectContaining({ encoding: 'utf8' })
    );
  });

  it('should throw when az CLI is not installed', () => {
    const err = new Error('az: not found');
    err.stderr = 'az: not found';
    execSync.mockImplementation(() => { throw err; });

    expect(() => getAzAccessToken()).toThrow('Azure CLI is not installed');
  });

  it('should throw when az CLI is not installed (ENOENT)', () => {
    const err = new Error('spawn az ENOENT');
    err.code = 'ENOENT';
    err.stderr = '';
    execSync.mockImplementation(() => { throw err; });

    expect(() => getAzAccessToken()).toThrow('Azure CLI is not installed');
  });

  it('should throw when user is not logged in', () => {
    const err = new Error('Please run az login');
    err.stderr = 'Please run az login to setup account.';
    execSync.mockImplementation(() => { throw err; });

    expect(() => getAzAccessToken()).toThrow('az login');
  });

  it('should throw when response is not valid JSON', () => {
    execSync.mockReturnValue('not json');

    expect(() => getAzAccessToken()).toThrow('Failed to parse');
  });

  it('should throw when response is missing accessToken', () => {
    execSync.mockReturnValue(JSON.stringify({ expiresOn: '2026-01-01' }));

    expect(() => getAzAccessToken()).toThrow('missing accessToken');
  });

  it('should cache token and not spawn again on second call', () => {
    execSync.mockReturnValue(validResponse);

    const token1 = getAzAccessToken();
    const token2 = getAzAccessToken();

    expect(token1).toBe(token2);
    expect(execSync).toHaveBeenCalledTimes(1);
  });

  it('should re-fetch when cached token is expired', () => {
    const expiredResponse = JSON.stringify({
      accessToken: 'old-token',
      expiresOn: new Date(Date.now() - 1000).toISOString()
    });
    const freshResponse = JSON.stringify({
      accessToken: 'new-token',
      expiresOn: new Date(Date.now() + 3600 * 1000).toISOString()
    });

    execSync.mockReturnValueOnce(expiredResponse);
    getAzAccessToken(); // caches expired token

    execSync.mockReturnValueOnce(freshResponse);
    const token = getAzAccessToken(); // should re-fetch

    expect(token).toBe('new-token');
    expect(execSync).toHaveBeenCalledTimes(2);
  });

  it('should propagate other az errors with message', () => {
    const err = new Error('unknown error');
    err.stderr = 'Something unexpected happened';
    execSync.mockImplementation(() => { throw err; });

    expect(() => getAzAccessToken()).toThrow('Failed to get Azure CLI token: Something unexpected happened');
  });
});
