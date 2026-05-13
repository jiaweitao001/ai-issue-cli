/**
 * Tests for lib/ui/plain-renderer.js
 *
 * PR-0 contract: PlainRenderer is a thin wrapper over lib/logger; every method
 * forwards to its logger counterpart with the same arguments. This test file
 * mocks lib/logger and asserts forwarding (no snapshot of actual chalk output
 * — that's covered by tests/logger.test.js).
 */

const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const logger = require('../../lib/logger');
const { PlainRenderer } = require('../../lib/ui/plain-renderer');

describe('lib/ui/plain-renderer — PlainRenderer (PR-0 thin wrapper)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('exposes mode = "plain"', () => {
    const r = new PlainRenderer();
    expect(r.mode).toBe('plain');
  });

  it('success(msg) forwards to logger.success', () => {
    new PlainRenderer().success('hello');
    expect(logger.success).toHaveBeenCalledTimes(1);
    expect(logger.success).toHaveBeenCalledWith('hello');
  });

  it('error(msg) forwards to logger.error', () => {
    new PlainRenderer().error('boom');
    expect(logger.error).toHaveBeenCalledWith('boom');
  });

  it('info(msg) forwards to logger.info', () => {
    new PlainRenderer().info('note');
    expect(logger.info).toHaveBeenCalledWith('note');
  });

  it('warn(msg) forwards to logger.warning (NB: name mismatch is intentional facade alignment)', () => {
    new PlainRenderer().warn('careful');
    expect(logger.warning).toHaveBeenCalledWith('careful');
  });

  it('debug(msg) forwards to logger.debug', () => {
    new PlainRenderer().debug('trace');
    expect(logger.debug).toHaveBeenCalledWith('trace');
  });

  it('log(msg) forwards to logger.log', () => {
    new PlainRenderer().log('plain');
    expect(logger.log).toHaveBeenCalledWith('plain');
  });

  it('accepts an opts argument (unused in PR-0) without throwing', () => {
    expect(() => new PlainRenderer({ stdout: process.stdout })).not.toThrow();
  });
});
