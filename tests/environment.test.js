/**
 * Tests for environment.js
 */
const { execSync } = require('child_process');
const fs = require('fs');

jest.mock('child_process');
jest.mock('fs');

const { checkEnvironment } = require('../lib/environment');

describe('environment', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkEnvironment', () => {
    const mockConfig = {
      repoPath: '/mock/repo',
      reportPath: '/mock/reports'
    };

    it('should check Copilot CLI availability', () => {
      execSync.mockReturnValue('1.0.0');
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const copilotCheck = checks.find(c => c.name === 'Copilot CLI');
      expect(copilotCheck).toBeDefined();
      expect(copilotCheck.status).toBe(true);
    });

    it('should report Copilot CLI as missing when not installed', () => {
      execSync.mockImplementation(() => {
        throw new Error('command not found');
      });
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const copilotCheck = checks.find(c => c.name === 'Copilot CLI');
      expect(copilotCheck.status).toBe(false);
      expect(copilotCheck.help).toBeDefined();
    });

    it('should check repository path exists', () => {
      execSync.mockReturnValue('1.0.0');
      fs.existsSync.mockImplementation((path) => {
        return path === mockConfig.repoPath;
      });
      
      const checks = checkEnvironment(mockConfig);
      
      const repoCheck = checks.find(c => c.name === 'Repository Path');
      expect(repoCheck).toBeDefined();
    });

    it('should check report path exists', () => {
      execSync.mockReturnValue('1.0.0');
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const reportCheck = checks.find(c => c.name === 'Report Path');
      expect(reportCheck).toBeDefined();
    });

    it('should check prompt files exist', () => {
      execSync.mockReturnValue('1.0.0');
      fs.existsSync.mockReturnValue(true);
      
      const checks = checkEnvironment(mockConfig);
      
      const promptChecks = checks.filter(c => c.name.includes('Prompt'));
      expect(promptChecks.length).toBeGreaterThan(0);
    });
  });
});
