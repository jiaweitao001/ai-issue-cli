// @ts-check

/**
 * @typedef {import('../types').TaskRequest} TaskRequest
 * @typedef {import('../types').TaskResult} TaskResult
 */

class BaseAgent {
  /**
   * @param {import('../types').Config} config
   */
  constructor(config) {
    this.config = config;
  }

  /** @returns {string} */
  get name() {
    throw new Error('subclass must implement');
  }

  /** @returns {string} */
  get displayName() {
    return `${this.name} CLI`;
  }

  /**
   * @param {TaskRequest} _req
   * @returns {Promise<TaskResult>}
   */
  async runTask(_req) {
    throw new Error('subclass must implement');
  }

  /**
   * @returns {{ installed: boolean, version: string|null, errors: string[] }}
   */
  validateInstallationSync() {
    throw new Error('subclass must implement');
  }

  /**
   * @returns {Promise<{ installed: boolean, version: string|null, errors: string[] }>}
   */
  async validateInstallation() {
    return this.validateInstallationSync();
  }

  /**
   * @returns {{ supportsMcp: boolean, supportsReadOnlyMode: boolean, gitDefault: 'no-commit'|'may-commit' }}
   */
  getCapabilities() {
    throw new Error('subclass must implement');
  }
}

module.exports = { BaseAgent };
