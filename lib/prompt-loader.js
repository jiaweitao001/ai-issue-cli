// @ts-check
/**
 * Prompt file loader with fallback path resolution
 */

const fs = require('fs');
const path = require('path');

// Candidate directories for prompt files, ordered by priority
const PROMPT_DIRS = [
  path.join(__dirname, '..', 'prompts'),       // project root: <project>/prompts
  path.join(__dirname, 'prompts'),              // fallback: lib/prompts (unlikely but safe)
];

/**
 * Load a prompt file by name, searching candidate directories.
 * @param {string} filename - The prompt filename (e.g. 'PHASE1_RESEARCH_PROMPT.md')
 * @returns {string} - The prompt file content
 * @throws {Error} If the prompt file is not found in any candidate directory
 */
function loadPrompt(filename) {
  for (const dir of PROMPT_DIRS) {
    const filePath = path.join(dir, filename);
    if (fs.existsSync(filePath)) {
      return fs.readFileSync(filePath, 'utf8');
    }
  }

  throw new Error(`Prompt file not found: ${filename}`);
}

module.exports = {
  loadPrompt
};
