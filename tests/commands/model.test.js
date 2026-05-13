/**
 * Tests for lib/commands/model.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home'),
}));

const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

// Mock ui/prompts so we can drive select/input from tests (PR-1: §5.3 I4 mock migration).
jest.mock('../../lib/ui/prompts', () => ({
  select: jest.fn(),
  input: jest.fn(),
  confirm: jest.fn(),
}));

// Mock config so we don't depend on a real ~/.ai-issue/config.json
const mockLoadConfig = jest.fn();
const mockSaveConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  loadConfig: mockLoadConfig,
  saveConfig: mockSaveConfig,
  DEFAULT_CONFIG: { model: 'claude-sonnet-4.5' },
  CONFIG_FILE: '/mock/home/.ai-issue/config.json',
}));

const { cmdModel } = require('../../lib/commands/model');
const { log, info, success, warning, error } = require('../../lib/logger');
const uiPrompts = require('../../lib/ui/prompts');
const modelCatalog = require('../../lib/model-catalog');

const SAMPLE = {
  schemaVersion: 1,
  catalogVersion: '2026-04-29',
  recommended: 'claude-sonnet-4.6',
  models: [
    { id: 'claude-sonnet-4.6', vendor: 'Anthropic', tier: 'standard', tags: ['coding'] },
    { id: 'claude-sonnet-4.5', vendor: 'Anthropic', tier: 'standard', tags: ['coding'] },
    { id: 'gpt-5.4', vendor: 'OpenAI', tier: 'standard', tags: ['coding'] },
  ],
};

function mockCatalogFs() {
  fs.existsSync.mockImplementation((p) => p === modelCatalog._BUILTIN_PATH);
  fs.readFileSync.mockImplementation((p) => {
    if (p === modelCatalog._BUILTIN_PATH) return JSON.stringify(SAMPLE);
    const err = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  });
}

describe('commands/model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    modelCatalog._resetCache();
    modelCatalog._resetWarned();
    mockCatalogFs();
    mockLoadConfig.mockReturnValue({ model: 'claude-sonnet-4.5' });
    mockSaveConfig.mockReset();
    uiPrompts.select.mockReset();
    uiPrompts.input.mockReset();
    if (uiPrompts.confirm && uiPrompts.confirm.mockReset) uiPrompts.confirm.mockReset();

    jest.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called');
    });
  });

  afterEach(() => {
    process.exit.mockRestore();
  });

  describe('list action', () => {
    it('prints all model ids and the catalog source line', async () => {
      await cmdModel('list');
      const allLogged = log.mock.calls.map((c) => c[0]).join('\n');
      expect(allLogged).toContain('claude-sonnet-4.6');
      expect(allLogged).toContain('claude-sonnet-4.5');
      expect(allLogged).toContain('gpt-5.4');
      expect(info).toHaveBeenCalledWith(expect.stringContaining('preset list'));
    });

    it('prints only models for the requested agent', async () => {
      const withClaude = {
        ...SAMPLE,
        recommended: { copilot: 'claude-sonnet-4.6', 'claude-code': 'sonnet' },
        models: [
          ...SAMPLE.models,
          { id: 'sonnet', agent: 'claude-code', vendor: 'Anthropic', tier: 'standard' }
        ]
      };
      fs.readFileSync.mockImplementation((p) => {
        if (p === modelCatalog._BUILTIN_PATH) return JSON.stringify(withClaude);
        const err = new Error(`ENOENT: ${p}`);
        err.code = 'ENOENT';
        throw err;
      });
      modelCatalog._resetCache();

      await cmdModel('list', { agent: 'claude-code' });

      const allLogged = log.mock.calls.map((c) => c[0]).join('\n');
      expect(allLogged).toContain('sonnet');
      expect(allLogged).not.toContain('gpt-5.4');
    });

    it('marks the recommended and current models', async () => {
      await cmdModel('list');
      const allLogged = log.mock.calls.map((c) => c[0]).join('\n');
      // claude-sonnet-4.6 is recommended; claude-sonnet-4.5 is current
      expect(allLogged).toMatch(/claude-sonnet-4\.6.*★ recommended/);
      expect(allLogged).toMatch(/claude-sonnet-4\.5.*✓ current/);
    });

    it('exits 1 if catalog cannot be loaded', async () => {
      fs.readFileSync.mockImplementation(() => {
        const err = new Error('ENOENT');
        err.code = 'ENOENT';
        throw err;
      });
      await expect(cmdModel('list')).rejects.toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to load'));
    });
  });

  describe('current action', () => {
    it('prints a single line with the current model id', async () => {
      mockLoadConfig.mockReturnValue({ model: 'gpt-5.4' });
      await cmdModel('current');
      expect(log).toHaveBeenCalledWith('gpt-5.4');
    });

    it('prints the default model when model is unset', async () => {
      mockLoadConfig.mockReturnValue({});
      await cmdModel('current');
      expect(log).toHaveBeenCalledWith('claude-sonnet-4.5');
    });
  });

  describe('default action (selector)', () => {
    it('saves the picked model via saveConfig', async () => {
      // Pick gpt-5.4 by name
      uiPrompts.select.mockResolvedValue('gpt-5.4');
      await cmdModel();

      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
      const saved = mockSaveConfig.mock.calls[0][0];
      expect(saved.agents.copilot.model).toBe('gpt-5.4');
      expect(success).toHaveBeenCalledWith(expect.stringContaining('gpt-5.4'));
    });

    it('does nothing when picked id matches current', async () => {
      // Pick claude-sonnet-4.5 (which is the current)
      uiPrompts.select.mockResolvedValue('claude-sonnet-4.5');
      await cmdModel();
      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('unchanged'));
    });

    it('handles cancellation (null) gracefully', async () => {
      uiPrompts.select.mockResolvedValue(null);
      // Make stdin look readable+TTY-ish so we hit the "Cancelled" branch, not non-interactive
      const origReadable = Object.getOwnPropertyDescriptor(process.stdin, 'readable');
      const origStdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
      Object.defineProperty(process.stdin, 'readable', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      try {
        await cmdModel();
      } finally {
        if (origReadable) Object.defineProperty(process.stdin, 'readable', origReadable);
        else { try { delete process.stdin.readable; } catch (_) { /* ignore */ } }
        if (origStdinTTY) Object.defineProperty(process.stdin, 'isTTY', origStdinTTY);
        else { try { delete process.stdin.isTTY; } catch (_) { /* ignore */ } }
      }
      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Cancelled'));
    });

    it('handles the "Enter custom model ID" path', async () => {
      // Last item's name is the custom-option sentinel
      uiPrompts.select.mockImplementation(async (items) => items[items.length - 1].name);
      uiPrompts.input.mockResolvedValue('  my-private-byok  ');
      await cmdModel();
      expect(mockSaveConfig).toHaveBeenCalledTimes(1);
      expect(mockSaveConfig.mock.calls[0][0].agents.copilot.model).toBe('my-private-byok');
      // Unknown id → warning from validateAndWarnModelOnce
      expect(warning).toHaveBeenCalledWith(expect.stringContaining('my-private-byok'));
    });

    it('does nothing when custom input is empty', async () => {
      uiPrompts.select.mockImplementation(async (items) => items[items.length - 1].name);
      uiPrompts.input.mockResolvedValue('');
      await cmdModel();
      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('No id provided'));
    });

    it('exits 1 when fully non-interactive (no TTY, stdin not readable)', async () => {
      uiPrompts.select.mockResolvedValue(null);
      const origStdinTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
      const origStdoutTTY = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
      const origReadable = Object.getOwnPropertyDescriptor(process.stdin, 'readable');
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'readable', { value: false, writable: true, configurable: true });
      try {
        await expect(cmdModel()).rejects.toThrow('process.exit called');
        expect(error).toHaveBeenCalledWith(expect.stringContaining('Non-interactive'));
      } finally {
        if (origStdinTTY) Object.defineProperty(process.stdin, 'isTTY', origStdinTTY);
        else { try { delete process.stdin.isTTY; } catch (_) { /* ignore */ } }
        if (origStdoutTTY) Object.defineProperty(process.stdout, 'isTTY', origStdoutTTY);
        else { try { delete process.stdout.isTTY; } catch (_) { /* ignore */ } }
        if (origReadable) Object.defineProperty(process.stdin, 'readable', origReadable);
        else { try { delete process.stdin.readable; } catch (_) { /* ignore */ } }
      }
    });
  });

  describe('unknown action', () => {
    it('prints an error and exits 1', async () => {
      await expect(cmdModel('foo')).rejects.toThrow('process.exit called');
      expect(error).toHaveBeenCalledWith(expect.stringContaining('Unknown action'));
    });
  });
});
