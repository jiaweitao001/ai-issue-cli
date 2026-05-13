/**
 * Tests for commands/init.js
 */
const fs = require('fs');

jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  homedir: jest.fn(() => '/mock/home')
}));

// Mock logger
const { mockCreateLogger } = require('../helpers/mock-logger');
jest.mock('../../lib/logger', () => mockCreateLogger());

const mockUiSelect = jest.fn();
const mockUiInput = jest.fn();
const mockUiConfirm = jest.fn();
jest.mock('../../lib/ui/prompts', () => ({
  select: mockUiSelect,
  input: mockUiInput,
  confirm: mockUiConfirm,
}));

const mockInstallKnowledgeBase = jest.fn();
jest.mock('../../lib/commands/kb', () => ({
  installKnowledgeBase: mockInstallKnowledgeBase,
}));

const mockSaveConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  saveConfig: mockSaveConfig,
  DEFAULT_CONFIG: { agent: 'copilot', reportPath: '/mock/home/.ai-issue/reports' },
  CONFIG_FILE: '/mock/home/.ai-issue/config.json',
}));

const { cmdInit, _internal } = require('../../lib/commands/init');
const { success, info, error } = require('../../lib/logger');

describe('commands/init', () => {
  let originalIsTTY;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUiSelect.mockReset();
    mockUiInput.mockReset();
    mockUiConfirm.mockReset();
    mockSaveConfig.mockReset();
    mockInstallKnowledgeBase.mockReset();
    mockUiConfirm.mockResolvedValue(false);
    mockUiSelect.mockResolvedValue('copilot');
    mockSaveConfig.mockImplementation(() => undefined);
    delete process.env.CI;
    originalIsTTY = process.stdout.isTTY;
    // Default: simulate non-TTY so existing tests don't try to render a picker.
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, configurable: true });
  });

  it('should skip initialization if config file already exists', async () => {
    fs.existsSync.mockReturnValue(true);
    
    await cmdInit();
    
    expect(info).toHaveBeenCalledWith(expect.stringContaining('already exists'));
    expect(fs.writeFileSync).not.toHaveBeenCalled();
    expect(mockSaveConfig).not.toHaveBeenCalled();
  });

  it('should create config file when it does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return false;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);

    await cmdInit();

    expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
    expect(success).toHaveBeenCalledWith(expect.stringContaining('Initialization complete'));
  });

  it('should create report directory if it does not exist', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      if (path.includes('reports')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    
    await cmdInit();
    
    expect(fs.mkdirSync).toHaveBeenCalledWith(
      expect.stringContaining('reports'),
      expect.objectContaining({ recursive: true })
    );
  });

  it('should handle initialization errors gracefully', async () => {
    fs.existsSync.mockReturnValue(false);
    mockSaveConfig.mockImplementation(() => {
      throw new Error('Permission denied');
    });
    fs.mkdirSync.mockReturnValue(undefined);

    await cmdInit();

    expect(error).toHaveBeenCalledWith(expect.stringContaining('Failed to initialize'));
  });

  it('should display instructions for next steps', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    
    await cmdInit();
    
    expect(info).toHaveBeenCalledWith(expect.stringContaining('repoPath'));
  });

  it('should skip KB prompt entirely in CI mode', async () => {
    process.env.CI = 'true';
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);

    await cmdInit();

    expect(mockUiConfirm).not.toHaveBeenCalled();
    expect(mockInstallKnowledgeBase).not.toHaveBeenCalled();
    expect(info).toHaveBeenCalledWith(expect.stringContaining('CI mode: skipping local knowledge base'));
  });

  it('should NOT install KB when user declines the prompt in non-CI mode', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    mockUiConfirm.mockResolvedValue(false);

    await cmdInit();

    expect(mockUiConfirm).toHaveBeenCalledTimes(1);
    expect(mockUiConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Download local knowledge base'), default: true })
    );
    expect(mockInstallKnowledgeBase).not.toHaveBeenCalled();
  });

  it('should install KB when user accepts the prompt in non-CI mode', async () => {
    fs.existsSync.mockImplementation((path) => {
      if (path.includes('config.json')) return false;
      return true;
    });
    fs.writeFileSync.mockReturnValue(undefined);
    fs.mkdirSync.mockReturnValue(undefined);
    mockUiConfirm.mockResolvedValue(true);
    mockInstallKnowledgeBase.mockResolvedValue({ version: '2026.05.07' });

    await cmdInit();

    expect(mockUiConfirm).toHaveBeenCalledTimes(1);
    expect(mockInstallKnowledgeBase).toHaveBeenCalledWith(
      expect.objectContaining({ source: 'jiaweitao001/ai-issue-cli' })
    );
  });

  describe('agent picker (PHASE5B §3.9)', () => {
    beforeEach(() => {
      fs.existsSync.mockImplementation((path) => {
        if (path.includes('config.json')) return false;
        return true;
      });
      fs.writeFileSync.mockReturnValue(undefined);
      fs.mkdirSync.mockReturnValue(undefined);
    });

    it('CI mode: skips picker and persists copilot without calling select', async () => {
      process.env.CI = 'true';

      await cmdInit();

      expect(mockUiSelect).not.toHaveBeenCalled();
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('CI mode: defaulting agent to copilot'));
    });

    it('non-TTY: skips picker and persists copilot without calling select', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

      await cmdInit();

      expect(mockUiSelect).not.toHaveBeenCalled();
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Non-TTY environment: defaulting agent to copilot'));
    });

    it('TTY + user picks copilot: persists copilot', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      mockUiSelect.mockResolvedValue('copilot');

      await cmdInit();

      expect(mockUiSelect).toHaveBeenCalledTimes(1);
      // Verify the picker was offered with both agents and copilot first (recommended)
      const [items, opts] = mockUiSelect.mock.calls[0];
      const names = items.map(i => i.name);
      expect(names).toEqual(expect.arrayContaining(['copilot', 'claude-code']));
      expect(names[0]).toBe('copilot');
      for (const it of items) {
        expect(typeof it.label).toBe('string');
        expect(it.label.length).toBeGreaterThan(0);
      }
      expect(opts).toMatchObject({ initialIndex: 0 });
      expect(opts.message).toMatch(/Choose default agent/i);
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
    });

    it('TTY + user picks claude-code: persists claude-code and prints model hint', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      mockUiSelect.mockResolvedValue('claude-code');

      await cmdInit();

      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude-code' }));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('agents.claude-code.model'));
    });

    it('TTY + user cancels picker: defaults to copilot and continues', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
      mockUiSelect.mockResolvedValue(null);

      await cmdInit();

      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('No agent selected; defaulting to copilot'));
      expect(success).toHaveBeenCalledWith(expect.stringContaining('Initialization complete'));
    });

    it('buildAgentChoices: returns recommended agent (copilot) first', () => {
      const choices = _internal.buildAgentChoices();
      expect(choices.length).toBeGreaterThanOrEqual(2);
      expect(choices[0].name).toBe('copilot');
      expect(choices.find(c => c.name === 'claude-code')).toBeDefined();
      // Every choice has a non-empty label
      for (const c of choices) {
        expect(typeof c.label).toBe('string');
        expect(c.label.length).toBeGreaterThan(0);
      }
    });
  });
});
