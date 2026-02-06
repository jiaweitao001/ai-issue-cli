/**
 * Tests for copilot.js
 */
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');

jest.mock('child_process');
jest.mock('fs');
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn(),
  tmpdir: jest.fn(() => '/tmp')
}));

const { runCopilot } = require('../lib/copilot');

describe('copilot', () => {
  let mockProcess;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock child process
    mockProcess = new EventEmitter();
    spawn.mockReturnValue(mockProcess);
  });

  const mockConfig = {
    model: 'claude-sonnet-4.5',
    repoPath: '/mock/repo',
    reportPath: '/mock/reports',
    logLevel: 'info'
  };

  describe('runCopilot', () => {
    describe('on Unix systems', () => {
      beforeEach(() => {
        os.platform.mockReturnValue('darwin');
      });

      it('should spawn copilot with correct arguments', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        // Simulate successful exit
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.arrayContaining([
            '--model', 'claude-sonnet-4.5',
            '--allow-all-tools',
            '--add-dir', '/mock/repo',
            '--add-dir', '/mock/reports',
            '--log-level', 'info',
            '--no-color',
            '-p', 'test prompt'
          ]),
          expect.objectContaining({
            shell: false
          })
        );
      });

      it('should resolve on successful exit (code 0)', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('close', 0);
        
        await expect(promise).resolves.toBeUndefined();
      });

      it('should reject on non-zero exit code', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('close', 1);
        
        await expect(promise).rejects.toThrow('Copilot exit code: 1');
      });

      it('should reject on spawn error', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('error', new Error('spawn failed'));
        
        await expect(promise).rejects.toThrow('spawn failed');
      });

      it('should pass additional arguments', async () => {
        const promise = runCopilot('test prompt', mockConfig, ['--extra-arg']);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.arrayContaining(['--extra-arg']),
          expect.any(Object)
        );
      });

      it('should use silent stdio when silent flag is true', async () => {
        const promise = runCopilot('test prompt', mockConfig, [], true);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.any(Array),
          expect.objectContaining({
            stdio: 'ignore'
          })
        );
      });

      it('should use inherit stdio when silent flag is false', async () => {
        const promise = runCopilot('test prompt', mockConfig, [], false);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.any(Array),
          expect.objectContaining({
            stdio: 'inherit'
          })
        );
      });
    });

    describe('on Windows systems', () => {
      beforeEach(() => {
        os.platform.mockReturnValue('win32');
        fs.writeFileSync.mockReturnValue(undefined);
        fs.existsSync.mockReturnValue(true);
        fs.readFileSync.mockReturnValue(JSON.stringify({ mcpServers: {} }));
        fs.unlinkSync.mockReturnValue(undefined);
      });

      it('should use shell on Windows', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.any(Array),
          expect.objectContaining({
            shell: true
          })
        );
      });

      it('should write prompt to temp file on Windows', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining('copilot-prompt-'),
          'test prompt',
          'utf8'
        );
      });

      it('should use @ prefix for prompt file on Windows', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.arrayContaining([
            '-p', expect.stringMatching(/^@.*copilot-prompt-/)
          ]),
          expect.any(Object)
        );
      });

      it('should clean up temp file after successful execution', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(fs.unlinkSync).toHaveBeenCalled();
      });

      it('should clean up temp file on error', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('error', new Error('spawn failed'));
        
        await expect(promise).rejects.toThrow();
        
        expect(fs.unlinkSync).toHaveBeenCalled();
      });

      it('should reject if temp file write fails', async () => {
        fs.writeFileSync.mockImplementation(() => {
          throw new Error('write failed');
        });
        
        await expect(runCopilot('test prompt', mockConfig))
          .rejects.toThrow('Failed to write prompt file: write failed');
      });
    });
  });
});
