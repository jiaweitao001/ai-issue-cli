// @ts-check

/**
 * @param {string} value
 * @returns {string}
 */
function escapeAttribute(value) {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

/**
 * Append the stdout artifact protocol expected from stdout-oriented agents.
 *
 * @param {string} prompt
 * @param {import('../types').ArtifactSpec[]} expectedArtifacts
 * @returns {string}
 */
function wrapPromptWithArtifactInstructions(prompt, expectedArtifacts = []) {
  const fileArtifacts = expectedArtifacts.filter(spec => spec.kind === 'file');
  if (fileArtifacts.length === 0) return prompt;

  const blocks = fileArtifacts.map(spec => `<artifact path="${escapeAttribute(spec.path)}">
[full content of the file goes here, no truncation, no prose around the block]
</artifact>`).join('\n\n');

  return `${prompt}

---
ARTIFACT OUTPUT PROTOCOL

Your final response MUST include the following artifact block(s). The harness will extract and write them to disk:

${blocks}

Output the complete content inside each <artifact> tag. Do not abbreviate. Do not wrap the artifact content in Markdown code fences.`;
}

module.exports = {
  wrapPromptWithArtifactInstructions
};
