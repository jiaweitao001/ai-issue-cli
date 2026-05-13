// @ts-check
/**
 * Plain renderer — first-pass thin wrapper over lib/logger.
 *
 * Per docs/TUI_UX_REDESIGN_PROPOSAL.md §5.2 PR-0, PlainRenderer just forwards
 * to the existing logger so PR-0 makes ZERO user-visible output changes.
 * Subsequent PRs (PR-2 / PR-3 / PR-5) extend this to a richer facade with
 * `header` / `table` / `statusList` / `emit` etc.
 *
 * Method names align with the facade defined in §3.1 so future PRs can swap
 * implementations without touching callers.
 */

const logger = require('../logger');

class PlainRenderer {
  /**
   * @param {{ stdout?: NodeJS.WriteStream } & Record<string, any>} [_opts]
   */
  constructor(_opts) {
    // PR-0: no instance state needed. Future PRs may store stdout / chalk level.
    this.mode = 'plain';
  }

  /** @param {string} message */
  success(message) {
    logger.success(message);
  }

  /** @param {string} message */
  error(message) {
    logger.error(message);
  }

  /** @param {string} message */
  info(message) {
    logger.info(message);
  }

  /** @param {string} message */
  warn(message) {
    logger.warning(message);
  }

  /** @param {string} message */
  debug(message) {
    logger.debug(message);
  }

  /** @param {string} message */
  log(message) {
    logger.log(message);
  }
}

module.exports = {
  PlainRenderer
};
