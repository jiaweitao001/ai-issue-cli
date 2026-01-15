/**
 * Tests for debug mode functionality
 */
const { debug } = require('../lib/logger');

describe('debug mode', () => {
  let originalConsoleLog;
  let consoleOutput;

  beforeEach(() => {
    // Capture console.log output
    consoleOutput = [];
    originalConsoleLog = console.log;
    console.log = (...args) => consoleOutput.push(args.join(' '));
    
    // Clear environment variable
    delete process.env.AI_ISSUE_DEBUG;
  });

  afterEach(() => {
    // Restore console.log
    console.log = originalConsoleLog;
    delete process.env.AI_ISSUE_DEBUG;
  });

  describe('debug function', () => {
    it('should not output when AI_ISSUE_DEBUG is not set', () => {
      debug('test message');
      
      expect(consoleOutput).toHaveLength(0);
    });

    it('should output when AI_ISSUE_DEBUG is true', () => {
      process.env.AI_ISSUE_DEBUG = 'true';
      
      debug('test message');
      
      expect(consoleOutput).toHaveLength(1);
      expect(consoleOutput[0]).toContain('[DEBUG]');
      expect(consoleOutput[0]).toContain('test message');
    });

    it('should not output when AI_ISSUE_DEBUG is false', () => {
      process.env.AI_ISSUE_DEBUG = 'false';
      
      debug('test message');
      
      expect(consoleOutput).toHaveLength(0);
    });

    it('should handle multiple debug messages', () => {
      process.env.AI_ISSUE_DEBUG = 'true';
      
      debug('message 1');
      debug('message 2');
      debug('message 3');
      
      expect(consoleOutput).toHaveLength(3);
      expect(consoleOutput[0]).toContain('message 1');
      expect(consoleOutput[1]).toContain('message 2');
      expect(consoleOutput[2]).toContain('message 3');
    });
  });
});
