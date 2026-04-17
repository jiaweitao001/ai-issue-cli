/**
 * Tests for lib/summary-extractor.js
 */

jest.mock('fs');

const fs = require('fs');
const { extractSolutionSummary, MAX_SUMMARY_LENGTH } = require('../lib/summary-extractor');

describe('summary-extractor', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('extractSolutionSummary', () => {
    it('should extract text under ## Solution heading', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue([
        '# Issue Analysis',
        '',
        '## Research',
        'Some research content.',
        '',
        '## Solution',
        'Add custom poller with 30s interval in resource_key_vault_certificate.go.',
        'This fixes the timeout issue.',
        '',
        '## Testing',
        'Tests pass.',
      ].join('\n'));

      const result = extractSolutionSummary('/path/to/report.md');
      expect(result).toContain('Add custom poller');
      expect(result).toContain('timeout issue');
    });

    it('should extract text under ## Fix heading', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue([
        '# Report',
        '',
        '## Fix',
        'Updated the polling logic to handle edge cases.',
        '',
        '## Notes',
        'Other stuff.',
      ].join('\n'));

      const result = extractSolutionSummary('/path/to/report.md');
      expect(result).toContain('Updated the polling logic');
    });

    it('should extract text under ## Changes heading', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue([
        '# Report',
        '',
        '## Changes',
        'Modified file A and file B.',
        '',
      ].join('\n'));

      const result = extractSolutionSummary('/path/to/report.md');
      expect(result).toContain('Modified file A');
    });

    it('should extract text under ## Implementation heading', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue([
        '# Report',
        '',
        '## Implementation',
        'Implemented the new feature.',
      ].join('\n'));

      const result = extractSolutionSummary('/path/to/report.md');
      expect(result).toContain('Implemented the new feature');
    });

    it('should fallback to title + body when no solution heading', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue([
        '# Fix for Key Vault Certificate',
        '',
        'This report covers the investigation.',
        'More details here.',
      ].join('\n'));

      const result = extractSolutionSummary('/path/to/report.md');
      expect(result).toContain('Fix for Key Vault Certificate');
      expect(result).toContain('investigation');
    });

    it('should truncate to MAX_SUMMARY_LENGTH', () => {
      fs.existsSync.mockReturnValue(true);
      const longContent = 'x'.repeat(800);
      fs.readFileSync.mockReturnValue([
        '# Report',
        '',
        '## Solution',
        longContent,
      ].join('\n'));

      const result = extractSolutionSummary('/path/to/report.md');
      expect(result.length).toBe(MAX_SUMMARY_LENGTH);
    });

    it('should return empty string when file does not exist', () => {
      fs.existsSync.mockReturnValue(false);

      const result = extractSolutionSummary('/path/to/missing.md');
      expect(result).toBe('');
    });

    it('should return empty string when file is empty', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('');

      const result = extractSolutionSummary('/path/to/empty.md');
      expect(result).toBe('');
    });

    it('should return empty string when readFileSync throws', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockImplementation(() => { throw new Error('read error'); });

      const result = extractSolutionSummary('/path/to/bad.md');
      expect(result).toBe('');
    });

    it('should handle report with only whitespace', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue('   \n\n   ');

      const result = extractSolutionSummary('/path/to/whitespace.md');
      expect(result).toBe('');
    });

    it('should stop at next heading when extracting solution section', () => {
      fs.existsSync.mockReturnValue(true);
      fs.readFileSync.mockReturnValue([
        '## Solution',
        'This is the solution.',
        '',
        '## Next Section',
        'This should not be included.',
      ].join('\n'));

      const result = extractSolutionSummary('/path/to/report.md');
      expect(result).toContain('This is the solution');
      expect(result).not.toContain('should not be included');
    });
  });
});
