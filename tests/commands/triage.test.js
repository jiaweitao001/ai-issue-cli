/**
 * Tests for commands/triage.js
 */

jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));
jest.mock('fs');
jest.mock('child_process');

// Mock logger
jest.mock('../../lib/logger', () => ({
  log: jest.fn(),
  error: jest.fn(),
  success: jest.fn(),
  info: jest.fn(),
  warning: jest.fn(),
  debug: jest.fn(),
  highlight: jest.fn(s => s),
  chalk: {
    bold: { cyan: jest.fn(s => s) },
    cyan: jest.fn(s => s),
  }
}));

// Mock service-client
jest.mock('../../lib/service-client', () => ({
  serviceRequest: jest.fn(),
  getServiceUrl: jest.fn(() => 'https://service.example.com'),
  getServiceApiKey: jest.fn(() => 'test-key'),
}));

const fs = require('fs');
const { cmdTriage, displayTriageResult } = require('../../lib/commands/triage');
const { serviceRequest } = require('../../lib/service-client');
const { log, error, info, success } = require('../../lib/logger');

describe('commands/triage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.existsSync.mockReturnValue(true);
    fs.readFileSync.mockReturnValue(JSON.stringify({
      repoPath: '/test/repo',
      reportPath: '/test/reports',
      issueBaseUrl: 'https://github.com/test/repo/issues',
    }));
  });

  describe('cmdTriage', () => {
    it('should call service and display result for PROCEED', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: {
          issue_type: 'BUG_REPORT',
          complexity: 'LOW',
          ai_solvability: 'HIGH',
          resource_name: 'azurerm_network_interface',
          confidence: 0.9,
          duplicate_of: null,
          duplicate_score: 0,
          recommendation: 'PROCEED',
          reasoning: 'Clear bug report',
          assigned_to: 'alice',
          assigned_to_name: 'Alice Wang',
        }
      });

      await cmdTriage('12345');

      expect(serviceRequest).toHaveBeenCalledWith('POST', '/triage', expect.objectContaining({
        issue_number: 12345,
      }));
      expect(log).toHaveBeenCalled();
    });

    it('should display result for SKIP', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: {
          issue_type: 'QUESTION',
          complexity: 'LOW',
          ai_solvability: 'LOW',
          resource_name: '',
          confidence: 0.8,
          duplicate_of: null,
          duplicate_score: 0,
          recommendation: 'SKIP',
          reasoning: 'This is a question',
          assigned_to: '',
          assigned_to_name: '',
        }
      });

      await cmdTriage('456');

      expect(serviceRequest).toHaveBeenCalledWith('POST', '/triage', expect.objectContaining({
        issue_number: 456,
      }));
    });

    it('should display result for NEEDS_HUMAN', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: {
          issue_type: 'CODE_CHANGE',
          complexity: 'CRITICAL',
          ai_solvability: 'LOW',
          resource_name: 'azurerm_compute_disk',
          confidence: 0.3,
          duplicate_of: null,
          duplicate_score: 0,
          recommendation: 'NEEDS_HUMAN',
          reasoning: 'Too complex',
          assigned_to: 'carol',
          assigned_to_name: 'Carol',
        }
      });

      await cmdTriage('789');
      expect(serviceRequest).toHaveBeenCalled();
    });

    it('should display duplicate info', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: {
          issue_type: 'BUG_REPORT',
          complexity: 'LOW',
          ai_solvability: 'HIGH',
          resource_name: '',
          confidence: 0.9,
          duplicate_of: 999,
          duplicate_score: 0.95,
          recommendation: 'SKIP',
          reasoning: 'Duplicate of #999',
          assigned_to: '',
          assigned_to_name: '',
        }
      });

      await cmdTriage('100');

      // Verify duplicate info is displayed
      const logCalls = log.mock.calls.map(c => c[0]);
      expect(logCalls.some(c => c && c.includes && c.includes('#999'))).toBe(true);
    });

    it('should handle HTTP errors', async () => {
      serviceRequest.mockResolvedValue({
        status: 500,
        data: { detail: 'Internal server error' },
      });

      await cmdTriage('123');

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Triage failed'));
    });

    it('should handle network errors', async () => {
      serviceRequest.mockRejectedValue(new Error('ECONNREFUSED'));

      await cmdTriage('123');

      expect(error).toHaveBeenCalledWith(expect.stringContaining('Triage failed'));
    });

    it('should parse issue number as integer', async () => {
      serviceRequest.mockResolvedValue({
        status: 200,
        data: {
          issue_type: 'BUG_REPORT',
          complexity: 'LOW',
          ai_solvability: 'HIGH',
          resource_name: '',
          confidence: 0.7,
          duplicate_of: null,
          duplicate_score: 0,
          recommendation: 'PROCEED',
          reasoning: '',
          assigned_to: '',
          assigned_to_name: '',
        }
      });

      await cmdTriage('31984');

      const callBody = serviceRequest.mock.calls[0][2];
      expect(callBody.issue_number).toBe(31984);
      expect(typeof callBody.issue_number).toBe('number');
    });
  });

  describe('displayTriageResult', () => {
    it('should display all fields for complete result', () => {
      displayTriageResult({
        recommendation: 'PROCEED',
        issue_type: 'BUG_REPORT',
        complexity: 'LOW',
        ai_solvability: 'HIGH',
        confidence: 0.85,
        resource_name: 'azurerm_nic',
        assigned_to: 'alice',
        assigned_to_name: 'Alice Wang',
        duplicate_of: null,
        duplicate_score: 0,
        reasoning: 'Clear bug',
      }, 123);

      const logCalls = log.mock.calls.map(c => c[0]);
      expect(logCalls.some(c => c && c.includes('PROCEED'))).toBe(true);
      expect(logCalls.some(c => c && c.includes('BUG_REPORT'))).toBe(true);
      expect(logCalls.some(c => c && c.includes('azurerm_nic'))).toBe(true);
      expect(logCalls.some(c => c && c.includes('Alice Wang'))).toBe(true);
    });

    it('should hide optional fields when empty', () => {
      displayTriageResult({
        recommendation: 'SKIP',
        issue_type: 'QUESTION',
        complexity: 'LOW',
        ai_solvability: 'LOW',
        confidence: 0.5,
        resource_name: '',
        assigned_to: '',
        assigned_to_name: '',
        duplicate_of: null,
        duplicate_score: 0,
        reasoning: '',
      }, 456);

      const logCalls = log.mock.calls.map(c => c[0]);
      // Should not display resource, assigned_to, duplicate, or reasoning lines
      expect(logCalls.every(c => !c || !c.includes('Resource:'))).toBe(true);
      expect(logCalls.every(c => !c || !c.includes('Assigned to:'))).toBe(true);
    });
  });
});
