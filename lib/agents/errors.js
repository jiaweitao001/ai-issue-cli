// @ts-check

class UnsupportedArtifactKind extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'UnsupportedArtifactKind';
  }
}

class ArtifactValidationError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(message);
    this.name = 'ArtifactValidationError';
  }
}

module.exports = {
  UnsupportedArtifactKind,
  ArtifactValidationError
};
