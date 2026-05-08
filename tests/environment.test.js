/**
 * Tests for environment.js
 */
const fs = require('fs');

jest.mock('fs');
const { mockCreateAgentModule, mockCreateAgent, mockResetAgentMocks } = require('./helpers/mock-agent');
jest.mock('../lib/agents', () => mockCreateAgentModule());

const { checkEnvironment } = require('../lib/environment');

describe('environment', () => {
  const originalNode = process.versions.node;
  const originalVersion = process.version;

  beforeEach(() => {
    jest.clearAllMocks();
    mockResetAgentMocks();
    mockCreateAgent.mockReturnValue({
      name: 'copilot',
      displayName: 'Copilot CLI',
      validateInstallationSync: jest.fn(() => ({ installed: true, version: '1.0.0', errors: [] }))
    });
  });

  afterEach(() => {
    Object.defineProperty(process.versions, 'node', { value: originalNode, configurable: true });
    Object.defineProperty(process, 'version', { value: originalVersion, configurable: true });
  });

  describe('checkEnvironment', () => {
    const mockConfig = {
      repoPath: '/mock/repo',
      reportPath: '/mock/reports'
    };

    it('should check Copilot CLI availability', () => {
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const copilotCheck = checks.find(c => c.name === 'Copilot CLI');
      expect(copilotCheck).toBeDefined();
      expect(copilotCheck.status).toBe(true);
    });

    it('should fail Node check when Node major version is less than 18', () => {
      Object.defineProperty(process.versions, 'node', { value: '16.20.0', configurable: true });
      Object.defineProperty(process, 'version', { value: 'v16.20.0', configurable: true });
      fs.existsSync.mockReturnValue(true);

      const checks = checkEnvironment(mockConfig);

      const nodeCheck = checks.find(c => c.name === 'Node.js v16.20.0');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck.status).toBe(false);
      expect(nodeCheck.help).toContain('Node ≥ 18 is required');
    });

    it('should pass Node check when Node major version is 18 or newer', () => {
      Object.defineProperty(process.versions, 'node', { value: '18.20.0', configurable: true });
      Object.defineProperty(process, 'version', { value: 'v18.20.0', configurable: true });
      fs.existsSync.mockReturnValue(true);

      const checks = checkEnvironment(mockConfig);

      const nodeCheck = checks.find(c => c.name === 'Node.js v18.20.0');
      expect(nodeCheck).toBeDefined();
      expect(nodeCheck.status).toBe(true);
    });

    it('should include local knowledge base placeholder when not configured', () => {
      fs.existsSync.mockReturnValue(true);

      const checks = checkEnvironment({ ...mockConfig, knowledgeBasePath: '' });

      const kbCheck = checks.find(c => c.name === 'Local Knowledge Base');
      expect(kbCheck).toBeDefined();
      expect(kbCheck.status).toBe(true);
      expect(kbCheck.detail).toBe('not configured');
    });

    it('should include redacted home path in local knowledge base placeholder', () => {
      fs.existsSync.mockReturnValue(true);

      const checks = checkEnvironment({ ...mockConfig, knowledgeBasePath: '~/kb' });

      const kbCheck = checks.find(c => c.name === 'Local Knowledge Base');
      expect(kbCheck.detail).toBe('configured: ~/kb');
    });

    it('should report Copilot CLI as missing when not installed', () => {
      mockCreateAgent.mockReturnValue({
        name: 'copilot',
        displayName: 'Copilot CLI',
        validateInstallationSync: jest.fn(() => ({
          installed: false,
          version: null,
          errors: ['Copilot CLI not found. Run: npm install -g @github/copilot']
        }))
      });
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const copilotCheck = checks.find(c => c.name === 'Copilot CLI');
      expect(copilotCheck.status).toBe(false);
      expect(copilotCheck.help).toBeDefined();
    });

    it('should check repository path exists', () => {
      fs.existsSync.mockImplementation((path) => {
        return path === mockConfig.repoPath;
      });
      
      const checks = checkEnvironment(mockConfig);
      
      const repoCheck = checks.find(c => c.name === 'Repository Path');
      expect(repoCheck).toBeDefined();
    });

    it('should check report path exists', () => {
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const reportCheck = checks.find(c => c.name === 'Report Path');
      expect(reportCheck).toBeDefined();
    });

    it('should check prompt files exist', () => {
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const promptChecks = checks.filter(c => c.name.includes('Prompt'));
      expect(promptChecks.length).toBeGreaterThan(0);
    });

    it('should check GITHUB_TOKEN is set', () => {
      const original = process.env.GITHUB_TOKEN;
      process.env.GITHUB_TOKEN = 'ghp_test_token';
      fs.existsSync.mockReturnValue(true);

      const checks = checkEnvironment(mockConfig);
      const tokenCheck = checks.find(c => c.name === 'GITHUB_TOKEN');
      expect(tokenCheck).toBeDefined();
      expect(tokenCheck.status).toBe(true);

      if (original === undefined) {
        delete process.env.GITHUB_TOKEN;
      } else {
        process.env.GITHUB_TOKEN = original;
      }
    });

    it('should report GITHUB_TOKEN as missing when not set', () => {
      const original = process.env.GITHUB_TOKEN;
      delete process.env.GITHUB_TOKEN;
      fs.existsSync.mockReturnValue(true);

      const checks = checkEnvironment(mockConfig);
      const tokenCheck = checks.find(c => c.name === 'GITHUB_TOKEN');
      expect(tokenCheck.status).toBe(false);
      expect(tokenCheck.help).toContain('github.com/settings/tokens');

      if (original !== undefined) {
        process.env.GITHUB_TOKEN = original;
      }
    });
  });
});
