/**
 * Report format validator for ai-issue-cli
 * Validates that generated reports follow the mandatory template structure
 */

// Required sections for Phase 1 Research Report
const PHASE1_REQUIRED_SECTIONS = [
  '## Problem Classification',
  '## Problem Overview',
  '## Initial Hypotheses',
  '## Code Location',
  '## Similar Implementation Comparison',
  '## SDK Tools',
  '## History Analysis',
  '## Global Impact',
  '## Key Findings',
  '## Next Steps'
];

// Required sections for Phase 2 Solution Report
const PHASE2_REQUIRED_SECTIONS = [
  '## 1. Problem Analysis',
  '## 2. Git Operation Record',
  '## 3. Pre-submission Checklist',
  '## 4. Issue Reply'
];

// Forbidden sections that indicate template violation
const FORBIDDEN_SECTIONS = [
  '## Technical Implementation',
  '## Solution Summary',
  '## Issue Information',
  '## Files Changed',
  '## Verification',
  '## Usage Example',
  '## API Reference',
  '## Notes',
  '## Import',
  '## Summary',
  '## Conclusion',
  '## Recommendations',
  '## Additional Notes',
  '## Code Changes Summary',
  '## Before/After Comparison'
];

// Required fields in Problem Analysis section
const PROBLEM_ANALYSIS_FIELDS = [
  '**Problem symptoms**:',
  '**Root cause**:',
  '**Impact scope**:',
  '**Swagger link**:'
];

// Required checklist items
const CHECKLIST_ITEMS = [
  'Modified files match Issue target?',
  'Modification scope within Issue description?',
  'No new functions/abstractions introduced?',
  'No logs added that Issue didn\'t request?',
  'Reasonable code line changes?',
  'Referenced similar PR fix styles?',
  'Field names exactly match SDK struct?',
  'New fields have acceptance tests?'
];

/**
 * Detect report type based on filename
 * @param {string} filename - The report filename
 * @returns {'research' | 'solution' | 'unknown'}
 */
function detectReportType(filename) {
  if (filename.includes('-research.md')) {
    return 'research';
  }
  if (filename.includes('-analysis-and-solution.md') || filename.includes('-solution.md')) {
    return 'solution';
  }
  return 'unknown';
}

/**
 * Validate Phase 1 Research Report
 * Note: Research reports have relaxed validation - only basic checks
 * @param {string} content - Report content
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateResearchReport(content) {
  const errors = [];
  const warnings = [];

  // Research reports only need minimal validation
  // Just check it's not empty and has a title
  if (!content || content.trim().length < 100) {
    errors.push('Report appears to be empty or too short');
  }

  if (!content.includes('# Issue #') && !content.includes('# Issue#')) {
    warnings.push('Report should have a title starting with "# Issue #"');
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Validate Phase 2 Solution Report
 * @param {string} content - Report content
 * @returns {{ valid: boolean, errors: string[], warnings: string[] }}
 */
function validateSolutionReport(content) {
  const errors = [];
  const warnings = [];

  // Check required sections
  for (const section of PHASE2_REQUIRED_SECTIONS) {
    if (!content.includes(section)) {
      errors.push(`Missing required section: ${section}`);
    }
  }

  // Check forbidden sections
  for (const section of FORBIDDEN_SECTIONS) {
    if (content.includes(section)) {
      errors.push(`Forbidden section found: ${section}`);
    }
  }

  // Check Problem Analysis fields
  for (const field of PROBLEM_ANALYSIS_FIELDS) {
    if (!content.includes(field)) {
      errors.push(`Missing field in Problem Analysis: ${field}`);
    }
  }

  // Check Git Operation Record structure
  if (!content.includes('### Branch Info')) {
    errors.push('Missing "### Branch Info" in Git Operation Record');
  }
  if (!content.includes('### Modified Files')) {
    errors.push('Missing "### Modified Files" in Git Operation Record');
  }
  if (!content.includes('### Commit Message')) {
    errors.push('Missing "### Commit Message" in Git Operation Record');
  }

  // Check for commit hash format (40 hex characters)
  const hashMatch = content.match(/Commit Hash:\s*`?([a-f0-9]+)`?/i);
  if (hashMatch) {
    if (hashMatch[1].length !== 40) {
      warnings.push(`Commit hash should be 40 characters, found ${hashMatch[1].length}`);
    }
  } else {
    errors.push('Missing or malformed Commit Hash');
  }

  // Check Pre-submission Checklist has table format
  if (!content.includes('| Check Item | Yes/No | Notes |')) {
    warnings.push('Pre-submission Checklist may not have correct table header');
  }

  // Check for unfilled Yes/No in checklist
  const checklistSection = content.split('## 3. Pre-submission Checklist')[1]?.split('## 4.')[0];
  if (checklistSection) {
    const yesNoPattern = /\|\s*\[Yes\/No\]\s*\|/g;
    const unfilledCount = (checklistSection.match(yesNoPattern) || []).length;
    if (unfilledCount > 0) {
      errors.push(`Found ${unfilledCount} unfilled checklist items (still showing [Yes/No])`);
    }
  }

  // Check Issue Reply starts correctly
  if (!content.includes('Thank you for raising the issue')) {
    warnings.push('Issue Reply should start with "Thank you for raising the issue."');
  }

  // Check for unfilled placeholders
  const placeholderPattern = /\[(?:NUMBER|One sentence|Brief|URL|branch-name|40-character|path\/to|e\.g\.|PR reference|Field names|Test file)\S*?\]/gi;
  const placeholders = content.match(placeholderPattern);
  if (placeholders && placeholders.length > 0) {
    errors.push(`Found ${placeholders.length} unfilled template placeholders`);
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings
  };
}

/**
 * Main validation function
 * @param {string} content - Report content
 * @param {string} filename - Report filename (used to detect type)
 * @returns {{ valid: boolean, type: string, errors: string[], warnings: string[] }}
 */
function validateReport(content, filename) {
  const type = detectReportType(filename);

  if (type === 'unknown') {
    return {
      valid: false,
      type: 'unknown',
      errors: ['Cannot determine report type from filename. Expected "*-research.md" or "*-analysis-and-solution.md"'],
      warnings: []
    };
  }

  const result = type === 'research'
    ? validateResearchReport(content)
    : validateSolutionReport(content);

  return {
    ...result,
    type
  };
}

/**
 * Format validation result for console output
 * @param {{ valid: boolean, type: string, errors: string[], warnings: string[] }} result
 * @returns {string}
 */
function formatValidationResult(result) {
  const lines = [];

  lines.push(`Report Type: ${result.type}`);
  lines.push(`Status: ${result.valid ? '✅ VALID' : '❌ INVALID'}`);
  lines.push('');

  if (result.errors.length > 0) {
    lines.push('Errors:');
    result.errors.forEach(err => lines.push(`  ❌ ${err}`));
    lines.push('');
  }

  if (result.warnings.length > 0) {
    lines.push('Warnings:');
    result.warnings.forEach(warn => lines.push(`  ⚠️  ${warn}`));
  }

  return lines.join('\n');
}

module.exports = {
  validateReport,
  validateResearchReport,
  validateSolutionReport,
  formatValidationResult,
  detectReportType,
  PHASE1_REQUIRED_SECTIONS,
  PHASE2_REQUIRED_SECTIONS,
  FORBIDDEN_SECTIONS
};
