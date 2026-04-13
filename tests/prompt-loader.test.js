/**
 * Tests for lib/prompt-loader.js
 */

const fs = require('fs');
const path = require('path');

jest.mock('fs');

const { loadPrompt } = require('../lib/prompt-loader');

describe('prompt-loader', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('loadPrompt', () => {
    it('should load prompt file from first candidate directory', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('# Prompt Content');

      const result = loadPrompt('PHASE1_RESEARCH_PROMPT.md');
      expect(result).toBe('# Prompt Content');
      expect(fs.readFileSync).toHaveBeenCalledTimes(1);
    });

    it('should throw when prompt file not found in any directory', () => {
      fs.existsSync.mockReturnValue(false);

      expect(() => loadPrompt('NONEXISTENT_PROMPT.md'))
        .toThrow('Prompt file not found: NONEXISTENT_PROMPT.md');
    });

    it('should search candidate directories in order', () => {
      const checkedPaths = [];
      fs.existsSync.mockImplementation((p) => {
        checkedPaths.push(p);
        // Only found in second candidate directory
        return checkedPaths.length === 2;
      });
      fs.readFileSync.mockReturnValue('content from fallback');

      const result = loadPrompt('TEST_PROMPT.md');
      expect(result).toBe('content from fallback');
      expect(checkedPaths.length).toBe(2);
      // First path should be <project>/prompts
      expect(checkedPaths[0]).toContain('prompts');
      expect(checkedPaths[0]).toContain('TEST_PROMPT.md');
    });

    it('should include filename in error message', () => {
      fs.existsSync.mockReturnValue(false);

      expect(() => loadPrompt('MY_CUSTOM_PROMPT.md'))
        .toThrow('MY_CUSTOM_PROMPT.md');
    });

    it('should pass utf8 encoding to readFileSync', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('content');

      loadPrompt('PHASE2_SOLUTION_PROMPT.md');

      expect(fs.readFileSync).toHaveBeenCalledWith(
        expect.stringContaining('PHASE2_SOLUTION_PROMPT.md'),
        'utf8'
      );
    });

    it('should work with different prompt filenames', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('eval content');

      const result = loadPrompt('MANUAL_EVALUATION_PROMPT.md');
      expect(result).toBe('eval content');
    });
  });
});
