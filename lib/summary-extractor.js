// @ts-check
/**
 * Extract a solution summary from a Phase 2 analysis/solution report (Markdown).
 */

const fs = require('fs');

/** Headings that indicate a solution section (case-insensitive) */
const SOLUTION_HEADINGS = [
  /^##\s+solution/i,
  /^##\s+fix/i,
  /^##\s+changes/i,
  /^##\s+implementation/i,
  /^##\s+resolution/i,
];

const MAX_SUMMARY_LENGTH = 500;

/**
 * Extract solution summary from a Phase 2 Markdown report.
 *
 * Strategy:
 * 1. Find a "## Solution" / "## Fix" / "## Changes" heading and extract
 *    the text until the next heading.
 * 2. Fallback: use the first heading (title) + first 200 chars of body.
 * 3. Truncate to 500 characters.
 *
 * @param {string} reportPath - Path to the Markdown report file
 * @returns {string} Extracted summary (may be empty string if file missing/empty)
 */
function extractSolutionSummary(reportPath) {
  try {
    if (!fs.existsSync(reportPath)) return '';
    const content = fs.readFileSync(reportPath, 'utf-8').trim();
    if (!content) return '';

    const lines = content.split('\n');

    // Strategy 1: Find a solution heading and extract its section
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (SOLUTION_HEADINGS.some(re => re.test(line))) {
        // Collect text from after this heading until the next heading
        const sectionLines = [];
        for (let j = i + 1; j < lines.length; j++) {
          if (/^##\s/.test(lines[j].trim())) break;
          const text = lines[j].trim();
          if (text) sectionLines.push(text);
        }
        if (sectionLines.length > 0) {
          return truncate(sectionLines.join(' '));
        }
      }
    }

    // Strategy 2: Fallback — first heading + first 200 chars
    const titleLine = lines.find(l => /^#/.test(l.trim()));
    const title = titleLine ? titleLine.replace(/^#+\s*/, '').trim() : '';
    const bodyLines = lines
      .filter(l => !/^#/.test(l.trim()) && l.trim())
      .slice(0, 5);
    const body = bodyLines.join(' ').slice(0, 200);
    const fallback = title ? `${title}: ${body}` : body;

    return truncate(fallback);
  } catch {
    return '';
  }
}

/**
 * Truncate text to MAX_SUMMARY_LENGTH characters.
 * @param {string} text
 * @returns {string}
 */
function truncate(text) {
  if (text.length <= MAX_SUMMARY_LENGTH) return text;
  return text.slice(0, MAX_SUMMARY_LENGTH);
}

module.exports = {
  extractSolutionSummary,
  MAX_SUMMARY_LENGTH,
};
