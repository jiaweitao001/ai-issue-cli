/**
 * Tests for logger.js
 */
const { log, error, success, info, warning, highlight } = require('../lib/logger');

describe('logger', () => {
  let consoleSpy;
  let consoleErrorSpy;

  beforeEach(() => {
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('log', () => {
    it('should output message to console', () => {
      log('test message');
      expect(consoleSpy).toHaveBeenCalledWith('test message');
    });
  });

  describe('error', () => {
    it('should output error message with prefix', () => {
      error('error message');
      expect(consoleErrorSpy).toHaveBeenCalled();
      expect(consoleErrorSpy.mock.calls[0][0]).toContain('error message');
    });
  });

  describe('success', () => {
    it('should output success message', () => {
      success('success message');
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('success message');
    });
  });

  describe('info', () => {
    it('should output info message', () => {
      info('info message');
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('info message');
    });
  });

  describe('warning', () => {
    it('should output warning message', () => {
      warning('warning message');
      expect(consoleSpy).toHaveBeenCalled();
      expect(consoleSpy.mock.calls[0][0]).toContain('warning message');
    });
  });

  describe('highlight', () => {
    it('should return formatted string', () => {
      const result = highlight('highlighted');
      expect(typeof result).toBe('string');
    });
  });
});
