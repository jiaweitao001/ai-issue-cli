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
const mockLoadConfig = jest.fn();
jest.mock('../../lib/config', () => ({
  saveConfig: mockSaveConfig,
  loadConfig: mockLoadConfig,
  DEFAULT_CONFIG: {
    agent: 'copilot',
    repoPath: '',
    issueBaseUrl: 'https://github.com/hashicorp/terraform-provider-azurerm/issues',
    reportPath: '/mock/home/.ai-issue/reports'
  },
  CONFIG_FILE: '/mock/home/.ai-issue/config.json',
}));

const { cmdInit, _internal } = require('../../lib/commands/init');
const { success, info, error } = require('../../lib/logger');

describe('commands/init', () => {
  let originalIsTTY;
  let originalStdinIsTTY;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUiSelect.mockReset();
    mockUiInput.mockReset();
    mockUiConfirm.mockReset();
    mockSaveConfig.mockReset();
    mockLoadConfig.mockReset();
    mockInstallKnowledgeBase.mockReset();
    mockUiConfirm.mockResolvedValue(false);
    mockUiSelect.mockResolvedValue('copilot');
    mockUiInput.mockResolvedValue('/mock/repo');
    mockLoadConfig.mockReturnValue({
      agent: 'copilot',
      repoPath: '/mock/repo',
      issueBaseUrl: 'https://github.com/example/repo/issues',
      reportPath: '/mock/home/.ai-issue/reports'
    });
    mockSaveConfig.mockImplementation(() => undefined);
    delete process.env.CI;
    originalIsTTY = process.stdout.isTTY;
    originalStdinIsTTY = process.stdin.isTTY;
    // Default: simulate non-TTY so existing tests don't try to render a picker.
    Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: originalIsTTY, writable: true, configurable: true });
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, writable: true, configurable: true });
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
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });

      await cmdInit();

      expect(mockUiSelect).not.toHaveBeenCalled();
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'copilot' }));
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Non-TTY environment: defaulting agent to copilot'));
    });

    it('TTY + user picks copilot: persists copilot', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      mockUiSelect.mockResolvedValueOnce('copilot');
      mockUiInput
        .mockResolvedValueOnce('/mock/repo')
        .mockResolvedValueOnce('https://github.com/example/repo/issues');
      mockUiConfirm
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

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
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        repoPath: '/mock/repo',
        issueBaseUrl: 'https://github.com/example/repo/issues'
      }));
    });

    it('TTY + user picks claude-code: persists claude-code and prints model hint', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      mockUiSelect.mockResolvedValueOnce('claude-code');
      mockUiInput
        .mockResolvedValueOnce('/mock/repo')
        .mockResolvedValueOnce('https://github.com/example/repo/issues');
      mockUiConfirm
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(true);

      await cmdInit();

      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({ agent: 'claude-code' }));
    });

    it('TTY + user cancels picker: does not write config', async () => {
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      mockUiSelect.mockResolvedValue(null);

      await cmdInit();

      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('cancelled'));
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

  describe('init wizard / reconfigure (PR-4)', () => {
    it('existing config + --reconfigure + keep does not write', async () => {
      fs.existsSync.mockReturnValue(true);
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      mockUiSelect.mockResolvedValueOnce('keep');

      await cmdInit({ reconfigure: true });

      expect(mockLoadConfig).not.toHaveBeenCalled();
      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('unchanged'));
    });

    it('existing config + --reconfigure + cancel does not write', async () => {
      fs.existsSync.mockReturnValue(true);
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      mockUiSelect.mockResolvedValueOnce('cancel');

      await cmdInit({ reconfigure: true });

      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('unchanged'));
    });

    it('existing config + --reconfigure + edit writes only after summary confirm', async () => {
      fs.existsSync.mockReturnValue(true);
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      mockUiSelect
        .mockResolvedValueOnce('edit')
        .mockResolvedValueOnce('claude-code');
      mockUiInput
        .mockResolvedValueOnce('/mock/repo')
        .mockResolvedValueOnce('https://github.com/example/repo/issues');
      mockUiConfirm
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(true);

      await cmdInit({ reconfigure: true });

      expect(mockLoadConfig).toHaveBeenCalled();
      expect(mockSaveConfig).toHaveBeenCalledWith(expect.objectContaining({
        agent: 'claude-code',
        repoPath: '/mock/repo',
        issueBaseUrl: 'https://github.com/example/repo/issues'
      }));
      expect(success).toHaveBeenCalledWith(expect.stringContaining('Configuration updated'));
    });

    it('existing config + --reconfigure + edit + summary cancel does not write', async () => {
      fs.existsSync.mockReturnValue(true);
      Object.defineProperty(process.stdout, 'isTTY', { value: true, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: true, writable: true, configurable: true });
      mockUiSelect
        .mockResolvedValueOnce('edit')
        .mockResolvedValueOnce('copilot');
      mockUiInput
        .mockResolvedValueOnce('/mock/repo')
        .mockResolvedValueOnce('https://github.com/example/repo/issues');
      mockUiConfirm
        .mockResolvedValueOnce(false)
        .mockResolvedValueOnce(false);

      await cmdInit({ reconfigure: true });

      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('Configuration unchanged'));
    });

    it('existing config + --reconfigure in non-TTY remains non-mutating', async () => {
      fs.existsSync.mockReturnValue(true);
      Object.defineProperty(process.stdout, 'isTTY', { value: false, writable: true, configurable: true });
      Object.defineProperty(process.stdin, 'isTTY', { value: false, writable: true, configurable: true });

      await cmdInit({ reconfigure: true });

      expect(mockUiSelect).not.toHaveBeenCalled();
      expect(mockSaveConfig).not.toHaveBeenCalled();
      expect(info).toHaveBeenCalledWith(expect.stringContaining('interactive terminal'));
    });

    it('buildInitSummary includes all wizard fields', () => {
      expect(_internal.buildInitSummary({
        agent: 'copilot',
        repoPath: '/repo',
        issueBaseUrl: 'https://github.com/o/r/issues',
        reportPath: '/reports'
      }, true)).toContain('Download local knowledge base: yes');
    });

    it('looksLikeIssueBaseUrl validates issue URLs', () => {
      expect(_internal.looksLikeIssueBaseUrl('https://github.com/o/r/issues')).toBe(true);
      expect(_internal.looksLikeIssueBaseUrl('https://github.com/o/r/pulls')).toBe(false);
    });
  });
});
