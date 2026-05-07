// @ts-check

const { ArtifactValidationError } = require('./errors');

/**
 * @param {import('../types').ArtifactSpec} spec
 * @param {string} content
 * @returns {ArtifactValidationError|null}
 */
function validateArtifact(spec, content) {
  if (spec.requiredSection && !spec.requiredSection.test(content)) {
    return new ArtifactValidationError(`Missing required section: ${spec.requiredSection}`);
  }
  if (spec.validate && !spec.validate(content)) {
    return new ArtifactValidationError(`Validator returned false for ${spec.path}`);
  }
  return null;
}

module.exports = { validateArtifact };
