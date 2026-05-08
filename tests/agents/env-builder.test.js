const { buildAgentEnv } = require('../../lib/agents/env-builder');
const os = require('os');
const path = require('path');

describe('env-builder', () => {
  it('inherits the base environment without mutating it', () => {
    const baseEnv = { EXISTING: '1' };

    const env = buildAgentEnv({ serviceUrl: 'https://service.example.com' }, baseEnv);

    expect(env).toEqual({
      EXISTING: '1',
      AI_ISSUE_SERVICE_URL: 'https://service.example.com'
    });
    expect(baseEnv).toEqual({ EXISTING: '1' });
  });

  it('adds config-derived service credentials when env values are absent', () => {
    const env = buildAgentEnv({
      serviceUrl: 'https://service.example.com',
      serviceApiKey: 'secret'
    }, {});

    expect(env.AI_ISSUE_SERVICE_URL).toBe('https://service.example.com');
    expect(env.AI_ISSUE_SERVICE_API_KEY).toBe('secret');
  });

  it('does not overwrite explicit environment values', () => {
    const env = buildAgentEnv({
      serviceUrl: 'https://service.example.com',
      serviceApiKey: 'secret'
    }, {
      AI_ISSUE_SERVICE_URL: 'https://env.example.com',
      AI_ISSUE_SERVICE_API_KEY: 'env-secret'
    });

    expect(env.AI_ISSUE_SERVICE_URL).toBe('https://env.example.com');
    expect(env.AI_ISSUE_SERVICE_API_KEY).toBe('env-secret');
  });

  it('adds knowledgeBasePath as AI_ISSUE_KB_PATH with home expansion', () => {
    const env = buildAgentEnv({
      knowledgeBasePath: '~/kb'
    }, {});

    expect(env.AI_ISSUE_KB_PATH).toBe(path.join(os.homedir(), 'kb'));
  });

  it('does not overwrite explicit AI_ISSUE_KB_PATH', () => {
    const env = buildAgentEnv({
      knowledgeBasePath: '/config/kb'
    }, {
      AI_ISSUE_KB_PATH: '/env/kb'
    });

    expect(env.AI_ISSUE_KB_PATH).toBe('/env/kb');
  });

  it('does not mutate process.env when called with default baseEnv', () => {
    const original = process.env.AI_ISSUE_KB_PATH;
    delete process.env.AI_ISSUE_KB_PATH;

    const env = buildAgentEnv({ knowledgeBasePath: '/config/kb' });

    expect(env.AI_ISSUE_KB_PATH).toBe('/config/kb');
    expect(process.env.AI_ISSUE_KB_PATH).toBeUndefined();

    if (original === undefined) {
      delete process.env.AI_ISSUE_KB_PATH;
    } else {
      process.env.AI_ISSUE_KB_PATH = original;
    }
  });
});
