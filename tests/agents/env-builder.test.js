const { buildAgentEnv, prepareSkillsMetrics, SKILLS_METRICS_ENV_VAR } = require('../../lib/agents/env-builder');
const fs = require('fs');
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

  describe('skillsMetrics', () => {
    let savedEnv;
    beforeEach(() => {
      savedEnv = process.env[SKILLS_METRICS_ENV_VAR];
      delete process.env[SKILLS_METRICS_ENV_VAR];
    });
    afterEach(() => {
      if (savedEnv === undefined) delete process.env[SKILLS_METRICS_ENV_VAR];
      else process.env[SKILLS_METRICS_ENV_VAR] = savedEnv;
    });

    it('does not inject AI_ISSUE_SKILLS_METRICS_PATH when feature is disabled', () => {
      const env = buildAgentEnv({
        skillsMetricsEnabled: false,
        skillsMetricsPath: '/some/path/skills.jsonl'
      }, {});
      expect(env[SKILLS_METRICS_ENV_VAR]).toBeUndefined();
    });

    it('injects AI_ISSUE_SKILLS_METRICS_PATH when enabled, with home expansion', () => {
      const env = buildAgentEnv({
        skillsMetricsEnabled: true,
        skillsMetricsPath: '~/metrics/skills.jsonl'
      }, {});
      expect(env[SKILLS_METRICS_ENV_VAR]).toBe(path.join(os.homedir(), 'metrics', 'skills.jsonl'));
    });

    it('does not overwrite an explicit AI_ISSUE_SKILLS_METRICS_PATH', () => {
      const env = buildAgentEnv({
        skillsMetricsEnabled: true,
        skillsMetricsPath: '/from/config.jsonl'
      }, { [SKILLS_METRICS_ENV_VAR]: '/from/env.jsonl' });
      expect(env[SKILLS_METRICS_ENV_VAR]).toBe('/from/env.jsonl');
    });

    it('does not inject when path is empty even though enabled (defensive)', () => {
      const env = buildAgentEnv({
        skillsMetricsEnabled: true,
        skillsMetricsPath: ''
      }, {});
      expect(env[SKILLS_METRICS_ENV_VAR]).toBeUndefined();
    });
  });

  describe('prepareSkillsMetrics', () => {
    let tmpDir;
    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-builder-prep-'));
    });
    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('is a no-op when feature disabled', () => {
      const target = path.join(tmpDir, 'sub', 'skills.jsonl');
      prepareSkillsMetrics({ skillsMetricsEnabled: false, skillsMetricsPath: target });
      expect(fs.existsSync(path.dirname(target))).toBe(false);
    });

    it('creates the parent directory when enabled', () => {
      const target = path.join(tmpDir, 'sub', 'nested', 'skills.jsonl');
      prepareSkillsMetrics({ skillsMetricsEnabled: true, skillsMetricsPath: target });
      expect(fs.existsSync(path.dirname(target))).toBe(true);
    });

    it('rotates existing oversized file', () => {
      const target = path.join(tmpDir, 'skills.jsonl');
      fs.writeFileSync(target, 'x'.repeat(11 * 1024 * 1024));
      prepareSkillsMetrics({ skillsMetricsEnabled: true, skillsMetricsPath: target });
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, 'skills.1.jsonl'))).toBe(true);
    });

    it('swallows errors gracefully (best-effort)', () => {
      // Pass a path with invalid character chain — should never throw
      expect(() =>
        prepareSkillsMetrics({ skillsMetricsEnabled: true, skillsMetricsPath: '' })
      ).not.toThrow();
    });
  });
});
