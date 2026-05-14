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

const { runCopilot, forwardChildOutput } = require('../lib/copilot');

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
        const promise = runCopilot('test prompt', mockConfig, { additionalArgs: ['--extra-arg'] });
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.arrayContaining(['--extra-arg']),
          expect.any(Object)
        );
      });

      it('should ignore all child stdio when silent flag is true', async () => {
        const promise = runCopilot('test prompt', mockConfig, { silent: true });
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.any(Array),
          expect.objectContaining({
            stdio: ['ignore', 'ignore', 'ignore']
          })
        );
      });

      it('should pipe child stdout/stderr when silent flag is false', async () => {
        const promise = runCopilot('test prompt', mockConfig, { silent: false });
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.any(Array),
          expect.objectContaining({
            stdio: ['inherit', 'pipe', 'pipe']
          })
        );
      });

      it('should forward piped child stdout and stderr to parent streams', async () => {
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
        const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation(() => true);
        const promise = runCopilot('test prompt', mockConfig, { silent: false });

        mockProcess.stdout.emit('data', Buffer.from('hello stdout\n'));
        mockProcess.stderr.emit('data', Buffer.from('hello stderr\n'));
        mockProcess.emit('close', 0);

        await promise;
        expect(stdoutSpy).toHaveBeenCalledWith(Buffer.from('hello stdout\n'));
        expect(stderrSpy).toHaveBeenCalledWith(Buffer.from('hello stderr\n'));
        stdoutSpy.mockRestore();
        stderrSpy.mockRestore();
      });

      it('should reject when a forwarded child stream errors', async () => {
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        const promise = runCopilot('test prompt', mockConfig, { silent: false });

        mockProcess.stdout.emit('error', new Error('stdout pipe failed'));

        await expect(promise).rejects.toThrow('stdout pipe failed');
      });

      it('should build spawn env from config without mutating process.env', async () => {
        const original = process.env.AI_ISSUE_SERVICE_URL;
        delete process.env.AI_ISSUE_SERVICE_URL;

        const promise = runCopilot('test prompt', {
          ...mockConfig,
          serviceUrl: 'https://service.example.com'
        });

        mockProcess.emit('close', 0);

        await promise;

        expect(spawn.mock.calls[0][2].env.AI_ISSUE_SERVICE_URL).toBe('https://service.example.com');
        expect(process.env.AI_ISSUE_SERVICE_URL).toBeUndefined();

        if (original === undefined) {
          delete process.env.AI_ISSUE_SERVICE_URL;
        } else {
          process.env.AI_ISSUE_SERVICE_URL = original;
        }
      });

      it('should propagate knowledgeBasePath into spawn env', async () => {
        const original = process.env.AI_ISSUE_KB_PATH;
        delete process.env.AI_ISSUE_KB_PATH;

        const promise = runCopilot('test prompt', {
          ...mockConfig,
          knowledgeBasePath: '/config/kb'
        });

        mockProcess.emit('close', 0);

        await promise;

        expect(spawn.mock.calls[0][2].env.AI_ISSUE_KB_PATH).toBe('/config/kb');
        expect(process.env.AI_ISSUE_KB_PATH).toBeUndefined();

        if (original === undefined) {
          delete process.env.AI_ISSUE_KB_PATH;
        } else {
          process.env.AI_ISSUE_KB_PATH = original;
        }
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

      it('should not use shell on Windows (standalone exe)', async () => {
        const promise = runCopilot('test prompt', mockConfig);
        
        mockProcess.emit('close', 0);
        
        await promise;
        
        expect(spawn).toHaveBeenCalledWith(
          'copilot',
          expect.any(Array),
          expect.objectContaining({
            shell: false
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

  describe('forwardChildOutput', () => {
    it('is a no-op for missing source streams', () => {
      const target = { write: jest.fn() };
      expect(() => forwardChildOutput(null, target)).not.toThrow();
      expect(target.write).not.toHaveBeenCalled();
    });

    it('forwards raw chunks without stringifying', () => {
      const source = new EventEmitter();
      const target = { write: jest.fn() };
      const chunk = Buffer.from('raw');

      forwardChildOutput(source, target);
      source.emit('data', chunk);

      expect(target.write).toHaveBeenCalledWith(chunk);
    });

    it('passes source stream errors to onError', () => {
      const source = new EventEmitter();
      const target = { write: jest.fn() };
      const onError = jest.fn();
      const err = new Error('read failed');

      forwardChildOutput(source, target, onError);
      source.emit('error', err);

      expect(onError).toHaveBeenCalledWith(err);
    });

    it('passes target write errors to onError', () => {
      const source = new EventEmitter();
      const err = new Error('write failed');
      const target = { write: jest.fn(() => { throw err; }) };
      const onError = jest.fn();

      forwardChildOutput(source, target, onError);
      source.emit('data', Buffer.from('x'));

      expect(onError).toHaveBeenCalledWith(err);
    });
  });
});
