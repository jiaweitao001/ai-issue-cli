/**
 * Tests for report-validator.js
 */

const {
  validateReport,
  validateResearchReport,
  validateSolutionReport,
  detectReportType,
  PHASE1_REQUIRED_SECTIONS,
  PHASE2_REQUIRED_SECTIONS,
  FORBIDDEN_SECTIONS
} = require('../lib/report-validator');

describe('Report Validator', () => {
  describe('detectReportType', () => {
    it('should detect research report type', () => {
      expect(detectReportType('issue-123-research.md')).toBe('research');
    });

    it('should detect solution report type', () => {
      expect(detectReportType('issue-123-analysis-and-solution.md')).toBe('solution');
      expect(detectReportType('issue-456-solution.md')).toBe('solution');
    });

    it('should return unknown for invalid filenames', () => {
      expect(detectReportType('readme.md')).toBe('unknown');
      expect(detectReportType('issue-123.md')).toBe('unknown');
    });
  });

  describe('validateResearchReport', () => {
    const validResearchReport = `
# Issue #123 Research Report

## Problem Classification

**Type**: 🔧 CODE_CHANGE

This is a research report with sufficient content to pass basic validation.
The report contains analysis of the issue and findings from code investigation.
`;

    it('should validate a correct research report', () => {
      const result = validateResearchReport(validResearchReport);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject empty or too short reports', () => {
      const invalidReport = '# Short';
      const result = validateResearchReport(invalidReport);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('empty or too short'))).toBe(true);
    });

    it('should warn about missing title format', () => {
      const reportNoTitle = 'Some content here that is long enough to pass the length check but has no proper title format';
      const result = validateResearchReport(reportNoTitle);
      expect(result.warnings.some(w => w.includes('title'))).toBe(true);
    });
  });

  describe('validateSolutionReport', () => {
    const validSolutionReport = `
# Issue #123 Solution

## 1. Problem Analysis

- **Problem symptoms**: Resource fails on create
- **Root cause**: Missing validation for required field
- **Impact scope**: All users creating this resource
- **Swagger link**: https://example.com/swagger

## 2. Git Operation Record

### Branch Info
- Branch name: issue-123
- Commit Hash: a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0

### Modified Files
- \`internal/services/example/resource.go\` - Added validation

### Commit Message
\`\`\`
Fix #123: Add validation for required field
\`\`\`

## 3. Pre-submission Checklist

| Check Item | Yes/No | Notes |
|------------|--------|-------|
| Modified files match Issue target? | Yes | Only resource.go |
| Modification scope within Issue description? | Yes | Validation only |
| No new functions/abstractions introduced? | Yes | Used existing pattern |
| No logs added that Issue didn't request? | Yes | No logs |
| Reasonable code line changes? | Yes | +5/-0 lines |
| Referenced similar PR fix styles? | Yes | PR #100 |
| Field names exactly match SDK struct? | Yes | Verified |
| New fields have acceptance tests? | N/A | No new fields |

## 4. Issue Reply

\`\`\`
Thank you for raising the issue.

The root cause was missing validation for the required field in the Create function.

I've added validation using the existing validation helper pattern.
\`\`\`
`;

    it('should validate a correct solution report', () => {
      const result = validateSolutionReport(validSolutionReport);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect missing required sections', () => {
      const invalidReport = '# Issue #123 Solution\n\n## 1. Problem Analysis\n- **Problem symptoms**: test';
      const result = validateSolutionReport(invalidReport);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing required section'))).toBe(true);
    });

    it('should detect forbidden sections', () => {
      const reportWithForbidden = validSolutionReport + '\n\n## Technical Implementation\nDetails here';
      const result = validateSolutionReport(reportWithForbidden);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Forbidden section'))).toBe(true);
    });

    it('should detect missing Problem Analysis fields', () => {
      const reportMissingFields = validSolutionReport.replace('**Root cause**:', '**Cause**:');
      const result = validateSolutionReport(reportMissingFields);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('Missing field in Problem Analysis'))).toBe(true);
    });

    it('should warn about short commit hash', () => {
      const reportWithShortHash = validSolutionReport.replace(
        'a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8s9t0',
        'abc123'
      );
      const result = validateSolutionReport(reportWithShortHash);
      expect(result.warnings.some(w => w.includes('40 characters'))).toBe(true);
    });

    it('should detect unfilled checklist items', () => {
      const reportWithUnfilled = validSolutionReport.replace('| Yes |', '| [Yes/No] |');
      const result = validateSolutionReport(reportWithUnfilled);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('unfilled checklist'))).toBe(true);
    });
  });

  describe('validateReport', () => {
    it('should detect type and validate accordingly', () => {
      const result = validateReport('# Report', 'issue-123-research.md');
      expect(result.type).toBe('research');
    });

    it('should return error for unknown type', () => {
      const result = validateReport('# Report', 'random.md');
      expect(result.valid).toBe(false);
      expect(result.type).toBe('unknown');
    });
  });

  describe('Constants', () => {
    it('should have required sections defined', () => {
      expect(PHASE1_REQUIRED_SECTIONS.length).toBeGreaterThan(0);
      expect(PHASE2_REQUIRED_SECTIONS.length).toBe(4);
    });

    it('should have forbidden sections defined', () => {
      expect(FORBIDDEN_SECTIONS).toContain('## Technical Implementation');
      expect(FORBIDDEN_SECTIONS).toContain('## Solution Summary');
    });
  });
});
