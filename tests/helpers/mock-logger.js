/**
 * Shared mock for ../../lib/logger used across test files.
 *
 * Usage:
 *   const { createMockLogger } = require('../helpers/mock-logger');
 *   jest.mock('../../lib/logger', () => createMockLogger());
 *
 * The chalk property uses a Proxy so that any property chain
 * (e.g. chalk.bold.cyan, chalk.red, chalk.bold.magenta) returns
 * a passthrough jest.fn(s => s) without needing to enumerate
 * every combination manually.
 */

/**
 * Create a recursive Proxy that returns jest.fn(s => s) when called
 * and another proxy when accessed as a property.
 */
function createChalkProxy() {
  const handler = {
    get(_target, prop) {
      // Jest internal checks
      if (prop === Symbol.toPrimitive || prop === 'asymmetricMatch') return undefined;
      return createChalkProxy();
    },
    apply(_target, _thisArg, args) {
      return args[0];
    }
  };
  return new Proxy(function (...args) { return args[0]; }, handler);
}

/**
 * Create a fresh mock logger object.
 * @returns {object} Mock logger compatible with lib/logger exports.
 */
function createMockLogger() {
  return {
    log: jest.fn(),
    error: jest.fn(),
    success: jest.fn(),
    info: jest.fn(),
    warning: jest.fn(),
    debug: jest.fn(),
    highlight: jest.fn(s => s),
    chalk: createChalkProxy()
  };
}

module.exports = { createMockLogger, createChalkProxy, mockCreateLogger: createMockLogger };
