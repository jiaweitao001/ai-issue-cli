const { buildAgentEnv } = require('../../lib/agents/env-builder');

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
});
