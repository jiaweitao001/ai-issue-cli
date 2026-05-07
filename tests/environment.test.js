/**
 * Tests for environment.js
 */
const fs = require('fs');

jest.mock('fs');
const { mockCreateAgentModule, mockCreateAgent, mockResetAgentMocks } = require('./helpers/mock-agent');
jest.mock('../lib/agents', () => mockCreateAgentModule());

const { checkEnvironment } = require('../lib/environment');

describe('environment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockResetAgentMocks();
    mockCreateAgent.mockReturnValue({
      name: 'copilot',
      displayName: 'Copilot CLI',
      validateInstallationSync: jest.fn(() => ({ installed: true, version: '1.0.0', errors: [] }))
    });
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
