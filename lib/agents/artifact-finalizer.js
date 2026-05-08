// @ts-check

const { validateArtifact } = require('./artifact-validator');

/**
 * @param {import('../types').ArtifactSpec} spec
 * @param {string} message
 * @param {string[]} warnings
 * @param {Error} [error]
 * @returns {false}
 */
function handleArtifactIssue(spec, message, warnings, error) {
  if (spec.failureMode === 'warn') {
    warnings.push(message);
    return false;
  }
  throw error || new Error(message);
}

/**
 * Finalize a collected artifact with the same throw/warn validation semantics
 * for every agent adapter.
 *
 * @param {import('../types').ArtifactSpec} spec
 * @param {string} content
 * @param {Record<string, string>} artifacts
 * @param {string[]} warnings
 * @param {string} [key]
 * @returns {boolean} true when the artifact was accepted
 */
function finalizeArtifact(spec, content, artifacts, warnings, key = spec.path) {
  const validation = validateArtifact(spec, content);
  if (validation) {
    return handleArtifactIssue(spec, validation.message, warnings, validation);
  }
  artifacts[key] = content;
  return true;
}

module.exports = {
  finalizeArtifact,
  handleArtifactIssue
};
