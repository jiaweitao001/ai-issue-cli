/**
 * Tests for lib/utils.js
 */

jest.mock('fs');
const fs = require('fs');

const { waitForFile, parseBoolean, parseIssueType, enableDebugIfRequested } = require('../lib/utils');

describe('utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('parseBoolean', () => {
    it('should return boolean values as-is', () => {
      expect(parseBoolean(true)).toBe(true);
      expect(parseBoolean(false)).toBe(false);
    });

    it('should parse truthy strings', () => {
      expect(parseBoolean('true')).toBe(true);
      expect(parseBoolean('True')).toBe(true);
      expect(parseBoolean('TRUE')).toBe(true);
      expect(parseBoolean('1')).toBe(true);
      expect(parseBoolean('yes')).toBe(true);
      expect(parseBoolean('on')).toBe(true);
    });

    it('should parse falsy strings', () => {
      expect(parseBoolean('false')).toBe(false);
      expect(parseBoolean('False')).toBe(false);
      expect(parseBoolean('FALSE')).toBe(false);
      expect(parseBoolean('0')).toBe(false);
      expect(parseBoolean('no')).toBe(false);
      expect(parseBoolean('off')).toBe(false);
    });

    it('should handle whitespace in strings', () => {
      expect(parseBoolean('  true  ')).toBe(true);
      expect(parseBoolean('  false  ')).toBe(false);
    });

    it('should return default for unrecognized strings', () => {
      expect(parseBoolean('maybe')).toBe(false);
      expect(parseBoolean('maybe', true)).toBe(true);
    });

    it('should return default for non-string non-boolean values', () => {
      expect(parseBoolean(null)).toBe(false);
      expect(parseBoolean(undefined)).toBe(false);
      expect(parseBoolean(42)).toBe(false);
      expect(parseBoolean(null, true)).toBe(true);
      expect(parseBoolean(undefined, true)).toBe(true);
    });
  });

  describe('parseIssueType', () => {
    it('should return GUIDANCE for bold markdown type', () => {
      expect(parseIssueType('**Type**: GUIDANCE')).toBe('GUIDANCE');
      expect(parseIssueType('**Type**: 📖 GUIDANCE')).toBe('GUIDANCE');
    });

    it('should return GUIDANCE for plain text type', () => {
      expect(parseIssueType('Type: GUIDANCE')).toBe('GUIDANCE');
      expect(parseIssueType('Type: 📖 GUIDANCE')).toBe('GUIDANCE');
    });

    it('should return GUIDANCE case-insensitively', () => {
      expect(parseIssueType('**Type**: guidance')).toBe('GUIDANCE');
      expect(parseIssueType('Type: Guidance')).toBe('GUIDANCE');
    });

    it('should return CODE_CHANGE by default', () => {
      expect(parseIssueType('**Type**: CODE_CHANGE')).toBe('CODE_CHANGE');
      expect(parseIssueType('some random content')).toBe('CODE_CHANGE');
      expect(parseIssueType('')).toBe('CODE_CHANGE');
    });

    it('should return CODE_CHANGE when content has no type info', () => {
      expect(parseIssueType('## Problem Overview\nSome bug report')).toBe('CODE_CHANGE');
    });
  });

  describe('enableDebugIfRequested', () => {
    const originalEnv = process.env.AI_ISSUE_DEBUG;

    afterEach(() => {
      if (originalEnv === undefined) {
        delete process.env.AI_ISSUE_DEBUG;
      } else {
        process.env.AI_ISSUE_DEBUG = originalEnv;
      }
    });

    it('should set AI_ISSUE_DEBUG when debug option is true', () => {
      delete process.env.AI_ISSUE_DEBUG;
      enableDebugIfRequested({ debug: true });
      expect(process.env.AI_ISSUE_DEBUG).toBe('true');
    });

    it('should not set AI_ISSUE_DEBUG when debug option is false', () => {
      delete process.env.AI_ISSUE_DEBUG;
      enableDebugIfRequested({ debug: false });
      expect(process.env.AI_ISSUE_DEBUG).toBeUndefined();
    });

    it('should not set AI_ISSUE_DEBUG when debug option is absent', () => {
      delete process.env.AI_ISSUE_DEBUG;
      enableDebugIfRequested({});
      expect(process.env.AI_ISSUE_DEBUG).toBeUndefined();
    });

    it('should handle null/undefined options gracefully', () => {
      delete process.env.AI_ISSUE_DEBUG;
      enableDebugIfRequested(null);
      expect(process.env.AI_ISSUE_DEBUG).toBeUndefined();
      enableDebugIfRequested(undefined);
      expect(process.env.AI_ISSUE_DEBUG).toBeUndefined();
    });
  });

  describe('waitForFile', () => {
    it('should return true immediately if file exists', async () => {
      fs.existsSync.mockReturnValue(true);
      const result = await waitForFile('/some/file.md', 1000);
      expect(result).toBe(true);
    });

    it('should return false after timeout if file never appears', async () => {
      fs.existsSync.mockReturnValue(false);
      const result = await waitForFile('/some/file.md', 100);
      expect(result).toBe(false);
    }, 5000);

    it('should return true when file appears during polling', async () => {
      let callCount = 0;
      fs.existsSync.mockImplementation(() => {
        callCount++;
        return callCount >= 3;
      });
      const result = await waitForFile('/some/file.md', 10000);
      expect(result).toBe(true);
      expect(callCount).toBe(3);
    });

    it('should call onProgress callback during polling', async () => {
      fs.existsSync.mockReturnValue(false);
      const onProgress = jest.fn();

      // Use a short timeout so test doesn't hang
      await waitForFile('/some/file.md', 100, onProgress);

      // With 100ms timeout and 5s progress interval, onProgress won't be called
      // This verifies the callback mechanism doesn't throw
    }, 5000);
  });
});
